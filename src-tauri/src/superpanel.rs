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
            feature("qrcode", "generate", "生成二维码"),
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
    /// Short note on the right of a row, e.g. 「13 张」.
    subtitle: String,
    plugin: String,
    feature: String,
    /// "match" | "files" | "text" | "custom" for context rows, "pin" for 我的面板.
    group: String,
    /// Line icon for AhaTools' own actions; empty means the feature / item icon.
    icon: String,
    /// What 「固定到超级面板」 would pin, and the icon source for apps and web apps.
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
#[derive(Clone, Debug)]
enum Run {
    /// Text for the clipboard and the notification shown after copying.
    Copy(String, &'static str),
    Terminal(String),
    NewFile(String),
    Save(Vec<String>),
    Feature(String, String, Option<String>),
    Query(String),
    Ask(String, String),
    Item(SearchItem),
    Custom(String, Option<String>),
    /// The 「固定」 cell: the search panel, with a hint that results pin on right-click.
    PinHint,
}
struct Session {
    snapshot: Snapshot,
    runners: Vec<(String, Run)>,
}
static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static OPENING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Where the panel was called up, so a height change can re-place it beside the pointer.
static CURSOR: Mutex<(f64, f64)> = Mutex::new((0., 0.));

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
            // Placed for the tallest panel first; the page reports its real height next.
            *CURSOR.lock().unwrap() = cursor;
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
    let mut settings_runners = vec![];
    let mut add = |key: String, group: &str, title: &str, subtitle: &str, icon: &str, item: Option<SearchItem>, run: Run| {
        let (plugin, feature) = match &item {
            Some(SearchItem { plugin, action: ItemAction::Feature { feature, .. }, .. }) => (plugin.clone(), feature.clone()),
            Some(i) => (i.plugin.clone(), String::new()),
            None => (String::new(), String::new()),
        };
        actions.push(Entry {
            id: key.clone(),
            title: title.into(),
            subtitle: subtitle.into(),
            plugin,
            feature,
            group: group.into(),
            icon: icon.into(),
            item: item.map(|mut i| {
                normalize_pin(&mut i);
                i
            }),
        });
        runners.push((key, run));
    };
    let text = ctx.text.as_deref().filter(|_| ctx.kind == "text");
    let paths: &[String] = if ctx.kind == "files" { &ctx.paths } else { &[] };
    // 匹配的功能: plugin manifests decide, exactly like the search panel's 自动匹配.
    // Copying paths / names is in the 文件 group below and runs without the search panel.
    let matches = app.state::<Registry>().context_matches(text, paths).into_iter().filter(|item| !duplicates_file_action(item));
    for (i, mut item) in matches.enumerate() {
        if let ItemAction::Feature { input, .. } = &mut item.action {
            if input.is_none() && !paths.is_empty() {
                *input = Some(serde_json::json!({ "paths": paths }).to_string());
            }
        }
        let (title, note) = item.title.split_once(" · ").map_or((item.title.clone(), String::new()), |(t, n)| (t.into(), n.into()));
        let note = if item.plugin == "translate" { "点按后翻译".into() } else { note };
        let settings = Run::Feature("settings".into(), "general".into(), Some(format!("plugins/{}", item.plugin)));
        settings_runners.push((format!("plugin-settings:{}", item.plugin), settings));
        add(format!("match:{i}"), "match", &title, &note, "", Some(item.clone()), Run::Item(item));
    }
    if let Some(text) = text {
        for web in &cfg.web_apps {
            let item = SearchItem {
                title: web.name.clone(),
                subtitle: web.url.clone(),
                plugin: "webapps".into(),
                kind: ItemKind::Feature,
                icon: Some(web.url.clone()),
                score: 0,
                action: ItemAction::OpenWeb { id: web.id.clone() },
            };
            add(format!("ask:{}", web.id), "match", &format!("问 {}", web.name), "复制后打开", "", Some(item), Run::Ask(web.id.clone(), text.into()));
        }
        if is_http(text) {
            let url = text.trim().to_string();
            add("url".into(), "match", "在浏览器中打开", "", "globe", None, Run::Item(SearchItem {
                action: ItemAction::OpenPath { path: url },
                ..feature("webapps", "", "打开网址")
            }));
        }
        add("search".into(), "text", "在搜索面板中打开", "", "search", None, Run::Query(text.into()));
        add("copy".into(), "text", "复制为纯文本", "", "copy", None, Run::Copy(text.into(), "已复制"));
    }
    for action in file_actions(paths, ctx.dir.as_deref()) {
        add(action.key.into(), "files", action.title, &action.note, action.icon, None, action.run);
    }
    for a in &cfg.super_panel.actions {
        if applies(a, &ctx) {
            if let Ok(cmd) = crate::superpanel_commands::expand(&a.command, &ctx) {
                add(format!("custom:{}", a.id), "custom", &a.name, "", "command", None, Run::Custom(cmd, ctx.dir.clone()));
            }
        }
    }
    let mut pinned = vec![];
    for (i, item) in cfg.super_panel.pinned.iter().enumerate() {
        if !item_available(app, item) {
            continue;
        }
        // Older configs saved short titles (「二维码」); show the feature's full name.
        let item = &{
            let mut item = item.clone();
            normalize_pin(&mut item);
            item
        };
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
            group: "pin".into(),
            icon: String::new(),
            item: Some(item.clone()),
        });
        runners.push((key, Run::Item(item.clone())));
    }
    runners.extend(settings_runners);
    runners.push(("search-panel".into(), Run::Query(String::new())));
    runners.push(("pin-hint".into(), Run::PinHint));
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
/// Plugin features the panel already offers its own way: the 文件 group's copies, its
/// 在浏览器中打开 row, and revealing what Finder is already showing.
fn duplicates_file_action(item: &SearchItem) -> bool {
    item.plugin == "launcher"
        && matches!(&item.action, ItemAction::Feature { feature, .. } if ["copy-path", "copy-name", "open-url", "reveal"].contains(&feature.as_str()))
}
struct FileAction {
    key: &'static str,
    title: &'static str,
    note: String,
    icon: &'static str,
    run: Run,
}
/// AhaTools' own actions for a Finder selection, in display order.
fn file_actions(paths: &[String], dir: Option<&str>) -> Vec<FileAction> {
    if paths.is_empty() {
        return vec![];
    }
    let count = if paths.len() > 1 { format!("{} 项", paths.len()) } else { String::new() };
    let names = paths
        .iter()
        .map(|p| Path::new(p).file_name().map_or_else(|| p.clone(), |n| n.to_string_lossy().into_owned()))
        .collect::<Vec<_>>()
        .join("\n");
    let mut actions = vec![
        FileAction { key: "copy", title: "复制路径", note: count.clone(), icon: "copy", run: Run::Copy(paths.join("\n"), "已复制路径") },
        FileAction { key: "copy-name", title: "复制文件名", note: count, icon: "copy", run: Run::Copy(names, "已复制文件名") },
    ];
    if let Some(dir) = dir {
        actions.push(FileAction { key: "terminal", title: "在终端中打开", note: String::new(), icon: "terminal", run: Run::Terminal(dir.into()) });
        if paths.len() == 1 && Path::new(&paths[0]).is_dir() {
            actions.push(FileAction { key: "new", title: "新建空白文件", note: "未命名.txt".into(), icon: "newfile", run: Run::NewFile(dir.into()) });
        }
    }
    actions.push(FileAction { key: "save", title: "收藏到快捷启动", note: String::new(), icon: "star", run: Run::Save(paths.to_vec()) });
    actions
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
        Run::Copy(text, notice) => {
            context::write_text(&text)?;
            crate::relay::notify(notice);
        }
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
            crate::usage::usage_record(app.clone(), item.clone(), None)?;
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
        Run::PinHint => {
            crate::panel::open_query(app, String::new());
            // After the panel's own show / reset handling, which clears its messages.
            std::thread::sleep(std::time::Duration::from_millis(300));
            let _ = app.emit_to("panel", "panel-flash", "右键任意结果，选「固定到超级面板」");
        }
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
/// The page's natural height. The window follows it, up to HEIGHT, still beside the pointer.
#[tauri::command]
pub fn superpanel_resize(app: AppHandle, height: f64) {
    if !height.is_finite() || height <= 0.0 {
        return;
    }
    let height = height.ceil().min(HEIGHT);
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = app.run_on_main_thread(move || {
            let cursor = *CURSOR.lock().unwrap();
            crate::window_position::place_at_cursor(&w, cursor, (WIDTH, height));
        });
    }
}
fn same_pin(a: &SearchItem, b: &SearchItem) -> bool {
    a.plugin == b.plugin && a.action == b.action
}
/// Pins `item` to 我的面板, or removes it when already there. Returns whether it is pinned.
fn toggle_pin(pinned: &mut Vec<SearchItem>, mut item: SearchItem) -> Result<bool, String> {
    normalize_pin(&mut item);
    if item.plugin == "superpanel" {
        return Err("超级面板不能固定到自己".into());
    }
    if let Some(i) = pinned.iter().position(|p| same_pin(p, &item)) {
        pinned.remove(i);
        return Ok(false);
    }
    if pinned.len() >= 12 {
        return Err("我的面板最多放 12 个功能，请先移除一个".into());
    }
    pinned.push(item);
    Ok(true)
}
#[tauri::command]
pub fn superpanel_toggle_pin(app: AppHandle, item: SearchItem) -> Result<bool, String> {
    let mut cfg = config::load(&app);
    let pinned = toggle_pin(&mut cfg.super_panel.pinned, item)?;
    config::config_set(app, cfg)?;
    Ok(pinned)
}
/// 「移到最前」 from the panel's right-click menu; `index` is the cell's place in the saved list.
#[tauri::command]
pub fn superpanel_pin_first(app: AppHandle, index: usize) -> Result<(), String> {
    let mut cfg = config::load(&app);
    if index >= cfg.super_panel.pinned.len() {
        return Err("这个功能已不在我的面板里".into());
    }
    let item = cfg.super_panel.pinned.remove(index);
    cfg.super_panel.pinned.insert(0, item);
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
            runners: vec![("copy".into(), Run::Copy("snapshot text".into(), "已复制"))],
        });
        assert!(accept(&mut session, 6, "copy").is_err());
        assert!(session.is_some());
        assert!(accept(&mut session, 7, "unknown").is_err());
        assert!(session.is_some());
        assert!(matches!(accept(&mut session,7,"copy"),Ok(Run::Copy(s, _)) if s=="snapshot text"));
        assert!(accept(&mut session, 7, "copy").is_err());
    }
    #[test]
    fn finder_selection_copies_paths_and_names_once_without_the_search_panel() {
        let paths = vec!["/tmp/第一 个.png".to_string(), "/tmp/文件夹/".to_string()];
        let actions = file_actions(&paths, Some("/tmp"));
        let copies: Vec<_> = actions.iter().filter_map(|a| match &a.run { Run::Copy(text, notice) => Some((a.title, text.as_str(), *notice)), _ => None }).collect();
        assert_eq!(copies, [
            ("复制路径", "/tmp/第一 个.png\n/tmp/文件夹/", "已复制路径"),
            ("复制文件名", "第一 个.png\n文件夹", "已复制文件名"),
        ]);
        assert_eq!(actions[0].note, "2 项");
        assert!(actions.iter().any(|a| a.key == "terminal"));
        // Not a single folder: no new file.
        assert!(!actions.iter().any(|a| a.key == "new"));
        assert!(file_actions(&[], Some("/tmp")).is_empty());
        // The launcher's own copy features are hidden from 匹配的功能, others stay.
        let registry = Registry::new();
        let matched = registry.context_matches(None, &paths[..1]);
        assert!(matched.iter().any(|i| i.plugin == "launcher" && duplicates_file_action(i)));
        let shown: Vec<_> = matched.iter().filter(|i| !duplicates_file_action(i)).map(|i| i.title.as_str()).collect();
        assert!(shown.contains(&"识别二维码"), "{shown:?}");
        assert!(!shown.contains(&"复制文件路径") && !shown.contains(&"提取文件名称"), "{shown:?}");
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
    fn pins_toggle_by_identity_and_stop_at_twelve() {
        let mut pinned = vec![];
        let mut qr = feature("qrcode", "generate", "为「hi」生成二维码");
        if let ItemAction::Feature { input, .. } = &mut qr.action {
            *input = Some("hi".into());
        }
        assert!(toggle_pin(&mut pinned, qr.clone()).unwrap());
        // Pinned without the selected text, under the feature's own name.
        assert_eq!(pinned[0].title, "生成二维码");
        assert_eq!(pinned[0].action, ItemAction::Feature { feature: "generate".into(), input: None });
        assert!(!toggle_pin(&mut pinned, qr).unwrap());
        assert!(pinned.is_empty());
        assert!(toggle_pin(&mut pinned, feature("superpanel", "open", "超级面板")).is_err());
        for i in 0..12 {
            toggle_pin(&mut pinned, SearchItem { action: ItemAction::OpenPath { path: format!("/tmp/{i}") }, ..feature("launcher", "", "x") }).unwrap();
        }
        assert!(toggle_pin(&mut pinned, feature("system", "lock", "锁屏")).is_err());
        assert_eq!(pinned.len(), 12);
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
