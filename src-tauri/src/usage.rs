//! Recently used and pinned search results, shown while the search box is empty.

use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config;
use crate::plugins::{ItemAction, SearchItem, expand_home};

const STORE: &str = "usage";
/// Three rows of seven in the expanded grid.
const MAX_RECENT: usize = 21;

#[derive(Serialize, Deserialize, Default)]
pub struct Usage {
    /// Newest first.
    pub recent: Vec<SearchItem>,
    pub pinned: Vec<SearchItem>,
}

/// Serializes read-modify-write of usage.json.
static LOCK: Mutex<()> = Mutex::new(());

/// What gets stored: a feature opens without the text it was searched with.
fn normalize(mut item: SearchItem) -> SearchItem {
    item.score = 0;
    if let ItemAction::Feature { input, feature } = &mut item.action {
        *input = None;
        // QR content-match titles include input; home entries keep only the command.
        if item.plugin == "qrcode" && feature == "generate" {
            item.title = "生成二维码".into();
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
    Ok(usage)
}

fn record(usage: &mut Usage, item: SearchItem) {
    let item = normalize(item);
    usage.recent.retain(|r| !same(r, &item));
    usage.recent.insert(0, item);
    usage.recent.truncate(MAX_RECENT);
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
pub fn usage_home(app: AppHandle) -> Usage {
    let mut usage: Usage = config::load_json(&app, STORE);
    usage.recent.retain(still_there);
    usage.pinned.retain(still_there);
    usage
}

#[tauri::command]
pub fn usage_record(app: AppHandle, item: SearchItem) -> Result<(), String> {
    update(&app, |u| record(u, item)).map(|_| ())
}

#[tauri::command]
pub fn usage_toggle_pin(app: AppHandle, item: SearchItem) -> Result<bool, String> {
    let mut pinned = false;
    update(&app, |u| pinned = toggle_pin(u, item))?;
    Ok(pinned)
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
        record(&mut u, feature(Some("hello")));
        record(&mut u, feature(None));
        assert_eq!(u.recent.len(), 1);
        assert_eq!(u.recent[0].subtitle, "翻译");
        assert_eq!(u.recent[0].score, 0);
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
        record(&mut usage, item.clone());
        toggle_pin(&mut usage, item);
        for saved in [&usage.recent[0], &usage.pinned[0]] {
            assert_eq!(saved.title, "生成二维码");
            assert_eq!(saved.subtitle, "二维码");
        }
        assert!(!serde_json::to_string(&usage).unwrap().contains(text));
    }
}
