//! The contextual mouse panel. One immutable snapshot belongs to each invocation.
use crate::{
    config,
    context::{self, Context},
    plugins::{ItemAction, ItemKind, Registry, SearchItem},
};
use serde::{Deserialize, Serialize};
use std::{
    fs::OpenOptions,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const LABEL: &str = "super";
const WIDTH: f64 = 300.;
const HEIGHT: f64 = 460.;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub long_press_right: bool,
    pub pinned: Vec<SearchItem>,
    pub actions: Vec<CustomAction>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAction {
    pub id: String,
    pub name: String,
    pub command: String,
    pub when: Vec<String>,
    pub enabled: bool,
}
fn feature(plugin: &str, code: &str, title: &str) -> SearchItem {
    SearchItem {
        title: title.into(),
        subtitle: String::new(),
        plugin: plugin.into(),
        kind: ItemKind::Feature,
        icon: None,
        score: 0,
        action: ItemAction::Feature {
            feature: code.into(),
            input: None,
        },
    }
}
impl Default for Settings {
    fn default() -> Self {
        let mut pinned = vec![
            feature("screenshot", "take", "截图"),
            feature("qrcode", "generate", "二维码"),
            feature("system", "colorpicker", "取色"),
            feature("system", "ocr", "截图识字"),
        ];
        pinned.push(SearchItem {
            action: ItemAction::OpenWeb {
                id: "deepseek".into(),
            },
            icon: Some("https://chat.deepseek.com".into()),
            ..feature("webapps", "", "DeepSeek")
        });
        pinned.extend([
            feature("system", "desktop", "显示桌面"),
            feature("system", "lock", "锁屏"),
        ]);
        Self { long_press_right: false, pinned, actions: vec![
            CustomAction { id:"vscode".into(), name:"用 VS Code 打开".into(), command:"code {path}".into(), when:vec!["file".into(),"folder".into(),"image".into()], enabled:false },
            CustomAction { id:"claude-code".into(), name:"用 Claude Code 打开".into(), command:"/usr/bin/osascript -e 'on run argv' -e 'tell application \"Terminal\"' -e 'activate' -e 'do script (\"cd \" & quoted form of (item 1 of argv) & \" && claude\")' -e 'end tell' -e 'end run' {dir}".into(), when:vec!["folder".into()], enabled:false },
        ] }
    }
}
pub fn normalize_pin(item: &mut SearchItem) {
    item.score = 0;
    if let ItemAction::Feature { feature, .. } = &item.action {
        if let Some(m) = Registry::new()
            .manifests
            .iter()
            .find(|m| m.id == item.plugin)
        {
            if let Some(f) = m.features.iter().find(|f| &f.code == feature) {
                item.title = f.explain.clone();
                item.subtitle = m.name.clone();
            }
        }
    }
    if let ItemAction::Feature { input, .. } = &mut item.action {
        *input = None;
    }
}
pub fn validate_settings(cfg: &mut Settings) -> Result<(), String> {
    for item in &mut cfg.pinned {
        normalize_pin(item);
    }
    let mut unique = vec![];
    for item in cfg.pinned.drain(..) {
        if !unique
            .iter()
            .any(|p: &SearchItem| p.plugin == item.plugin && p.action == item.action)
        {
            unique.push(item);
        }
    }
    if unique.len() > 12 {
        return Err("我的面板最多放 12 个功能".into());
    }
    cfg.pinned = unique;
    let mut ids = std::collections::HashSet::new();
    for a in &cfg.actions {
        if a.id.trim().is_empty() || !ids.insert(a.id.clone()) {
            return Err("自定义动作的标识重复".into());
        }
        if a.name.trim().is_empty() {
            return Err("请输入动作名称".into());
        }
        if a.when.is_empty()
            || a.when
                .iter()
                .any(|k| !["file", "folder", "image", "text"].contains(&k.as_str()))
        {
            return Err("请选择适用类型".into());
        }
        crate::superpanel_commands::validate(&a.command)?;
    }
    Ok(())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: String,
    title: String,
    subtitle: String,
    plugin: String,
    feature: String,
    item: Option<SearchItem>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    request_id: u64,
    context: Context,
    actions: Vec<Entry>,
    pinned: Vec<Entry>,
}
#[derive(Clone)]
enum Run {
    Copy(String),
    Terminal(String),
    NewFile(String),
    Save(Vec<String>),
    Feature(String, String, Option<String>),
    Query(String),
    Ask(String, String),
    Item(SearchItem),
    Custom(String, Option<String>),
}
struct Session {
    snapshot: Snapshot,
    runners: Vec<(String, Run)>,
}
static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static OPENING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?view=super".into()))
        .title("AhaTools · 超级面板")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        .build()?;
    let app = app.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            hide(&app);
        }
    });
    Ok(())
}
pub fn hide(app: &AppHandle) {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    OPENING.store(false, Ordering::SeqCst);
    *SESSION.lock().unwrap() = None;
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
}
pub fn refresh(app: &AppHandle) {
    let current = SESSION
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| (s.snapshot.request_id, s.snapshot.context.clone()));
    if let Some((id, ctx)) = current {
        let next = build(app, id, ctx);
        let mut state = SESSION.lock().unwrap();
        if state.as_ref().is_some_and(|s| s.snapshot.request_id == id) {
            *state = Some(next);
        }
    }
}
pub fn toggle(app: &AppHandle) {
    if OPENING.load(Ordering::SeqCst)
        || app
            .get_webview_window(LABEL)
            .is_some_and(|w| w.is_visible().unwrap_or(false))
    {
        hide(app);
        return;
    }
    let front = context::front();
    // AppKit points: Tauri's cursor and monitor "physical" values mix display scales.
    let cursor = crate::window_position::mouse_location();
    crate::panel::hide(app);
    crate::popover::hide(app);
    let id = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    OPENING.store(true, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        let ctx = context::capture(front);
        if GENERATION.load(Ordering::SeqCst) != id {
            return;
        }
        let session = build(&app, id, ctx);
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            if GENERATION.load(Ordering::SeqCst) != id {
                return;
            }
            let Some(w) = app2.get_webview_window(LABEL) else {
                return;
            };
            crate::window_position::place_at_cursor(&w, cursor, (WIDTH, HEIGHT));
            let snapshot = session.snapshot.clone();
            *SESSION.lock().unwrap() = Some(session);
            OPENING.store(false, Ordering::SeqCst);
            let _ = w.show();
            let _ = w.set_focus();
            let _ = app2.emit_to(LABEL, "superpanel-shown", snapshot);
        });
    });
}
pub fn item_available(app: &AppHandle, item: &SearchItem) -> bool {
    match &item.action {
        ItemAction::OpenWeb { id } => config::load(app).web_apps.iter().any(|w| &w.id == id),
        ItemAction::OpenPath { path } => {
            tauri::Url::parse(path).is_ok()
                || Path::new(&crate::plugins::expand_home(path)).exists()
        }
        ItemAction::Feature { feature, .. } => {
            item.plugin != "superpanel"
                && app
                    .state::<Registry>()
                    .manifests
                    .iter()
                    .any(|m| m.id == item.plugin && m.features.iter().any(|f| &f.code == feature))
        }
    }
}
fn applies(a: &CustomAction, ctx: &Context) -> bool {
    a.enabled
        && if ctx.kind == "text" {
            a.when.iter().any(|w| w == "text")
        } else {
            !ctx.paths.is_empty()
                && ctx.paths.iter().all(|p| {
                    let kind = if Path::new(p).is_dir() {
                        "folder"
                    } else if context::is_image(p) {
                        "image"
                    } else {
                        "file"
                    };
                    a.when
                        .iter()
                        .any(|w| w == kind || (w == "file" && kind == "image"))
                })
        }
}
fn build(app: &AppHandle, id: u64, ctx: Context) -> Session {
    let cfg = config::load(app);
    let mut actions = vec![];
    let mut runners = vec![];
    let mut add =
        |key: &str, title: &str, subtitle: &str, plugin: &str, feature: &str, run: Run| {
            actions.push(Entry {
                id: key.into(),
                title: title.into(),
                subtitle: subtitle.into(),
                plugin: plugin.into(),
                feature: feature.into(),
                item: None,
            });
            runners.push((key.into(), run));
        };
    if ctx.kind == "files" {
        if ctx.paths.len() == 1 && context::is_image(&ctx.paths[0]) {
            add(
                "qr",
                "识别二维码",
                "选中的图片",
                "qrcode",
                "scan",
                Run::Feature(
                    "qrcode".into(),
                    "scan".into(),
                    Some(serde_json::json!({"paths":ctx.paths}).to_string()),
                ),
            );
        }
        add(
            "copy",
            "复制路径",
            &format!("{} 个项目", ctx.paths.len()),
            "launcher",
            "",
            Run::Copy(ctx.paths.join("\n")),
        );
        if let Some(dir) = &ctx.dir {
            add(
                "terminal",
                "在终端中打开",
                "所在文件夹",
                "launcher",
                "",
                Run::Terminal(dir.clone()),
            );
            if ctx.paths.len() == 1 && Path::new(&ctx.paths[0]).is_dir() {
                add(
                    "new",
                    "新建空白文件",
                    "未命名.txt",
                    "launcher",
                    "",
                    Run::NewFile(dir.clone()),
                );
            }
        }
        add(
            "save",
            "收藏到快捷启动",
            "保留全部选中项目",
            "launcher",
            "",
            Run::Save(ctx.paths.clone()),
        );
    } else if let Some(text) = &ctx.text {
        for web in &cfg.web_apps {
            add(
                &format!("ask:{}", web.id),
                &format!("问 {}", web.name),
                "复制文字并打开网页应用",
                "webapps",
                "",
                Run::Ask(web.id.clone(), text.clone()),
            );
        }
        add(
            "qr",
            "生成二维码",
            "选中的文字",
            "qrcode",
            "generate",
            Run::Feature("qrcode".into(), "generate".into(), Some(text.clone())),
        );
        add(
            "search",
            "在搜索面板中打开",
            "带入选中文字",
            "launcher",
            "",
            Run::Query(text.clone()),
        );
        add(
            "copy",
            "复制为纯文本",
            "去掉文字格式",
            "launcher",
            "",
            Run::Copy(text.clone()),
        );
        if is_http(text) {
            add(
                "url",
                "在浏览器中打开",
                text.trim(),
                "webapps",
                "",
                Run::Item(SearchItem {
                    action: ItemAction::OpenPath {
                        path: text.trim().into(),
                    },
                    ..feature("webapps", "", "打开网址")
                }),
            );
        }
    }
    for a in &cfg.super_panel.actions {
        if applies(a, &ctx) {
            if let Ok(cmd) = crate::superpanel_commands::expand(&a.command, &ctx) {
                add(
                    &format!("custom:{}", a.id),
                    &a.name,
                    "自定义动作",
                    "external",
                    "",
                    Run::Custom(cmd, ctx.dir.clone()),
                );
            }
        }
    }
    let mut pinned = vec![];
    for (i, item) in cfg.super_panel.pinned.iter().enumerate() {
        if !item_available(app, item) {
            continue;
        }
        let key = format!("pin:{i}");
        pinned.push(Entry {
            id: key.clone(),
            title: item.title.clone(),
            subtitle: item.subtitle.clone(),
            plugin: item.plugin.clone(),
            feature: match &item.action {
                ItemAction::Feature { feature, .. } => feature.clone(),
                _ => String::new(),
            },
            item: Some(item.clone()),
        });
        runners.push((key, Run::Item(item.clone())));
    }
    runners.push(("search-panel".into(), Run::Query(String::new())));
    runners.push((
        "settings".into(),
        Run::Feature(
            "settings".into(),
            "general".into(),
            Some("superpanel".into()),
        ),
    ));
    Session {
        snapshot: Snapshot {
            request_id: id,
            context: ctx,
            actions,
            pinned,
        },
        runners,
    }
}
fn is_http(text: &str) -> bool {
    if text.trim().chars().any(char::is_whitespace) {
        return false;
    }
    tauri::Url::parse(text.trim())
        .is_ok_and(|u| ["http", "https"].contains(&u.scheme()) && u.host_str().is_some())
}
fn new_file(dir: &str) -> Result<PathBuf, String> {
    for i in 0..10000 {
        let path = Path::new(dir).join(if i == 0 {
            "未命名.txt".into()
        } else {
            format!("未命名 {i}.txt")
        });
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Ok(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("无法新建文件：{e}")),
        }
    }
    Err("同名文件太多，请先整理文件夹".into())
}
fn execute(app: &AppHandle, run: Run) -> Result<(), String> {
    match run {
        Run::Copy(text) => context::write_text(&text)?,
        Run::Terminal(dir) => {
            let status = Command::new("/usr/bin/open")
                .args(["-a", "Terminal", &dir])
                .status()
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("无法打开终端".into());
            }
        }
        Run::NewFile(dir) => {
            let path = new_file(&dir)?;
            Command::new("/usr/bin/open")
                .arg("-R")
                .arg(path)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Run::Save(paths) => {
            for path in paths {
                crate::plugins::launcher::launcher_add(app.state(), path, None)?;
            }
            crate::relay::notify("已收藏到快捷启动");
        }
        Run::Feature(plugin, feature, input) => {
            crate::panel::open_feature(app, &plugin, &feature, input, false);
        }
        Run::Query(text) => crate::panel::open_query(app, text),
        Run::Ask(id, text) => {
            context::write_text(&text)?;
            crate::webapps::open(app, &id)?;
            crate::relay::notify("已复制，粘贴即可");
        }
        Run::Item(item) => {
            crate::usage::usage_record(app.clone(), item.clone())?;
            match item.action {
                ItemAction::OpenPath { path } => crate::plugins::open_path(app.clone(), path)?,
                ItemAction::OpenWeb { id } => crate::webapps::open(app, &id)?,
                ItemAction::Feature { feature, input } => {
                    if item.plugin == "system" {
                        crate::plugins::system::run(app, &feature)?;
                    } else if item.plugin == "screenshot" {
                        crate::screenshot::take(app, None);
                    } else {
                        crate::panel::open_feature(app, &item.plugin, &feature, input, false);
                    }
                }
            }
        }
        Run::Custom(cmd, dir) => crate::superpanel_commands::execute(&cmd, dir.as_deref())?,
    }
    Ok(())
}
#[tauri::command]
pub fn superpanel_open(app: AppHandle) {
    toggle(&app)
}
#[tauri::command]
pub fn superpanel_state() -> Snapshot {
    SESSION
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.snapshot.clone())
        .unwrap_or_default()
}
#[tauri::command]
pub fn superpanel_hide(app: AppHandle) {
    hide(&app)
}
fn accept(state: &mut Option<Session>, request_id: u64, action_id: &str) -> Result<Run, String> {
    let session = state.as_ref().ok_or("面板已关闭，请重新呼出")?;
    if session.snapshot.request_id != request_id {
        return Err("上下文已更新，请重新选择动作".into());
    }
    let run = session
        .runners
        .iter()
        .find(|(id, _)| id == action_id)
        .map(|(_, r)| r.clone())
        .ok_or("找不到这个动作")?;
    *state = None;
    Ok(run)
}
#[tauri::command]
pub fn superpanel_run(app: AppHandle, request_id: u64, action_id: String) -> Result<(), String> {
    let run = accept(&mut SESSION.lock().unwrap(), request_id, &action_id)?;
    hide(&app);
    std::thread::spawn(move || {
        if let Err(e) = execute(&app, run) {
            crate::relay::notify(&e);
        }
    });
    Ok(())
}
#[tauri::command]
pub fn superpanel_remove_pin(app: AppHandle, index: usize) -> Result<(), String> {
    let target = SESSION.lock().unwrap().as_ref().and_then(|s| {
        s.snapshot
            .pinned
            .iter()
            .find(|p| p.id == format!("pin:{index}"))
            .and_then(|p| p.item.clone())
    });
    let mut cfg = config::load(&app);
    if let Some(item) = target {
        cfg.super_panel
            .pinned
            .retain(|p| p.plugin != item.plugin || p.action != item.action);
    }
    config::config_set(app, cfg).map(|_| ())
}
#[tauri::command]
pub fn superpanel_validate_command(command: String) -> Result<(), String> {
    crate::superpanel_commands::validate(&command)
}
#[tauri::command]
pub fn superpanel_pin_status(app: AppHandle) -> Vec<bool> {
    config::load(&app)
        .super_panel
        .pinned
        .iter()
        .map(|i| item_available(&app, i))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn expired_unknown_and_duplicate_actions_cannot_run() {
        let mut session = Some(Session {
            snapshot: Snapshot {
                request_id: 7,
                ..Snapshot::default()
            },
            runners: vec![("copy".into(), Run::Copy("snapshot text".into()))],
        });
        assert!(accept(&mut session, 6, "copy").is_err());
        assert!(session.is_some());
        assert!(accept(&mut session, 7, "unknown").is_err());
        assert!(session.is_some());
        assert!(matches!(accept(&mut session,7,"copy"),Ok(Run::Copy(s)) if s=="snapshot text"));
        assert!(accept(&mut session, 7, "copy").is_err());
    }
    #[test]
    fn creates_without_overwriting() {
        let dir = std::env::temp_dir().join(format!("ahatools-new-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let a = new_file(dir.to_str().unwrap()).unwrap();
        fs::write(&a, "keep").unwrap();
        let b = new_file(dir.to_str().unwrap()).unwrap();
        assert_ne!(a, b);
        assert_eq!(fs::read_to_string(a).unwrap(), "keep");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn defaults_and_normalization() {
        let mut cfg = Settings::default();
        assert_eq!(cfg.pinned.len(), 7);
        assert!(cfg.actions.iter().all(|a| !a.enabled));
        cfg.pinned.push(cfg.pinned[0].clone());
        validate_settings(&mut cfg).unwrap();
        assert_eq!(cfg.pinned.len(), 7);
    }
    #[test]
    fn custom_actions_require_all_types_and_context() {
        let a = CustomAction {
            id: "a".into(),
            name: "a".into(),
            command: "echo {path}".into(),
            when: vec!["image".into()],
            enabled: true,
        };
        let ctx = Context {
            kind: "files".into(),
            paths: vec!["/tmp/a.png".into(), "/tmp/a.txt".into()],
            ..Context::default()
        };
        assert!(!applies(&a, &ctx));
        assert!(!is_http("javascript:alert(1)"));
        assert!(is_http("https://example.com"));
    }
}
