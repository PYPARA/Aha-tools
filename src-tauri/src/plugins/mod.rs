//! Plugin registry.
//!
//! A plugin is a directory under `/plugins/<id>/` with a `plugin.json` manifest and
//! React views. Plugins that need native code add a module here and, if they produce
//! search results, a `SearchProvider`.
//!
//! Built-in plugins are compiled in. External plugins (loaded from disk at runtime)
//! will use the same manifest format.

pub mod launcher;
pub mod compress;
pub mod qrcode;
pub mod webapps;

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::thread;

use fuzzy_matcher::FuzzyMatcher;
use fuzzy_matcher::skim::SkimMatcherV2;
use pinyin::ToPinyin;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

const BUILTIN_MANIFESTS: &[&str] = &[
    include_str!("../../../plugins/launcher/plugin.json"),
    include_str!("../../../plugins/hotkeys/plugin.json"),
    include_str!("../../../plugins/screenshot/plugin.json"),
    include_str!("../../../plugins/webapps/plugin.json"),
    include_str!("../../../plugins/qrcode/plugin.json"),
    include_str!("../../../plugins/compress/plugin.json"),
    include_str!("../../../plugins/settings/plugin.json"),
];

/// Search options from config.json, set by `configure`.
struct Options {
    pinyin: bool,
    disabled_matches: Vec<String>,
    web_apps: Vec<crate::config::WebApp>,
}

static OPTIONS: RwLock<Options> = RwLock::new(Options {
    pinyin: true,
    disabled_matches: vec![],
    web_apps: vec![],
});

pub fn configure(cfg: &crate::config::Config) {
    *OPTIONS.write().unwrap() = Options {
        pinyin: cfg.pinyin,
        disabled_matches: cfg.disabled_matches.clone(),
        web_apps: cfg.web_apps.clone(),
    };
}

fn web_apps() -> Vec<crate::config::WebApp> {
    OPTIONS.read().unwrap().web_apps.clone()
}

/// "微信" → ["weixin", "wx"]; empty when `text` has no Chinese characters.
fn pinyin_forms(text: &str) -> Vec<String> {
    let mut full = String::new();
    let mut initials = String::new();
    let mut any = false;
    for (c, p) in text.chars().zip(text.to_pinyin()) {
        match p {
            Some(p) => {
                any = true;
                full.push_str(p.plain());
                initials.push_str(p.first_letter());
            }
            None if c.is_alphanumeric() => {
                let lower = c.to_ascii_lowercase();
                full.push(lower);
                initials.push(lower);
            }
            None => {}
        }
    }
    if any { vec![full, initials] } else { vec![] }
}

/// Fuzzy score of `query` against `text`, also trying its pinyin when that's switched on.
pub fn match_text(matcher: &SkimMatcherV2, text: &str, query: &str) -> Option<i64> {
    let direct = matcher.fuzzy_match(text, query);
    if !query.is_ascii() || !OPTIONS.read().unwrap().pinyin {
        return direct;
    }
    pinyin_forms(text)
        .iter()
        .filter_map(|p| matcher.fuzzy_match(p, query))
        .max()
        .max(direct)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// Contributes results to every search via a native `SearchProvider`.
    #[serde(default)]
    pub search_provider: bool,
    #[serde(default)]
    pub features: Vec<Feature>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    /// Matches a view registered under `<plugin id>/<code>` in the frontend.
    pub code: String,
    pub explain: String,
    /// Keywords that surface this feature in search. "<cmd> <text>" passes the text along.
    pub cmds: Vec<String>,
    /// Content this feature accepts as input; matching queries list it after other results.
    #[serde(default, rename = "match", skip_serializing_if = "Option::is_none")]
    pub matches: Option<Match>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    /// Any text of at least `min_length` characters.
    #[serde(default)]
    pub text: bool,
    #[serde(default)]
    pub min_length: usize,
    /// Text matching this regex (whole query).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regex: Option<String>,
    /// Dropped files with these extensions (lowercase, no dot). Handled by the panel.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
}

