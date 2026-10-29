//! Quick launch: installed apps plus user-saved paths, fuzzy searchable.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use fuzzy_matcher::skim::SkimMatcherV2;
use serde::{Deserialize, Serialize};
use base64::Engine;
use tauri::{AppHandle, Manager, State};

use super::{ItemAction, ItemKind, SearchItem, SearchProvider};
use crate::config;

pub const ID: &str = "launcher";
const STORE: &str = "launcher";
/// Saved paths rank above apps for the same match quality.
const SAVED_BONUS: i64 = 30;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    /// Localized name, e.g. "系统设置" for "System Settings".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    pub path: String,
}

pub struct Launcher {
    app: AppHandle,
    apps: RwLock<Vec<Entry>>,
    saved: RwLock<Vec<Entry>>,
}

impl Launcher {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let saved = config::load_json::<Vec<Entry>>(&app, STORE);
        Arc::new(Launcher {
            app,
            apps: RwLock::new(vec![]),
            saved: RwLock::new(saved),
        })
    }

    fn persist(&self) -> Result<(), String> {
        config::save_json(&self.app, STORE, &*self.saved.read().unwrap())
    }
}

impl SearchProvider for Launcher {
    fn search(&self, query: &str, matcher: &SkimMatcherV2) -> Vec<SearchItem> {
        let score = |e: &Entry| {
            let by_name = super::match_text(matcher, &e.name, query);
            let by_alias = e
                .alias
                .as_deref()
                .and_then(|a| super::match_text(matcher, a, query));
            by_name.max(by_alias)
        };
        let item = |e: &Entry, score: i64, kind: ItemKind| SearchItem {
            // Localized apps show "微信" with "WeChat · /Applications/WeChat.app" under it.
            title: e.alias.clone().unwrap_or_else(|| e.name.clone()),
            subtitle: match &e.alias {
                Some(_) => format!("{} · {}", e.name, e.path),
                None => e.path.clone(),
            },
            score,
            plugin: ID.into(),
            kind,
            icon: (kind == ItemKind::Saved).then(|| path_kind(&e.path).to_string()),
            action: ItemAction::OpenPath {
                path: e.path.clone(),
            },
        };

        let saved = self.saved.read().unwrap();
        let apps = self.apps.read().unwrap();
        let saved_items = saved
            .iter()
            .filter_map(|e| score(e).map(|s| item(e, s + SAVED_BONUS, ItemKind::Saved)));
        let app_items = apps
            .iter()
            .filter(|a| !saved.iter().any(|s| s.path == a.path))
            .filter_map(|e| score(e).map(|s| item(e, s, ItemKind::App)));
        saved_items.chain(app_items).collect()
    }

    fn refresh(&self) {
        let apps = scan_apps();
        *self.apps.write().unwrap() = apps;
    }
}

pub(crate) fn app_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = [
        "/Applications",
        "/Applications/Utilities",
        "/System/Applications",
        "/System/Applications/Utilities",
        "/System/Library/CoreServices/Applications",
    ]
    .iter()
    .map(PathBuf::from)
    .collect();
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    dirs
}

fn scan_apps() -> Vec<Entry> {
    let mut apps = vec![];
    for dir in app_dirs() {
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "app") {
                let name = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                let alias = localized_name(&path).filter(|a| *a != name);
                apps.push(Entry {
                    name,
                    alias,
                    path: path.to_string_lossy().into_owned(),
                });
            }
        }
    }
    apps
}

/// Chinese display name of an app bundle, if it has one.
fn localized_name(app: &Path) -> Option<String> {
    let res = app.join("Contents/Resources");

    // Apple's own apps: InfoPlist.loctable = { "zh_CN": { "CFBundleDisplayName": .. }, .. }
    if let Ok(v) = plist::Value::from_file(res.join("InfoPlist.loctable")) {
        let table = v.as_dictionary()?;
        for locale in ["zh_CN", "zh-Hans", "zh_Hans"] {
            if let Some(name) = table
                .get(locale)
                .and_then(|d| bundle_name(d.as_dictionary()?))
            {
                return Some(name);
            }
        }
    }

    // Third-party apps: <locale>.lproj/InfoPlist.strings, as XML/binary plist or "k" = "v"; text.
    for locale in ["zh-Hans", "zh_CN", "zh-CN", "zh_Hans"] {
        let path = res.join(format!("{locale}.lproj/InfoPlist.strings"));
        if !path.exists() {
            continue;
        }
        if let Ok(v) = plist::Value::from_file(&path) {
            if let Some(name) = v.as_dictionary().and_then(bundle_name) {
                return Some(name);
            }
        }
        if let Some(name) = fs::read(&path).ok().and_then(|b| parse_strings(&b)) {
            return Some(name);
        }
    }
    None
}

fn bundle_name(d: &plist::Dictionary) -> Option<String> {
    ["CFBundleDisplayName", "CFBundleName"]
        .iter()
        .find_map(|k| d.get(*k)?.as_string().map(str::to_owned))
        .filter(|s| !s.trim().is_empty())
}

