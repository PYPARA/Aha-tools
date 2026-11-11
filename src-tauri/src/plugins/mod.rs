//! Plugin registry.
//!
//! A plugin is a directory under `/plugins/<id>/` with a `plugin.json` manifest and
//! React views. Plugins that need native code add a module here and, if they produce
//! search results, a `SearchProvider`.
//!
//! Built-in plugins are compiled in. External plugins (loaded from disk at runtime)
//! will use the same manifest format.

pub mod detect;
pub mod hosts;
pub mod launcher;
pub mod network;
pub mod processes;
pub mod compress;
pub mod qrcode;
pub mod system;
pub mod translate;
pub mod webapps;

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, RwLock};
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
    include_str!("../../../plugins/hosts/plugin.json"),
    include_str!("../../../plugins/translate/plugin.json"),
    include_str!("../../../plugins/images/plugin.json"),
    include_str!("../../../plugins/settings/plugin.json"),
    include_str!("../../../plugins/system/plugin.json"),
    include_str!("../../../plugins/processes/plugin.json"),
    include_str!("../../../plugins/network/plugin.json"),
    include_str!("../../../plugins/json/plugin.json"),
    include_str!("../../../plugins/superpanel/plugin.json"),
];

static MANIFESTS: LazyLock<Vec<Manifest>> = LazyLock::new(|| {
    BUILTIN_MANIFESTS.iter().map(|s| serde_json::from_str(s).expect("invalid built-in plugin.json")).collect()
});

/// A built-in feature's own name, e.g. 「生成二维码」 for a result titled 「为「hi」生成二维码」.
pub fn feature_explain(plugin: &str, feature: &str) -> Option<String> {
    MANIFESTS.iter().find(|m| m.id == plugin)?.features.iter().find(|f| f.code == feature).map(|f| f.explain.clone())
}

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

/// The query starts the name ("term" → Terminal, "wx" → 微信's initials).
const PREFIX_BONUS: i64 = 60;
/// The query starts a word or the word initials ("chr" → Google Chrome, "vs" → Visual Studio Code).
const WORD_BONUS: i64 = 30;

/// Where words begin in `text`, lowercased from there: after a separator or a lower → upper
/// change ("PyCharm" → "pycharm", "charm").
fn word_starts(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    (0..chars.len())
        .filter(|&i| {
            chars[i].is_alphanumeric()
                && (i == 0 || !chars[i - 1].is_alphanumeric() || (chars[i - 1].is_lowercase() && chars[i].is_uppercase()))
        })
        .map(|i| chars[i..].iter().flat_map(|c| c.to_lowercase()).collect())
        .collect()
}

/// Extra score for where `query` (lowercase) sits in `text`.
fn position_bonus(text: &str, query: &str) -> i64 {
    if text.to_lowercase().starts_with(query) {
        return PREFIX_BONUS;
    }
    let words = word_starts(text);
    let initials: String = words.iter().filter_map(|w| w.chars().next()).collect();
    if words.iter().skip(1).any(|w| w.starts_with(query)) || (words.len() > 1 && initials.starts_with(query)) {
        WORD_BONUS
    } else {
        0
    }
}

/// Fuzzy score of `query` against `text`, also trying its pinyin when that's switched on.
/// Prefix and word-start matches score higher; a single character matches only those, so
/// "c" lists names starting with c rather than every name containing one.
pub fn match_text(matcher: &SkimMatcherV2, text: &str, query: &str) -> Option<i64> {
    let lower = query.to_lowercase();
    let single = query.chars().count() == 1;
    let scored = |text: &str| {
        let score = matcher.fuzzy_match(text, query)?;
        let bonus = position_bonus(text, &lower);
        (!single || bonus > 0).then_some(score + bonus)
    };
    let direct = scored(text);
    if !query.is_ascii() || !OPTIONS.read().unwrap().pinyin {
        return direct;
    }
    pinyin_forms(text).iter().filter_map(|p| scored(p)).max().max(direct)
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
    /// Title when offered for matched text, with `{input}` for a short preview of it,
    /// e.g. 「为「{input}」生成二维码」.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_title: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    /// Raw clipboard images, without a path on disk.
    #[serde(default)]
    pub image: bool,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_files: Option<usize>,
    /// Kinds of text this feature is made for (`detect::kinds`): offered right after
    /// results asked for by name, before ordinary matches.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub types: Vec<String>,
}

