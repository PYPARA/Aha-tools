use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tauri::{AppHandle, Emitter, Manager};

use crate::hotkey::Action;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub hotkeys: Vec<Binding>,
    pub netspeed: bool,
    /// Swallow AhaTools' hotkeys so other apps bound to the same keys don't fire.
    pub exclusive_hotkeys: bool,
    pub screenshot: Screenshot,
    /// Apps AhaTools can trigger by pressing their own ("secret") hotkey for them.
    pub relay_apps: Vec<RelayApp>,
    /// Match Chinese names by pinyin, e.g. "wx" finds 微信.
    pub pinyin: bool,
    /// "system", "light" or "dark".
    pub appearance: String,
    /// Content matches switched off in a plugin's 自动匹配 tab, as "<plugin>/<feature>".
    pub disabled_matches: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Screenshot {
    /// "system", or the id of a relay app with `screenshot: true`.
    pub target: String,
    pub system_mode: SystemMode,
}

impl Default for Screenshot {
    fn default() -> Self {
        Screenshot {
            target: "system".into(),
            system_mode: SystemMode::Region,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SystemMode {
    /// Select a region, copy to the clipboard.
    #[default]
    Region,
    /// The macOS screenshot toolbar (⌘⇧5).
    Toolbar,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelayApp {
    pub id: String,
    pub name: String,
    pub bundle_id: String,
    /// The hotkey set inside that app; AhaTools presses it to trigger the app.
    pub accelerator: String,
    /// Offered as a screenshot tool.
    #[serde(default)]
    pub screenshot: bool,
    /// The user confirmed the secret hotkey is set inside that app. Until then AhaTools
    /// doesn't press it (the press would do nothing) and says so instead.
    #[serde(default)]
    pub ready: bool,
}

/// Modifiers of the default secret keys. ⌃⌘ + a digit: unused by macOS, and accepted by
/// QQ's recorder, which dropped ⇧ and ⌥ from the first choice, ⌃⌥⇧⌘.
const SECRET_MODS: &str = "Control+Super";
const OLD_SECRET_MODS: &str = "Control+Alt+Shift+Super";

/// Moves secret keys still on the old ⌃⌥⇧⌘ default (and not confirmed as set up in the
/// other app) to the new default. Returns whether anything changed.
fn migrate_secret_keys(cfg: &mut Config) -> bool {
    let defaults = default_relay_apps();
    let mut changed = false;
    for app in cfg.relay_apps.iter_mut().filter(|a| !a.ready) {
        let Some(key) = app.accelerator.strip_prefix(OLD_SECRET_MODS).and_then(|k| k.strip_prefix('+')) else {
            continue;
        };
        if defaults.iter().any(|d| d.id == app.id && d.accelerator.ends_with(&format!("+{key}"))) {
            app.accelerator = format!("{SECRET_MODS}+{key}");
            changed = true;
        }
    }
    changed
}

fn relay(id: &str, name: &str, bundle_id: &str, key: &str, screenshot: bool) -> RelayApp {
    RelayApp {
        id: id.into(),
        name: name.into(),
        bundle_id: bundle_id.into(),
        accelerator: format!("{SECRET_MODS}+{key}"),
        screenshot,
        ready: false,
    }
}

pub fn default_relay_apps() -> Vec<RelayApp> {
    vec![
        relay("wechat", "微信", "com.tencent.xinWeChat", "Digit1", true),
        relay("qq", "QQ", "com.tencent.qq", "Digit2", true),
        relay(
            "dingtalk",
            "钉钉",
            "com.alibaba.DingTalkMac",
            "Digit3",
            true,
        ),
        relay("utools", "uTools", "org.yuanli.utools", "Digit0", false),
    ]
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    /// Tauri accelerator string, e.g. "Alt+Space".
    pub accelerator: String,
    pub action: Action,
    pub enabled: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            hotkeys: vec![
                Binding {
                    accelerator: "Alt+Space".into(),
                    action: Action::TogglePanel,
                    enabled: true,
                },
                Binding {
                    accelerator: "Super+Shift+KeyA".into(),
                    action: Action::Screenshot,
                    enabled: false,
                },
            ],
            netspeed: true,
            exclusive_hotkeys: true,
            screenshot: Screenshot::default(),
            relay_apps: default_relay_apps(),
            pinyin: true,
            appearance: "system".into(),
            disabled_matches: vec![],
        }
    }
}

/// Data folder before the bundle id became com.ahatools.app (2026-10-28).
const LEGACY_DIR: &str = "com.aha.tools";

/// ~/Library/Application Support/com.ahatools.app
pub fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().expect("no app config dir");
    if !dir.exists() {
        // One-time move of config and saved paths from the old folder.
        if let Some(legacy) = dir.parent().map(|p| p.join(LEGACY_DIR)) {
            let _ = fs::rename(legacy, &dir);
        }
    }
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Reads `<data_dir>/<name>.json`, falling back to `T::default()` when missing or invalid.
pub fn load_json<T: DeserializeOwned + Default>(app: &AppHandle, name: &str) -> T {
    let path = data_dir(app).join(format!("{name}.json"));
    fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save_json<T: Serialize>(app: &AppHandle, name: &str, value: &T) -> Result<(), String> {
    let path = data_dir(app).join(format!("{name}.json"));
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}

pub fn load(app: &AppHandle) -> Config {
    let path = data_dir(app).join("config.json");
    if !path.exists() {
        // Write defaults once so the file is there to edit by hand.
        let _ = save_json(app, "config", &Config::default());
    }
    let mut cfg: Config = load_json(app, "config");
    if migrate_secret_keys(&mut cfg) {
        let _ = save_json(app, "config", &cfg);
    }
    cfg
}

#[tauri::command]
pub fn config_get(app: AppHandle) -> Config {
    load(&app)
}

/// Saves the whole config and applies it immediately (no restart). Returns the
/// hotkeys that failed to register, if any.
#[tauri::command]
pub fn config_set(app: AppHandle, config: Config) -> Result<Vec<String>, String> {
    save_json(&app, "config", &config)?;
    crate::plugins::configure(&config);
    crate::netspeed::set_visible(config.netspeed);
    let errors = crate::hotkey::reconfigure(&app, &config);
    let keys: Vec<_> = config.hotkeys.iter().filter(|b| b.enabled).map(|b| b.accelerator.as_str()).collect();
    eprintln!("[config] saved; hotkeys {keys:?}; errors {errors:?}");
    let _ = app.emit("config-changed", &config);
    Ok(errors)
}

/// The folder holding config.json and the other data files, for 关于 AhaTools.
#[tauri::command]
pub fn config_dir(app: AppHandle) -> String {
    data_dir(&app).to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_config_gets_new_defaults() {
        let old = r#"{"hotkeys":[{"accelerator":"Alt+Space","action":{"type":"togglePanel"},"enabled":true}],"netspeed":true,"exclusiveHotkeys":true}"#;
        let cfg: Config = serde_json::from_str(old).unwrap();
        assert_eq!(cfg.hotkeys.len(), 1);
        assert_eq!(cfg.screenshot.target, "system");
        assert_eq!(cfg.relay_apps, default_relay_apps());
        assert!(cfg.pinyin);
        assert_eq!(cfg.appearance, "system");
    }

    #[test]
    fn old_secret_keys_move_unless_confirmed() {
        let mut cfg = Config::default();
        for a in &mut cfg.relay_apps {
            a.accelerator = a.accelerator.replace(SECRET_MODS, OLD_SECRET_MODS);
        }
        cfg.relay_apps[1].ready = true;
        assert!(migrate_secret_keys(&mut cfg));
        assert_eq!(cfg.relay_apps[0].accelerator, "Control+Super+Digit1");
        assert_eq!(cfg.relay_apps[1].accelerator, "Control+Alt+Shift+Super+Digit2");
        assert!(!migrate_secret_keys(&mut cfg));
    }

    #[test]
    fn actions_round_trip() {
        let json = r#"[{"type":"screenshot"},{"type":"forward","app":"utools"},{"type":"openFeature","plugin":"a","feature":"b"}]"#;
        let actions: Vec<Action> = serde_json::from_str(json).unwrap();
        assert_eq!(
            actions[1],
            Action::Forward {
                app: "utools".into()
            }
        );
        assert_eq!(serde_json::to_string(&actions).unwrap(), json);
    }
}