/// Minimal parser for old-style `"CFBundleDisplayName" = "微信";` strings files (UTF-8 or UTF-16).
fn parse_strings(bytes: &[u8]) -> Option<String> {
    let text = match bytes {
        [0xFF, 0xFE, rest @ ..] => decode_utf16(rest, u16::from_le_bytes),
        [0xFE, 0xFF, rest @ ..] => decode_utf16(rest, u16::from_be_bytes),
        _ => String::from_utf8_lossy(bytes).into_owned(),
    };
    ["CFBundleDisplayName", "CFBundleName"]
        .iter()
        .find_map(|key| {
            text.lines().find_map(|line| {
                let line = line.trim();
                let rest = line
                    .strip_prefix(&format!("\"{key}\""))
                    .or_else(|| line.strip_prefix(*key))?;
                let value = rest.trim_start().strip_prefix('=')?.trim();
                let value = value.strip_prefix('"')?;
                Some(value[..value.rfind('"')?].to_string())
            })
        })
}

fn decode_utf16(bytes: &[u8], f: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| f([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units)
}

/// What a saved path points at, for its icon: "link", "folder" or "file".
pub fn path_kind(path: &str) -> &'static str {
    if path.contains("://") {
        return "link";
    }
    match fs::metadata(super::expand_home(path)) {
        Ok(m) if m.is_dir() && !path.ends_with(".app") => "folder",
        _ => "file",
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SavedView {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
}

#[tauri::command]
pub fn launcher_saved(launcher: State<Arc<Launcher>>) -> Vec<SavedView> {
    launcher
        .saved
        .read()
        .unwrap()
        .iter()
        .map(|e| SavedView {
            name: e.name.clone(),
            path: e.path.clone(),
            kind: path_kind(&e.path),
        })
        .collect()
}

#[tauri::command]
pub fn launcher_add(
    launcher: State<Arc<Launcher>>,
    path: String,
    name: Option<String>,
) -> Result<Vec<SavedView>, String> {
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| {
        let p = Path::new(&path);
        p.file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone())
    });
    {
        let mut saved = launcher.saved.write().unwrap();
        saved.retain(|e| e.path != path);
        saved.push(Entry {
            name,
            alias: None,
            path,
        });
    }
    launcher.persist()?;
    Ok(launcher_saved(launcher))
}

#[tauri::command]
pub fn launcher_remove(
    launcher: State<Arc<Launcher>>,
    path: String,
) -> Result<Vec<SavedView>, String> {
    launcher.saved.write().unwrap().retain(|e| e.path != path);
    launcher.persist()?;
    Ok(launcher_saved(launcher))
}

/// The bundle's .icns, from CFBundleIconFile (the extension is optional there).
fn icon_file(app: &Path) -> Option<PathBuf> {
    let info = plist::Value::from_file(app.join("Contents/Info.plist")).ok()?;
    let name = info
        .as_dictionary()?
        .get("CFBundleIconFile")
        .and_then(|v| v.as_string())
        .unwrap_or("AppIcon");
    let mut path = app.join("Contents/Resources").join(name);
    if path.extension().is_none() {
        path.set_extension("icns");
    }
    path.exists().then_some(path)
}

/// An app's icon as a PNG data URL, converted once with `sips` and cached. None for apps
/// whose icon lives only in an asset catalog; the panel then draws a letter tile.
#[tauri::command]
pub async fn app_icon(app: AppHandle, path: String) -> Option<String> {
    use std::hash::{DefaultHasher, Hash, Hasher};

    if !path.ends_with(".app") {
        return None;
    }
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    let dir = app.path().app_cache_dir().ok()?.join("icons");
    let png = dir.join(format!("{:016x}.png", h.finish()));
    if !png.exists() {
        let icns = icon_file(Path::new(&path))?;
        fs::create_dir_all(&dir).ok()?;
        // 80px: the largest tile is 40pt on a Retina screen.
        let ok = std::process::Command::new("sips")
            .args(["-s", "format", "png", "-Z", "80"])
            .arg(&icns)
            .arg("--out")
            .arg(&png)
            .output()
            .is_ok_and(|o| o.status.success());
        if !ok {
            return None;
        }
    }
    let bytes = fs::read(&png).ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strings_file_utf8() {
        let s = "/* c */\n\"CFBundleName\" = \"微信\";\n";
        assert_eq!(parse_strings(s.as_bytes()).as_deref(), Some("微信"));
    }

    #[test]
    fn strings_file_utf16_display_name_wins() {
        let s = "CFBundleName = \"A\";\n\"CFBundleDisplayName\" = \"系统设置\";";
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend(s.encode_utf16().flat_map(|u| u.to_le_bytes()));
        assert_eq!(parse_strings(&bytes).as_deref(), Some("系统设置"));
    }

    #[test]
    fn path_kinds() {
        assert_eq!(path_kind("https://github.com"), "link");
        assert_eq!(path_kind("/etc/hosts"), "file");
        assert_eq!(path_kind("/Applications"), "folder");
        assert_eq!(path_kind("/Applications/Safari.app"), "file");
    }

    #[test]
    fn finds_icns_for_system_apps() {
        assert!(icon_file(Path::new("/System/Applications/Calculator.app")).is_some());
    }

    #[test]
    fn scans_system_apps_with_chinese_names() {
        let apps = scan_apps();
        assert!(apps.iter().any(|a| a.name == "System Settings"));
        let settings = apps.iter().find(|a| a.name == "System Settings").unwrap();
        // Only meaningful on a machine with Chinese localisation installed (all macOS installs have it).
        assert_eq!(settings.alias.as_deref(), Some("系统设置"));
    }
}
