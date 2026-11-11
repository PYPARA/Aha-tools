//! Recently used and pinned search results, shown while the search box is empty, plus
//! what search learns from: how often each result is used and which result each query led to.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{LazyLock, Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config;
use crate::plugins::{ItemAction, SearchItem, expand_home};

const STORE: &str = "usage";
/// Three rows of seven in the expanded grid.
const MAX_RECENT: usize = 21;
const MAX_STATS: usize = 1000;
const MAX_PICKS: usize = 500;
/// Longer queries are sentences to translate or similar, not names worth remembering.
const MAX_PICK_QUERY: usize = 24;

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Usage {
    /// Newest first.
    pub recent: Vec<SearchItem>,
    pub pinned: Vec<SearchItem>,
    /// Uses per result, by `key`.
    pub stats: Vec<Stat>,
    /// Which result a query led to.
    pub picks: Vec<Pick>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Stat {
    pub key: String,
    pub count: u32,
    /// Seconds since the Unix epoch.
    pub last: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Pick {
    /// Lowercase, without whitespace.
    pub query: String,
    pub key: String,
    pub count: u32,
    pub last: u64,
}

/// What the search panel's home grid needs; the learning data stays on this side.
#[derive(Serialize)]
pub struct Home {
    pub recent: Vec<SearchItem>,
    pub pinned: Vec<SearchItem>,
}

/// Serializes read-modify-write of usage.json.
static LOCK: Mutex<()> = Mutex::new(());
/// The learning data in memory, so search never reads usage.json.
static RANK: LazyLock<RwLock<Rank>> = LazyLock::new(|| RwLock::new(Rank::default()));

pub fn init(app: &AppHandle) {
    let usage: Usage = config::load_json(app, STORE);
    *RANK.write().unwrap() = Rank::from_usage(&usage);
}

pub fn rank() -> std::sync::RwLockReadGuard<'static, Rank> {
    RANK.read().unwrap()
}

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// A result's identity: its plugin and action without the text it was searched with.
pub fn key(item: &SearchItem) -> String {
    let action = match &item.action {
        ItemAction::Feature { feature, .. } => ItemAction::Feature { feature: feature.clone(), input: None },
        other => other.clone(),
    };
    format!("{}\u{1f}{}", item.plugin, serde_json::to_string(&action).unwrap_or_default())
}

fn normalize_query(query: &str) -> String {
    query.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect()
}

/// Search ranking from usage.json: more use, more recent use and earlier picks for the
/// same query lift a result above others that match the text equally well.
#[derive(Default)]
pub struct Rank {
    stats: HashMap<String, (u32, u64)>,
    /// key → (query, count, last)
    picks: HashMap<String, Vec<(String, u32, u64)>>,
}

/// Picked for exactly this query: above every other ordinary match.
const PICK_EXACT: i64 = 1000;
/// Picked for a query this one extends or begins ("ch" after picking with "chr").
const PICK_RELATED: i64 = 300;
/// Halves every two weeks without use.
const HALF_LIFE_DAYS: f64 = 14.0;

impl Rank {
    pub fn from_usage(usage: &Usage) -> Self {
        let mut rank = Rank::default();
        for s in &usage.stats {
            rank.stats.insert(s.key.clone(), (s.count, s.last));
        }
        for p in &usage.picks {
            rank.picks.entry(p.key.clone()).or_default().push((p.query.clone(), p.count, p.last));
        }
        rank
    }

    /// Extra score for the result `key` when searching `query`.
    pub fn boost(&self, key: &str, query: &str, now: u64) -> i64 {
        let frequency = self.stats.get(key).map_or(0, |&(count, last)| {
            let days = now.saturating_sub(last) as f64 / 86_400.0;
            ((1.0 + count as f64).ln() * 20.0 * 0.5f64.powf(days / HALF_LIFE_DAYS)).round() as i64
        });
        frequency + self.pick(key, query)
    }

    /// The strongest earlier pick of `key` for `query`, 0 when there is none.
    pub fn pick(&self, key: &str, query: &str) -> i64 {
        let query = normalize_query(query);
        if query.is_empty() {
            return 0;
        }
        self.picks.get(key).map_or(0, |picks| {
            picks
                .iter()
                .map(|(picked, count, _)| {
                    let count = i64::from((*count).min(50));
                    if *picked == query {
                        PICK_EXACT + 10 * count
                    } else if picked.starts_with(&query) || query.starts_with(picked.as_str()) {
                        PICK_RELATED + 2 * count
                    } else {
                        0
                    }
                })
                .max()
                .unwrap_or(0)
        })
    }

    pub fn last_used(&self, key: &str) -> u64 {
        self.stats.get(key).map_or(0, |&(_, last)| last)
    }
}

/// What gets stored: a feature opens without the text it was searched with.
fn normalize(mut item: SearchItem) -> SearchItem {
    item.score = 0;
    if let ItemAction::Feature { input, feature } = &mut item.action {
        *input = None;
        // QR content-match titles include input; home entries keep only the command.
        if item.plugin == "qrcode" && feature == "generate" {
            item.title = "生成二维码".into();
        }
        if item.plugin == "compress" && feature == "compress" {
            item.title = "压缩图片".into();
        }
        // "翻译 · 「hello」" or "翻译 · 插件功能" → the plugin name only.
        item.subtitle = item.subtitle.split(" · ").next().unwrap_or("").to_string();
    }
    item
}

fn same(a: &SearchItem, b: &SearchItem) -> bool {
    a.plugin == b.plugin && a.action == b.action
}

/// Apps and files that were deleted since; URLs and features always stay.
fn still_there(item: &SearchItem) -> bool {
    match &item.action {
        ItemAction::OpenPath { path } if path.starts_with('/') || path.starts_with("~/") => {
            Path::new(&expand_home(path)).exists()
        }
        _ => true,
    }
}

fn update(app: &AppHandle, f: impl FnOnce(&mut Usage)) -> Result<Usage, String> {
    let _guard = LOCK.lock().unwrap();
    let mut usage: Usage = config::load_json(app, STORE);
    f(&mut usage);
    config::save_json(app, STORE, &usage)?;
    *RANK.write().unwrap() = Rank::from_usage(&usage);
    Ok(usage)
}

/// Uses `item` at `now`, found by searching `query` (empty from the home grid).
pub(crate) fn record(usage: &mut Usage, item: SearchItem, query: &str, now: u64) {
    // Searched with its own text ("fy hello"): a request, not a name to learn.
    let had_input = matches!(&item.action, ItemAction::Feature { input: Some(_), .. });
    let item = normalize(item);
    let key = key(&item);
    usage.recent.retain(|r| !same(r, &item));
    usage.recent.insert(0, item);
    usage.recent.truncate(MAX_RECENT);

    match usage.stats.iter_mut().find(|s| s.key == key) {
        Some(stat) => {
            stat.count = stat.count.saturating_add(1);
            stat.last = now;
        }
        None => usage.stats.push(Stat { key: key.clone(), count: 1, last: now }),
    }
    if usage.stats.len() > MAX_STATS {
        usage.stats.sort_by(|a, b| b.last.cmp(&a.last));
        usage.stats.truncate(MAX_STATS);
    }

    let query = normalize_query(query);
    if had_input || query.is_empty() || query.chars().count() > MAX_PICK_QUERY {
        return;
    }
    match usage.picks.iter_mut().find(|p| p.query == query && p.key == key) {
        Some(pick) => {
            pick.count = pick.count.saturating_add(1);
            pick.last = now;
        }
        None => usage.picks.push(Pick { query, key, count: 1, last: now }),
    }
    if usage.picks.len() > MAX_PICKS {
        usage.picks.sort_by(|a, b| b.last.cmp(&a.last));
        usage.picks.truncate(MAX_PICKS);
    }
}

fn home(mut usage: Usage) -> Home {
    usage.recent.retain(still_there);
    usage.pinned.retain(still_there);
    Home { recent: usage.recent, pinned: usage.pinned }
}

/// Returns whether the item is pinned afterwards.
fn toggle_pin(usage: &mut Usage, item: SearchItem) -> bool {
    let item = normalize(item);
    let before = usage.pinned.len();
    usage.pinned.retain(|p| !same(p, &item));
    if usage.pinned.len() < before {
        return false;
    }
    usage.pinned.push(item);
    true
}

#[tauri::command]
pub fn usage_forget(app: AppHandle, item: SearchItem) -> Result<(), String> {
    let item = normalize(item);
    update(&app, |u| u.recent.retain(|r| !same(r, &item))).map(|_| ())
}

#[tauri::command]
pub fn usage_home(app: AppHandle) -> Home {
    home(config::load_json(&app, STORE))
}

/// `query`: what was typed in the search box to find `item`, if anything.
#[tauri::command]
pub fn usage_record(app: AppHandle, item: SearchItem, query: Option<String>) -> Result<(), String> {
    update(&app, |u| record(u, item, query.as_deref().unwrap_or(""), now())).map(|_| ())
}

#[tauri::command]
pub fn usage_toggle_pin(app: AppHandle, item: SearchItem) -> Result<bool, String> {
    let mut pinned = false;
    update(&app, |u| pinned = toggle_pin(u, item))?;
    Ok(pinned)
}

/// Move by identity, never replace the saved list with a possibly stale client copy.
fn reorder_pinned(usage: &mut Usage, item: SearchItem, before: Option<SearchItem>) -> Result<(), String> {
    let item = normalize(item);
    let before = before.map(normalize);
    let from = usage.pinned.iter().position(|it| same(it, &item)).ok_or("这个功能已取消固定")?;
    if let Some(before) = &before {
        if same(before, &item) { return Ok(()); }
        if !usage.pinned.iter().any(|it| same(it, before)) { return Err("目标功能已取消固定，请重试".into()); }
    }
    let moved = usage.pinned.remove(from);
    let to = before.as_ref().and_then(|b| usage.pinned.iter().position(|it| same(it, b))).unwrap_or(usage.pinned.len());
    usage.pinned.insert(to, moved);
    Ok(())
}

#[tauri::command]
pub fn usage_reorder_pinned(app: AppHandle, item: SearchItem, before: Option<SearchItem>) -> Result<Home, String> {
    let _guard = LOCK.lock().unwrap();
    let mut usage: Usage = config::load_json(&app, STORE);
    reorder_pinned(&mut usage, item, before)?;
    config::save_json(&app, STORE, &usage)?;
    Ok(home(usage))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::ItemKind;

    fn feature(input: Option<&str>) -> SearchItem {
        SearchItem {
            title: "翻译".into(),
            subtitle: "翻译 · 「hello」".into(),
            score: 10_000,
            plugin: "translate".into(),
            kind: ItemKind::Feature,
            icon: None,
            action: ItemAction::Feature {
                feature: "tr".into(),
                input: input.map(str::to_string),
            },
        }
    }

    #[test]
    fn recent_dedupes_and_drops_input() {
        let mut u = Usage::default();
        record(&mut u, feature(Some("hello")), "fy hello", 1);
        record(&mut u, feature(None), "", 2);
        assert_eq!(u.recent.len(), 1);
        assert_eq!(u.recent[0].subtitle, "翻译");
        assert_eq!(u.recent[0].score, 0);
    }

    #[test]
    fn compress_history_never_persists_imported_file_paths() {
        let mut input = feature(Some(r#"["/Users/me/私密照片.png"]"#));
        input.plugin = "compress".into(); input.title = "压缩图片 · 1 张".into(); input.subtitle = "图片压缩 · 1 张图片".into();
        input.action = ItemAction::Feature { feature: "compress".into(), input: Some(r#"["/Users/me/私密照片.png"]"#.into()) };
        let mut u = Usage::default(); record(&mut u, input.clone(), "", 1); toggle_pin(&mut u, input);
        let json = serde_json::to_string(&u).unwrap();
        assert!(!json.contains("私密照片")); assert!(!json.contains("/Users/me"));
        assert_eq!(u.recent[0].title, "压缩图片");
        assert_eq!(u.pinned[0].title, "压缩图片");
        assert_eq!(u.recent[0].subtitle, "图片压缩");
    }

    #[test]
    fn pin_toggles() {
        let mut u = Usage::default();
        assert!(toggle_pin(&mut u, feature(Some("x"))));
        assert!(!toggle_pin(&mut u, feature(None)));
        assert!(u.pinned.is_empty());
    }

    #[test]
    fn qrcode_recent_and_pins_keep_the_command_without_its_content() {
        let text = "二维码中的原文";
        let item = SearchItem {
            title: format!("为「{text}」生成二维码"),
            subtitle: format!("二维码 · 「{text}」"),
            plugin: "qrcode".into(),
            action: ItemAction::Feature { feature: "generate".into(), input: Some(text.into()) },
            ..feature(None)
        };
        let mut usage = Usage::default();
        record(&mut usage, item.clone(), text, 1);
        toggle_pin(&mut usage, item);
        for saved in [&usage.recent[0], &usage.pinned[0]] {
            assert_eq!(saved.title, "生成二维码");
            assert_eq!(saved.subtitle, "二维码");
        }
        assert!(!serde_json::to_string(&usage).unwrap().contains(text));
    }

    fn named_feature(name: &str) -> SearchItem {
        SearchItem { title: name.into(), action: ItemAction::Feature { feature: name.into(), input: None }, ..feature(None) }
    }

    #[test]
    fn pinned_moves_in_both_directions_and_survives_serialization() {
        let a = named_feature("a"); let b = named_feature("b"); let c = named_feature("c");
        let mut usage = Usage { recent: vec![a.clone()], pinned: vec![a.clone(), b.clone(), c.clone()], ..Usage::default() };
        reorder_pinned(&mut usage, c.clone(), Some(a.clone())).unwrap();
        assert_eq!(usage.pinned.iter().map(|it| it.title.as_str()).collect::<Vec<_>>(), ["c", "a", "b"]);
        reorder_pinned(&mut usage, c, None).unwrap();
        let saved: Usage = serde_json::from_str(&serde_json::to_string(&usage).unwrap()).unwrap();
        assert_eq!(saved.pinned.iter().map(|it| it.title.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
        assert_eq!(saved.recent.len(), 1);
    }

    #[test]
    fn sorting_stale_items_preserves_other_pins_and_rejects_removed_targets() {
        let a = named_feature("a"); let b = named_feature("b"); let c = named_feature("c");
        let mut usage = Usage { pinned: vec![a.clone(), b.clone(), c.clone()], ..Usage::default() };
        let mut with_input = a.clone();
        with_input.action = ItemAction::Feature { feature: "a".into(), input: Some("粘贴内容".into()) };
        reorder_pinned(&mut usage, with_input, Some(c.clone())).unwrap();
        assert_eq!(usage.pinned.iter().map(|it| it.title.as_str()).collect::<Vec<_>>(), ["b", "a", "c"]);
        let before = serde_json::to_string(&usage).unwrap();
        assert!(reorder_pinned(&mut usage, named_feature("missing"), None).is_err());
        assert!(reorder_pinned(&mut usage, a.clone(), Some(named_feature("missing"))).is_err());
        reorder_pinned(&mut usage, a.clone(), Some(a)).unwrap();
        assert_eq!(serde_json::to_string(&usage).unwrap(), before);
    }

    fn app(name: &str) -> SearchItem {
        SearchItem {
            title: name.into(),
            subtitle: format!("/Applications/{name}.app"),
            kind: ItemKind::App,
            plugin: "launcher".into(),
            action: ItemAction::OpenPath { path: format!("/Applications/{name}.app") },
            ..feature(None)
        }
    }

    #[test]
    fn old_usage_files_still_load() {
        let old = r#"{"recent":[],"pinned":[]}"#;
        let usage: Usage = serde_json::from_str(old).unwrap();
        assert!(usage.stats.is_empty() && usage.picks.is_empty());
        let empty: Usage = serde_json::from_str("{}").unwrap();
        assert!(empty.recent.is_empty());
    }

    #[test]
    fn picks_learn_queries_but_not_typed_requests() {
        let mut u = Usage::default();
        let chrome = app("Google Chrome");
        record(&mut u, chrome.clone(), " Chr ", 10);
        record(&mut u, chrome.clone(), "chr", 20);
        record(&mut u, chrome.clone(), "", 30);
        assert_eq!(u.stats, [Stat { key: key(&chrome), count: 3, last: 30 }]);
        assert_eq!(u.picks, [Pick { query: "chr".into(), key: key(&chrome), count: 2, last: 20 }]);
        // "fy hello" found translate with its own text; a long query is a sentence.
        record(&mut u, feature(Some("hello")), "fy hello", 40);
        record(&mut u, app("Notes"), "a sentence that is far too long to be a name", 50);
        assert_eq!(u.picks.len(), 1);
        // The translate feature is the same result with or without the text it carried.
        assert_eq!(key(&feature(Some("a"))), key(&feature(None)));
    }

    #[test]
    fn picks_and_stats_are_capped_by_least_recent_use() {
        let mut u = Usage::default();
        for i in 0..(MAX_PICKS as u64 + 5) {
            record(&mut u, app("Chrome"), &format!("q{i}"), i);
        }
        assert_eq!(u.picks.len(), MAX_PICKS);
        assert!(!u.picks.iter().any(|p| p.query == "q0"));
        assert!(u.picks.iter().any(|p| p.query == format!("q{}", MAX_PICKS + 4)));
        for i in 0..(MAX_STATS as u64 + 3) {
            record(&mut u, app(&format!("App {i}")), "", 1000 + i);
        }
        assert_eq!(u.stats.len(), MAX_STATS);
        assert!(!u.stats.iter().any(|s| s.key == key(&app("Chrome"))));
    }

    #[test]
    fn boost_prefers_the_same_query_then_related_queries_then_frequent_use() {
        let mut u = Usage::default();
        let (chrome, charles) = (app("Google Chrome"), app("Charles"));
        record(&mut u, chrome.clone(), "chr", 100);
        for t in 0..20 {
            record(&mut u, charles.clone(), "", 100 + t);
        }
        let rank = Rank::from_usage(&u);
        let now = 200;
        let (kc, kl) = (key(&chrome), key(&charles));
        // Exact pick beats much more frequent use.
        assert!(rank.boost(&kc, "chr", now) > rank.boost(&kl, "chr", now) + 500);
        // "ch" begins the picked "chr"; "chro" extends it; "x" is unrelated.
        assert!(rank.pick(&kc, "ch") >= PICK_RELATED && rank.pick(&kc, "ch") < PICK_EXACT);
        assert!(rank.pick(&kc, "chro") >= PICK_RELATED);
        assert_eq!(rank.pick(&kc, "x"), 0);
        assert_eq!(rank.pick(&kc, ""), 0);
        // Frequent use counts, and fades without use.
        assert!(rank.boost(&kl, "c", now) > rank.boost(&kc, "zzz", now));
        let later = now + 90 * 86_400;
        assert!(rank.boost(&kl, "c", later) * 4 < rank.boost(&kl, "c", now));
        assert_eq!(rank.last_used(&kl), 119);
        assert_eq!(rank.last_used("missing"), 0);
    }
}