impl Match {
    fn accepts(&self, query: &str) -> bool {
        if query.chars().count() < self.min_length.max(1) {
            return false;
        }
        if self.text {
            return true;
        }
        self.regex
            .as_deref()
            .and_then(|r| Regex::new(r).ok())
            .is_some_and(|re| re.is_match(query))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    pub title: String,
    pub subtitle: String,
    pub score: i64,
    pub plugin: String,
    pub kind: ItemKind,
    /// For saved paths: "folder", "file" or "link". For web apps: the site URL, for its icon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub action: ItemAction,
}

/// What the result is, for its icon and label in the list.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    App,
    Saved,
    Feature,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ItemAction {
    /// Open a file, folder, app or URL with the system default handler.
    OpenPath { path: String },
    /// Show a web app's window (crate::webapps).
    OpenWeb { id: String },
    /// Enter a plugin feature's view, optionally with text for it to work on.
    Feature {
        feature: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input: Option<String>,
    },
}

pub trait SearchProvider: Send + Sync {
    fn search(&self, query: &str, matcher: &SkimMatcherV2) -> Vec<SearchItem>;
    /// Called in the background each time the panel opens.
    fn refresh(&self) {}
}

pub struct Registry {
    pub manifests: Vec<Manifest>,
    providers: HashMap<String, Arc<dyn SearchProvider>>,
}

const MAX_RESULTS: usize = 30;
/// "<cmd> <text>": the feature was asked for by name, so it goes first.
const CMD_WITH_INPUT_SCORE: i64 = 10_000;
/// Content matches ("translate this text") go after every named result.
const CONTENT_MATCH_SCORE: i64 = -1;

impl Registry {
    pub fn new() -> Self {
        let manifests = BUILTIN_MANIFESTS
            .iter()
            .map(|s| serde_json::from_str(s).expect("invalid built-in plugin.json"))
            .collect();
        Registry {
            manifests,
            providers: HashMap::new(),
        }
    }

    pub fn add_provider(&mut self, plugin_id: &str, provider: Arc<dyn SearchProvider>) {
        self.providers.insert(plugin_id.to_string(), provider);
    }

    pub fn search(&self, query: &str) -> Vec<SearchItem> {
        let disabled = OPTIONS.read().unwrap().disabled_matches.clone();
        self.search_with_disabled(query, &disabled)
    }