impl Match {
    fn type_hit(&self, kinds: &[&str]) -> bool {
        self.types.iter().any(|t| kinds.contains(&t.as_str()))
    }

    /// `kinds`: what the content's text looks like, from `detect::kinds`.
    fn accepts_content(&self, content: &MatchContent, kinds: &[&str]) -> bool {
        match content {
            MatchContent::Text { text } => self.type_hit(kinds) || self.accepts(text),
            MatchContent::Image => self.image,
            MatchContent::Files { paths } => !paths.is_empty() && self.max_files.is_none_or(|max| paths.len() <= max) && paths.iter().all(|path| {
                self.files.iter().any(|extension| extension == "*" || std::path::Path::new(path)
                    .extension().is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case(extension)))
            }),
        }
    }

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

/// Only metadata crosses search IPC. Raw pixels stay in the panel until a feature runs.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MatchContent {
    /// Text too long or multi-line for the search box, carried as an attachment.
    Text { text: String },
    Image,
    Files { paths: Vec<String> },
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
    /// An answer shown right in the list (「ip」 → 192.168.1.10): ↵ copies it.
    Copy { text: String },
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
/// Made for this kind of text (a domain → ping): after named requests, before name matches.
const TYPE_MATCH_SCORE: i64 = 5_000;
/// A provider's direct answer to the query (「ip」 → this Mac's address): above type matches.
pub const ANSWER_SCORE: i64 = 5_100;
/// Content matches ("translate this text") go after every named result.
const CONTENT_MATCH_SCORE: i64 = -1;
/// Name matches scoring under this share of the best one are noise ("c" in "Music").
const KEEP_PERCENT: i64 = 40;

impl Registry {
    pub fn new() -> Self {
        Registry {
            manifests: MANIFESTS.clone(),
            providers: HashMap::new(),
        }
    }

    pub fn add_provider(&mut self, plugin_id: &str, provider: Arc<dyn SearchProvider>) {
        self.providers.insert(plugin_id.to_string(), provider);
    }

    pub fn search(&self, query: &str) -> Vec<SearchItem> {
        let disabled = OPTIONS.read().unwrap().disabled_matches.clone();
        let rank = crate::usage::rank();
        self.search_ranked(query, &disabled, &rank, crate::usage::now())
    }

    #[cfg(test)]
    fn search_with_disabled(&self, query: &str, disabled: &[String]) -> Vec<SearchItem> {
        self.search_ranked(query, disabled, &crate::usage::Rank::default(), 0)
    }

    fn search_ranked(&self, query: &str, disabled: &[String], rank: &crate::usage::Rank, now: u64) -> Vec<SearchItem> {
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

        let kinds = detect::kinds(query);
        for m in &self.manifests {
            for f in &m.features {
                let feature_item = |score: i64, input: Option<&str>| SearchItem {
                    title: match (&f.match_title, input) {
                        (Some(title), Some(text)) if score != CMD_WITH_INPUT_SCORE => title.replace("{input}", &preview(text)),
                        _ => f.explain.clone(),
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
                } else if disabled.contains(&key) {
                } else if f.matches.as_ref().is_some_and(|mt| mt.type_hit(&kinds)) {
                    items.push(feature_item(TYPE_MATCH_SCORE, Some(query)));
                } else if f.matches.as_ref().is_some_and(|mt| mt.accepts(query)) {
                    items.push(feature_item(CONTENT_MATCH_SCORE, Some(query)));
                }
            }
            if m.search_provider {
                if let Some(p) = self.providers.get(&m.id) {
                    items.extend(p.search(query, &matcher));
                }
            }
        }
        rank_items(items, query, rank, now)
    }

    /// Features whose manifest `match` accepts the super panel's context: text, or files.
    /// Same rules and 「自动匹配」 switches as the search panel, in manifest order.
    pub fn context_matches(&self, text: Option<&str>, paths: &[String]) -> Vec<SearchItem> {
        let disabled = OPTIONS.read().unwrap().disabled_matches.clone();
        if !paths.is_empty() {
            return self.content_results(&MatchContent::Files { paths: paths.to_vec() }, "", &disabled);
        }
        let Some(text) = text.map(str::trim).filter(|t| !t.is_empty()) else {
            return vec![];
        };
        let kinds = detect::kinds(text);
        let mut items = vec![];
        for m in &self.manifests {
            for f in &m.features {
                let Some(mt) = f.matches.as_ref() else { continue };
                let typed = mt.type_hit(&kinds);
                if disabled.contains(&format!("{}/{}", m.id, f.code)) || !(typed || mt.accepts(text)) {
                    continue;
                }
                items.push(SearchItem {
                    title: f.explain.clone(),
                    subtitle: m.name.clone(),
                    score: i64::from(typed),
                    plugin: m.id.clone(),
                    kind: ItemKind::Feature,
                    icon: None,
                    action: ItemAction::Feature { feature: f.code.clone(), input: Some(text.to_string()) },
                });
            }
        }
        // Made for this kind of text first; otherwise manifest order.
        items.sort_by(|a, b| b.score.cmp(&a.score));
        items
    }

    fn content_results(&self, content: &MatchContent, query: &str, disabled: &[String]) -> Vec<SearchItem> {
        let matcher = SkimMatcherV2::default().ignore_case();
        let query = query.trim();
        let mut items = vec![];
        let kinds = match content { MatchContent::Text { text } => detect::kinds(text), _ => vec![] };
        // Compression accepts mixed batches and expands one directory level. Other file
        // tools keep the exact attachment snapshot (e.g. copy-path must keep folders).
        let compression_paths = match content {
            MatchContent::Files { paths } if !disabled.iter().any(|id| id == "compress/compress") => {
                let expanded = compress::expand_paths(paths);
                let count = expanded.iter().filter(|p| p.is_file() && compress::supported(p)).count();
                (count > 0).then_some((expanded, count))
            }
            _ => None,
        };
        for manifest in &self.manifests {
            for feature in &manifest.features {
                let is_compression = manifest.id == "compress" && feature.code == "compress";
                let accepts = if is_compression { compression_paths.is_some() }
                    else { feature.matches.as_ref().is_some_and(|m| m.accepts_content(content, &kinds)) };
                let typed = feature.matches.as_ref().is_some_and(|m| m.type_hit(&kinds));
                if disabled.contains(&format!("{}/{}", manifest.id, feature.code)) || !accepts { continue; }
                let score = if query.is_empty() { 0 } else {
                    let Some(score) = feature.cmds.iter().map(String::as_str)
                        .chain([feature.explain.as_str(), manifest.name.as_str()])
                        .filter_map(|name| match_text(&matcher, name, query)).max() else { continue };
                    score
                } + if typed { 1000 } else { 0 };
                let (subtitle, input) = if is_compression {
                    let (paths, count) = compression_paths.as_ref().unwrap();
                    (format!("{} · {count} 张图片", manifest.name), Some(serde_json::to_string(paths).unwrap()))
                } else if let MatchContent::Text { text } = content {
                    (manifest.name.clone(), Some(text.clone()))
                } else { (manifest.name.clone(), None) };
                items.push(SearchItem {
                    title: if is_compression { format!("{} · {} 张", feature.explain, compression_paths.as_ref().unwrap().1) } else { feature.explain.clone() }, subtitle, score,
                    plugin: manifest.id.clone(), kind: ItemKind::Feature, icon: None,
                    action: ItemAction::Feature { feature: feature.code.clone(), input },
                });
            }
        }
        items.sort_by(|a, b| b.score.cmp(&a.score));
        items
    }
}

/// Name matches: drops the noise, adds what usage taught, then orders them stably.
/// "<cmd> <text>" requests stay first and content matches stay last.
fn rank_items(items: Vec<SearchItem>, query: &str, rank: &crate::usage::Rank, now: u64) -> Vec<SearchItem> {
    let named = |score: i64| (0..TYPE_MATCH_SCORE).contains(&score);
    let best = items.iter().map(|i| i.score).filter(|&s| named(s)).max().unwrap_or(0);
    let mut ranked: Vec<(SearchItem, u64)> = items
        .into_iter()
        .filter_map(|mut item| {
            let key = crate::usage::key(&item);
            // An earlier pick for this query keeps a weak match.
            if named(item.score) && item.score * 100 < best * KEEP_PERCENT && rank.pick(&key, query) == 0 {
                return None;
            }
            // Type matches learn too (ping over DNS lookup), within their own band.
            if (0..CMD_WITH_INPUT_SCORE).contains(&item.score) {
                item.score += rank.boost(&key, query, now);
            }
            Some((item, rank.last_used(&key)))
        })
        .collect();
    ranked.sort_by(|(a, a_used), (b, b_used)| {
        b.score
            .cmp(&a.score)
            .then(b_used.cmp(a_used))
            .then(a.title.chars().count().cmp(&b.title.chars().count()))
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.subtitle.cmp(&b.subtitle))
    });
    ranked.truncate(MAX_RESULTS);
    ranked.into_iter().map(|(item, _)| item).collect()
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
pub async fn search(registry: State<'_, Registry>, query: String, content: Option<MatchContent>) -> Result<Vec<SearchItem>, String> {
    if let Some(content) = content {
        let manifests = registry.manifests.clone();
        let disabled = OPTIONS.read().unwrap().disabled_matches.clone();
        tauri::async_runtime::spawn_blocking(move || {
            Registry { manifests, providers: HashMap::new() }.content_results(&content, &query, &disabled)
        }).await.map_err(|e| format!("无法读取输入内容：{e}"))
    } else { Ok(registry.search(&query)) }
}

/// Compatibility entry for path-only callers such as a future super panel.
#[tauri::command]
pub async fn search_files(registry: State<'_, Registry>, paths: Vec<String>) -> Result<Vec<SearchItem>, String> {
    search(registry, String::new(), Some(MatchContent::Files { paths })).await
}

/// "~/x" → "$HOME/x"; anything else unchanged.
pub fn expand_home(path: &str) -> String {
    match (path.strip_prefix("~/"), std::env::var("HOME")) {
        (Some(rest), Ok(home)) => format!("{home}/{rest}"),
        _ => path.to_string(),
    }
}

/// Selects the file or folder in a Finder window.
#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    let target = expand_home(path.trim());
    if !std::path::Path::new(&target).exists() {
        return Err(format!("找不到「{path}」"));
    }
    std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(&target)
        .spawn()
        .map_err(|e| format!("无法在访达中显示：{e}"))?;
    crate::panel::hide(&app);
    Ok(())
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
        let content = MatchContent::Files { paths };
        let items = r.content_results(&content, "", &[]);
        let compression = items.iter().find(|item| item.plugin == "compress").unwrap();
        assert_eq!(compression.title, "压缩图片 · 2 张");
        assert!(compression.subtitle.contains("2 张图片"));
        let input: Vec<String> = serde_json::from_str(input_of(compression).unwrap()).unwrap();
        assert_eq!(input.len(), 2);
        assert!(!r.content_results(&content, "", &["compress/compress".into()]).iter().any(|i| i.plugin == "compress"));
        assert!(items.iter().any(|i| i.plugin == "launcher"));
        assert_eq!(r.content_results(&content, "compress", &[]).len(), 1);
        assert!(!items.iter().any(|i| i.plugin == "qrcode"));
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
    fn builtin_translate_matches_keywords_and_text_and_can_be_disabled() {
        let r = Registry::new();
        for cmd in ["翻译", "fy", "translate"] {
            assert!(r.search_with_disabled(cmd, &[]).iter().any(|i| i.plugin == "translate"));
        }
        let named = r.search_with_disabled("fy hello", &[]);
        assert_eq!(named[0].plugin, "translate");
        assert_eq!(input_of(&named[0]), Some("hello"));
        let query = "hello world from a language tool";
        let matched = r.search_with_disabled(query, &[]);
        assert!(matched.iter().any(|i| i.plugin == "translate" && i.score == CONTENT_MATCH_SCORE && input_of(i) == Some(query)));
        assert!(!r.search_with_disabled("x", &[]).iter().any(|i| i.plugin == "translate"));
        assert!(!r.search_with_disabled(query, &["translate/translate".into()]).iter().any(|i| i.plugin == "translate"));
        assert_eq!(r.search_with_disabled("fy hello", &["translate/translate".into()])[0].plugin, "translate");
    }