    fn search_with_disabled(&self, query: &str, disabled: &[String]) -> Vec<SearchItem> {
        let query = query.trim();
        if query.is_empty() {
            return vec![];
        }
        let matcher = SkimMatcherV2::default().ignore_case();
        let mut items = vec![];

        // "fy hello" → the feature whose cmd is "fy", with input "hello".
        let cmd_input = query
            .split_once(char::is_whitespace)
            .map(|(cmd, rest)| (cmd, rest.trim()))
            .filter(|(_, rest)| !rest.is_empty());

        for m in &self.manifests {
            for f in &m.features {
                let feature_item = |score: i64, input: Option<&str>| SearchItem {
                    title: if m.id == "qrcode" && f.code == "generate" && score == CONTENT_MATCH_SCORE {
                        format!("为「{}」生成二维码", preview(input.unwrap_or("")))
                    } else {
                        f.explain.clone()
                    },
                    subtitle: match input {
                        Some(text) => format!("{} · 「{}」", m.name, preview(text)),
                        None => format!("{} · 插件功能", m.name),
                    },
                    score,
                    plugin: m.id.clone(),
                    kind: ItemKind::Feature,
                    icon: None,
                    action: ItemAction::Feature {
                        feature: f.code.clone(),
                        input: input.map(str::to_string),
                    },
                };

                if let Some((cmd, rest)) = cmd_input {
                    if f.cmds.iter().any(|c| c.eq_ignore_ascii_case(cmd)) {
                        items.push(feature_item(CMD_WITH_INPUT_SCORE, Some(rest)));
                        continue;
                    }
                }
                let best = f
                    .cmds
                    .iter()
                    .filter_map(|cmd| match_text(&matcher, cmd, query))
                    .max();
                let key = format!("{}/{}", m.id, f.code);
                if let Some(score) = best {
                    // Plugin features rank above files for the same match quality.
                    items.push(feature_item(score + 20, None));
                } else if f.matches.as_ref().is_some_and(|mt| mt.accepts(query))
                    && !disabled.contains(&key)
                {
                    items.push(feature_item(CONTENT_MATCH_SCORE, Some(query)));
                }
            }
            if m.search_provider {
                if let Some(p) = self.providers.get(&m.id) {
                    items.extend(p.search(query, &matcher));
                }
            }
        }

        items.sort_by(|a, b| b.score.cmp(&a.score));
        items.truncate(MAX_RESULTS);
        items
    }
}

pub fn on_panel_shown<R: Runtime>(app: &AppHandle<R>) {
    let Some(registry) = app.try_state::<Registry>() else {
        return;
    };
    for p in registry.providers.values() {
        let p = p.clone();
        thread::spawn(move || p.refresh());
    }
}

/// First line of `text`, cut to 24 characters, for a result subtitle.
fn preview(text: &str) -> String {
    let line = text.lines().next().unwrap_or("");
    let mut out: String = line.chars().take(24).collect();
    if line.chars().count() > 24 || text.lines().nth(1).is_some() {
        out.push('…');
    }
    out
}

#[tauri::command]
pub fn list_plugins(registry: State<Registry>) -> Vec<Manifest> {
    registry.manifests.clone()
}

#[tauri::command]
pub fn search(registry: State<Registry>, query: String) -> Vec<SearchItem> {
    registry.search(&query)
}

fn match_files(registry: &Registry, paths: &[String], disabled: &[String]) -> Vec<SearchItem> {
    let expanded = compress::expand_paths(paths);
    registry.manifests.iter().flat_map(|manifest| manifest.features.iter().filter_map(|feature| {
        let extensions = &feature.matches.as_ref()?.files;
        if extensions.is_empty() || disabled.contains(&format!("{}/{}", manifest.id, feature.code)) { return None; }
        let count = expanded.iter().filter(|p| p.is_file() && p.extension().and_then(|e| e.to_str()).is_some_and(|e| extensions.iter().any(|x| x.eq_ignore_ascii_case(e)))).count();
        if count == 0 { return None; }
        Some(SearchItem {
            title: feature.explain.clone(), subtitle: format!("{} · {count} 张图片", manifest.name), score: 0,
            plugin: manifest.id.clone(), kind: ItemKind::Feature, icon: None,
            action: ItemAction::Feature { feature: feature.code.clone(), input: Some(serde_json::to_string(&expanded).unwrap()) },
        })
    })).collect()
}

#[tauri::command]
pub async fn search_files(registry: State<'_, Registry>, paths: Vec<String>) -> Result<Vec<SearchItem>, String> {
    let manifests = registry.manifests.clone();
    let disabled = OPTIONS.read().unwrap().disabled_matches.clone();
    tauri::async_runtime::spawn_blocking(move || match_files(&Registry { manifests, providers: HashMap::new() }, &paths, &disabled))
        .await.map_err(|e| format!("无法读取拖入的文件：{e}"))
}

/// "~/x" → "$HOME/x"; anything else unchanged.
pub fn expand_home(path: &str) -> String {
    match (path.strip_prefix("~/"), std::env::var("HOME")) {
        (Some(rest), Ok(home)) => format!("{home}/{rest}"),
        _ => path.to_string(),
    }
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    // `open` doesn't expand "~"; saved paths may be typed by hand.
    let target = expand_home(&path);
    std::process::Command::new("open")
        .arg(&target)
        .spawn()
        .map_err(|e| format!("无法打开 {path}: {e}"))?;
    crate::panel::hide(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry_with(feature: &str) -> Registry {
        let manifest =
            format!(r#"{{"id":"t","name":"测试","version":"0","features":[{feature}]}}"#);
        Registry {
            manifests: vec![serde_json::from_str(&manifest).unwrap()],
            providers: HashMap::new(),
        }
    }

    fn input_of(item: &SearchItem) -> Option<&str> {
        match &item.action {
            ItemAction::Feature { input, .. } => input.as_deref(),
            _ => None,
        }
    }

    #[test]
    fn file_matches_expand_directories_and_respect_disabled_without_losing_commands() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.PNG"), b"image").unwrap();
        std::fs::write(dir.path().join("b.jpg"), b"image").unwrap();
        std::fs::write(dir.path().join("skip.svg"), b"svg").unwrap();
        std::fs::create_dir(dir.path().join("nested")).unwrap();
        std::fs::write(dir.path().join("nested/skip.png"), b"nested").unwrap();
        let r = Registry::new();
        let paths = vec![dir.path().to_string_lossy().into_owned(), dir.path().join("a.PNG").to_string_lossy().into_owned()];
        let items = match_files(&r, &paths, &[]);
        assert_eq!(items.len(), 1); assert_eq!(items[0].plugin, "compress");
        assert!(items[0].subtitle.contains("2 张图片"));
        let input: Vec<String> = serde_json::from_str(input_of(&items[0]).unwrap()).unwrap();
        assert_eq!(input.len(), 2);
        assert!(match_files(&r, &paths, &["compress/compress".into()]).is_empty());
        for cmd in ["压缩", "图片压缩", "compress", "tinypng"] {
            assert!(r.search_with_disabled(cmd, &["compress/compress".into()]).iter().any(|i| i.plugin == "compress"));
        }
    }

    #[test]
    fn cmd_with_text_passes_input_and_ranks_first() {
        let r = registry_with(r#"{"code":"tr","explain":"翻译","cmds":["fy","翻译"]}"#);
        let items = r.search("fy hello world");
        assert_eq!(items.len(), 1);
        assert_eq!(input_of(&items[0]), Some("hello world"));
        assert_eq!(items[0].score, CMD_WITH_INPUT_SCORE);
    }

    #[test]
    fn content_match_ranks_last_with_whole_query() {
        let r = registry_with(
            r#"{"code":"qr","explain":"生成二维码","cmds":["二维码"],"match":{"text":true,"minLength":3}}"#,
        );
        assert!(r.search("ab").is_empty());
        let items = r.search("https://example.com");
        assert_eq!(input_of(&items[0]), Some("https://example.com"));
        assert_eq!(items[0].score, CONTENT_MATCH_SCORE);
    }

    #[test]
    fn pinyin_full_and_initials() {
        assert_eq!(pinyin_forms("微信"), ["weixin", "wx"]);
        assert_eq!(pinyin_forms("QQ邮箱"), ["qqyouxiang", "qqyx"]);
        assert!(pinyin_forms("Safari").is_empty());
        let m = SkimMatcherV2::default().ignore_case();
        assert!(match_text(&m, "截图", "jt").is_some());
    }

    #[test]
    fn regex_match() {
        let r = registry_with(
            r#"{"code":"x","explain":"x","cmds":["zzz"],"match":{"regex":"^\\d+$"}}"#,
        );
        assert_eq!(r.search("12345").len(), 1);
        assert!(r.search("12a").is_empty());
    }

    #[test]
    fn builtin_qrcode_registers_both_features_and_passes_command_input() {
        let r = Registry::new();
        for (code, keywords) in [
            ("generate", vec!["二维码", "qr", "qrcode"]),
            ("scan", vec!["识别二维码", "扫码", "scan"]),
        ] {
            for keyword in keywords {
                assert!(r.search_with_disabled(keyword, &[]).iter().any(|item| {
                    item.plugin == "qrcode"
                        && matches!(&item.action, ItemAction::Feature { feature, input: None } if feature == code)
                }));
            }
        }
        let items = r.search_with_disabled("qr hello", &[]);
        assert_eq!(items[0].plugin, "qrcode");
        assert_eq!(items[0].title, "生成二维码");
        assert_eq!(input_of(&items[0]), Some("hello"));
        assert_eq!(items[0].score, CMD_WITH_INPUT_SCORE);
    }

    #[test]
    fn qrcode_content_match_ranks_last_and_can_be_disabled_without_losing_commands() {
        let r = Registry::new();
        let query = "https://example.com/你好\n第二行";
        let items = r.search_with_disabled(query, &[]);
        let qr = items.iter().find(|it| it.plugin == "qrcode").unwrap();
        assert_eq!(qr.score, CONTENT_MATCH_SCORE);
        assert_eq!(input_of(qr), Some(query));
        assert_eq!(qr.title, "为「https://example.com/你好…」生成二维码");
        assert_eq!(items.last().unwrap().plugin, "qrcode");

        let disabled = ["qrcode/generate".into()];
        assert!(!r.search_with_disabled(query, &disabled).iter().any(|it| it.plugin == "qrcode"));
        let named = r.search_with_disabled("qr hello", &disabled);
        assert_eq!(input_of(&named[0]), Some("hello"));
        assert!(r.search_with_disabled("", &[]).is_empty());
    }
}