    #[test]
    fn context_matches_follow_manifest_rules() {
        let registry = Registry::new();
        let text: Vec<_> = registry.context_matches(Some("hello world"), &[]).iter().map(|i| format!("{}/{}", i.plugin, i.title)).collect();
        assert!(text.contains(&"translate/翻译".to_string()), "{text:?}");
        assert!(text.contains(&"qrcode/生成二维码".to_string()), "{text:?}");
        // One character is below translate's minLength.
        assert!(!registry.context_matches(Some("a"), &[]).iter().any(|i| i.plugin == "translate"));
        assert!(registry.context_matches(Some("   "), &[]).is_empty());
        let image = registry.context_matches(None, &["/tmp/a.png".into()]);
        assert!(image.iter().any(|i| i.plugin == "qrcode" && i.title == "识别二维码"), "{:?}", image.iter().map(|i| &i.title).collect::<Vec<_>>());
        assert!(image.iter().all(|i| i.plugin != "translate"));
        let two = registry.context_matches(None, &["/tmp/a.png".into(), "/tmp/b.png".into()]);
        assert!(!two.iter().any(|i| i.plugin == "qrcode"));
    }

    /// Apps found by name, like the launcher.
    struct Apps(Vec<&'static str>);
    impl SearchProvider for Apps {
        fn search(&self, query: &str, matcher: &SkimMatcherV2) -> Vec<SearchItem> {
            self.0.iter().filter_map(|name| Some(app_item(name, match_text(matcher, name, query)?))).collect()
        }
    }
    fn app_item(name: &str, score: i64) -> SearchItem {
        SearchItem {
            title: name.into(), subtitle: format!("/Applications/{name}.app"), score, plugin: "launcher".into(),
            kind: ItemKind::App, icon: None, action: ItemAction::OpenPath { path: format!("/Applications/{name}.app") },
        }
    }
    fn apps(names: Vec<&'static str>) -> Registry {
        let manifest = r#"{"id":"launcher","name":"快捷启动","version":"0","searchProvider":true,"features":[]}"#;
        let mut registry = Registry { manifests: vec![serde_json::from_str(manifest).unwrap()], providers: HashMap::new() };
        registry.add_provider("launcher", Arc::new(Apps(names)));
        registry
    }
    fn titles(items: &[SearchItem]) -> Vec<&str> {
        items.iter().map(|i| i.title.as_str()).collect()
    }
    const LOCAL_APPS: [&str; 8] = ["Charles", "Cherry Studio", "Google Chrome", "PyCharm", "Music", "Terminal", "Telegram", "Visual Studio Code"];

    #[test]
    fn word_starts_beat_scattered_letters_and_single_letters_need_a_word_start() {
        let r = apps(LOCAL_APPS.to_vec());
        assert_eq!(titles(&r.search_with_disabled("chr", &[]))[0], "Google Chrome");
        assert_eq!(titles(&r.search_with_disabled("term", &[]))[0], "Terminal");
        assert_eq!(titles(&r.search_with_disabled("vs", &[]))[0], "Visual Studio Code");
        let c = r.search_with_disabled("c", &[]);
        // Names starting with c first, then other words starting with c ("Charm" in
        // PyCharm); never a c inside a word ("Music").
        assert_eq!(titles(&c)[..2], ["Charles", "Cherry Studio"]);
        let mut found = titles(&c);
        found.sort();
        assert_eq!(found, ["Charles", "Cherry Studio", "Google Chrome", "PyCharm", "Visual Studio Code"]);
        // Equal scores keep a stable order from one search to the next.
        assert_eq!(titles(&c), titles(&r.search_with_disabled("c", &[])));
    }

    #[test]
    fn earlier_picks_and_frequent_use_lift_results() {
        let r = apps(LOCAL_APPS.to_vec());
        let mut usage = crate::usage::Usage::default();
        crate::usage::record(&mut usage, app_item("Charles", 0), "chr", 100);
        let rank = crate::usage::Rank::from_usage(&usage);
        // Picked with "chr": first for "chr", and for "ch" on the way to typing it.
        assert_eq!(titles(&r.search_ranked("chr", &[], &rank, 200))[0], "Charles");
        assert_eq!(titles(&r.search_ranked("ch", &[], &rank, 200))[0], "Charles");
        // Used often from the home grid: wins a tie among single-letter matches.
        let mut usage = crate::usage::Usage::default();
        for t in 0..10 {
            crate::usage::record(&mut usage, app_item("PyCharm", 0), "", t);
        }
        let rank = crate::usage::Rank::from_usage(&usage);
        assert_eq!(titles(&r.search_ranked("c", &[], &rank, 10))[0], "PyCharm");
        // Unused for months, it falls back behind the prefix matches.
        assert_ne!(titles(&r.search_ranked("c", &[], &rank, 120 * 86_400))[0], "PyCharm");
    }

    #[test]
    fn named_commands_stay_first_and_content_matches_stay_last() {
        let mut r = apps(vec!["Fyne"]);
        r.manifests.extend(Registry::new().manifests.into_iter().filter(|m| m.id == "translate"));
        let mut usage = crate::usage::Usage::default();
        for t in 0..30 {
            crate::usage::record(&mut usage, app_item("Fyne", 0), "fy", t);
        }
        let rank = crate::usage::Rank::from_usage(&usage);
        let items = r.search_ranked("fy hello", &[], &rank, 30);
        assert_eq!(items[0].plugin, "translate");
        assert_eq!(items[0].score, CMD_WITH_INPUT_SCORE);
        let text = r.search_ranked("hello world", &[], &rank, 30);
        assert!(text.iter().all(|i| i.score == CONTENT_MATCH_SCORE));
    }

    #[test]
    fn position_bonus_uses_prefix_words_initials_and_pinyin() {
        assert_eq!(position_bonus("Terminal", "term"), PREFIX_BONUS);
        assert_eq!(position_bonus("Google Chrome", "chr"), WORD_BONUS);
        assert_eq!(position_bonus("Visual Studio Code", "vsc"), WORD_BONUS);
        assert_eq!(position_bonus("PyCharm", "char"), WORD_BONUS);
        assert_eq!(position_bonus("Charles", "chr"), 0);
        let m = SkimMatcherV2::default().ignore_case();
        // "wx" starts 微信's initials; "w" alone still finds it, "x" does not.
        assert!(match_text(&m, "微信", "wx").unwrap() >= match_text(&m, "企业微信", "wx").unwrap());
        assert!(match_text(&m, "微信", "w").is_some());
        assert!(match_text(&m, "微信", "x").is_none());
    }

    #[test]
    fn typed_text_offers_features_made_for_it_after_named_requests() {
        let mut r = apps(vec!["github.com 笔记"]);
        r.manifests.push(serde_json::from_str(r#"{"id":"net","name":"网络","version":"0","features":[
            {"code":"ping","explain":"Ping","cmds":["ping"],"match":{"types":["domain","ip"]},"matchTitle":"ping {input}"},
            {"code":"fmt","explain":"格式化 JSON","cmds":["json"],"match":{"types":["json"]}}]}"#).unwrap());
        r.manifests.extend(Registry::new().manifests.into_iter().filter(|m| m.id == "translate"));
        let items = r.search_with_disabled("github.com", &[]);
        assert_eq!(items[0].title, "ping github.com");
        assert_eq!(items[0].score, TYPE_MATCH_SCORE);
        assert_eq!(input_of(&items[0]), Some("github.com"));
        // Name matches still follow; any-text matches stay last.
        assert!(items.iter().any(|i| i.title == "github.com 笔记" && i.score < TYPE_MATCH_SCORE));
        assert_eq!(items.last().unwrap().plugin, "translate");
        // Asking by name still wins, and 自动匹配 switches type matches off too.
        assert_eq!(r.search_with_disabled("ping 10.0.0.1", &[])[0].score, CMD_WITH_INPUT_SCORE);
        assert!(!r.search_with_disabled("github.com", &["net/ping".into()]).iter().any(|i| i.plugin == "net"));
        // Long text as an attachment: matched by kind, carried as the feature's input.
        let json = MatchContent::Text { text: "{\n  \"a\": 1\n}".into() };
        let matched = r.content_results(&json, "", &[]);
        assert_eq!(matched[0].title, "格式化 JSON");
        assert_eq!(input_of(&matched[0]), Some("{\n  \"a\": 1\n}"));
        assert!(matched.iter().any(|i| i.plugin == "translate"));
    }

    #[test]
    fn builtin_launcher_opens_urls_and_reveals_paths() {
        let r = Registry::new();
        let url = r.search_with_disabled("https://example.com", &[]);
        assert_eq!(url[0].title, "在浏览器中打开「https://example.com」");
        let path = r.search_with_disabled("/Applications", &[]);
        assert_eq!(path[0].title, "在访达中显示「/Applications」");
        // The super panel puts features made for the text first.
        let context = r.context_matches(Some("https://example.com"), &[]);
        assert_eq!(context[0].title, "在浏览器中打开");
        assert_eq!(feature_explain("qrcode", "generate").as_deref(), Some("生成二维码"));
        assert_eq!(feature_explain("qrcode", "missing"), None);
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
        assert!(items.iter().filter(|it| it.score < 0).all(|it| it.score == CONTENT_MATCH_SCORE));

        let disabled = ["qrcode/generate".into()];
        assert!(
            !r.search_with_disabled(query, &disabled)
                .iter()
                .any(|it| it.plugin == "qrcode")
        );
        let named = r.search_with_disabled("qr hello", &disabled);
        assert_eq!(input_of(&named[0]), Some("hello"));
        assert!(r.search_with_disabled("", &[]).is_empty());
    }

    #[test]
    fn pasted_image_matches_real_features_and_respects_switches_and_filter() {
        let registry = Registry::new();
        let content = MatchContent::Image;
        let items = registry.content_results(&content, "", &[]);
        assert_eq!(items.iter().map(|it| it.title.as_str()).collect::<Vec<_>>(), ["识别二维码", "保存图片为 PNG", "复制图片"]);
        assert!(items.iter().all(|it| input_of(it).is_none()));
        let disabled = ["qrcode/scan".into()];
        assert_eq!(registry.content_results(&content, "", &disabled).len(), 2);
        assert!(registry.content_results(&content, "scan", &disabled).is_empty());
        assert_eq!(registry.content_results(&content, "scan", &[])[0].title, "识别二维码");
        assert!(registry.content_results(&content, "微信", &[]).is_empty());
        assert!(registry.search_with_disabled("scan", &disabled).iter().any(|it| it.title == "识别二维码"));
    }

    #[test]
    fn file_matching_uses_every_extension_and_never_treats_paths_as_image_pixels() {
        let registry = Registry::new();
        for extension in ["PNG", "jpg", "Jpeg", "WebP"] {
            let content = MatchContent::Files { paths: vec![format!("/tmp/含 空格.{extension}")] };
            let titles = registry.content_results(&content, "", &[]).into_iter().map(|it| it.title).collect::<Vec<_>>();
            assert!(titles.contains(&"识别二维码".into()));
            assert!(titles.contains(&"管理收藏的路径".into()));
            assert!(titles.contains(&"复制文件路径".into()));
            assert!(titles.contains(&"提取文件名称".into()));
            assert!(!titles.contains(&"保存图片为 PNG".into()));
        }
        let mixed = MatchContent::Files { paths: vec!["/tmp/a.png".into(), "/tmp/b.pdf".into()] };
        let items = registry.content_results(&mixed, "", &[]);
        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|item| item.plugin == "launcher"));
        let multiple = MatchContent::Files { paths: vec!["/tmp/a.png".into(), "/tmp/b.png".into()] };
        assert!(!registry.content_results(&multiple, "", &[]).iter().any(|item| item.plugin == "qrcode"));
        assert!(registry.content_results(&MatchContent::Files { paths: vec![] }, "", &[]).is_empty());
    }
}
