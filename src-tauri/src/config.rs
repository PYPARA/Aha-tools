use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tauri::{AppHandle, Emitter, Manager};

use crate::hotkey::Action;

pub static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub hotkeys: Vec<Binding>,
    pub super_panel: crate::superpanel::Settings,
    pub menubar: Vec<MenubarItem>,
    /// Swallow AhaTools' hotkeys so other apps bound to the same keys don't fire.
    pub exclusive_hotkeys: bool,
    pub screenshot: Screenshot,
    /// Apps AhaTools can trigger by pressing their own ("secret") hotkey for them.
    pub relay_apps: Vec<RelayApp>,
    /// Match Chinese names by pinyin, e.g. "wx" finds 微信.
    pub pinyin: bool,
    /// "system", "light" or "dark".
    pub appearance: String,
    /// What a normal panel invocation does after the panel has been hidden.
    pub panel_reopen: PanelReopen,
    /// Content matches switched off in a plugin's 自动匹配 tab, as "<plugin>/<feature>".
    pub disabled_matches: Vec<String>,
    /// Sites opened in their own long-lived windows (webapps.rs).
    pub web_apps: Vec<WebApp>,
    pub translate: TranslateConfig,
    /// Seconds after copying during which opening the search panel brings the copy in;
    /// 0 switches it off.
    pub clipboard_auto_paste: u32,
    /// Web search for 「没有找到」, with `{q}` for the query.
    pub web_search: String,
    /// Preserve unrelated/future fields when migrating and saving the config.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MenubarItem {
    Netspeed,
    Cpu,
    Memory,
}

fn normalize(config: &mut Config) {
    let mut seen = vec![];
    config.menubar.retain(|item| {
        if seen.contains(item) {
            false
        } else {
            seen.push(*item);
            true
        }
    });
    config.extra.remove("netspeed");
}

/// Migrate before applying serde defaults: an explicit empty list must win over netspeed.
fn decode_config(bytes: &[u8]) -> Result<Config, serde_json::Error> {
    let mut value: serde_json::Value = serde_json::from_slice(bytes)?;
    if let Some(object) = value.as_object_mut() {
        if !object.contains_key("menubar") {
            let on = object
                .get("netspeed")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            object.insert(
                "menubar".into(),
                serde_json::json!(if on { vec!["netspeed"] } else { vec![] }),
            );
        }
        object.remove("netspeed");
    }
    let mut config: Config = serde_json::from_value(value)?;
    normalize(&mut config);
    Ok(config)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct TranslateConfig {
    pub profiles: Vec<TranslateProfile>,
    pub active_profile_id: Option<String>,
    pub direction: TranslateDirection,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranslateProfile {
    pub id: String,
    pub name: String,
    pub protocol: TranslateProtocol,
    pub base_url: String,
    pub model: String,
    /// Extra top-level request fields, e.g. switching a reasoning model's thinking off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_body: Option<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub enum TranslateProtocol {
    #[serde(rename = "openai-chat")]
    Chat,
    #[serde(rename = "openai-responses")]
    Responses,
    #[serde(rename = "anthropic-messages")]
    Messages,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
pub enum TranslateDirection {
    #[default]
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "en-zh")]
    EnZh,
    #[serde(rename = "zh-en")]
    ZhEn,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PanelReopen {
    AfterFiveMinutes,
    Search,
    #[default]
    #[serde(other)]
    Resume,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebApp {
    pub id: String,
    pub name: String,
    pub url: String,
    /// Extra search words, e.g. "ds" for DeepSeek.
    #[serde(default)]
    pub keywords: Vec<String>,
}

pub fn default_web_apps() -> Vec<WebApp> {
    vec![WebApp {
        id: "deepseek".into(),
        name: "DeepSeek".into(),
        url: "https://chat.deepseek.com".into(),
        keywords: vec!["ds".into()],
    }]
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
        let Some(key) = app
            .accelerator
            .strip_prefix(OLD_SECRET_MODS)
            .and_then(|k| k.strip_prefix('+'))
        else {
            continue;
        };
        if defaults
            .iter()
            .any(|d| d.id == app.id && d.accelerator.ends_with(&format!("+{key}")))
        {
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
                super_binding(true),
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
            super_panel: crate::superpanel::Settings::default(),
            menubar: vec![MenubarItem::Netspeed],
            exclusive_hotkeys: true,
            screenshot: Screenshot::default(),
            relay_apps: default_relay_apps(),
            pinyin: true,
            appearance: "system".into(),
            panel_reopen: PanelReopen::Resume,
            disabled_matches: vec![],
            web_apps: default_web_apps(),
            clipboard_auto_paste: 5,
            web_search: "https://www.google.com/search?q={q}".into(),
            extra: Default::default(),
            translate: TranslateConfig::default(),
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
    // A failed write must not truncate the previous configuration.
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = path.with_extension(format!("json.{}.{n}.tmp", std::process::id()));
    let result = fs::write(&tmp, bytes).and_then(|_| fs::rename(&tmp, &path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|e| e.to_string())
}

pub fn load(app: &AppHandle) -> Config {
    let path = data_dir(app).join("config.json");
    if !path.exists() {
        // Write defaults once so the file is there to edit by hand.
        let _ = save_json(app, "config", &Config::default());
    }
    let bytes = fs::read(&path).unwrap_or_default();
    // Preserve an invalid file for recovery rather than overwriting it during migration.
    let Ok(mut cfg) = decode_config(&bytes) else {
        return Config::default();
    };
    let migrated = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .is_some_and(|v| {
            v.get("netspeed").is_some() || v.get("menubar") != Some(&serde_json::json!(cfg.menubar))
        });
    let needs_super = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .is_some_and(|v| v.get("superPanel").is_none());
    if needs_super {
        migrate_super_panel(&mut cfg);
    }
    if migrate_secret_keys(&mut cfg) || migrated || needs_super {
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
pub fn config_set(app: AppHandle, mut config: Config) -> Result<Vec<String>, String> {
    let _guard = WRITE_LOCK.lock().unwrap();
    normalize(&mut config);
    crate::superpanel::validate_settings(&mut config.super_panel)?;
    save_json(&app, "config", &config)?;
    crate::plugins::configure(&config);
    crate::netspeed::configure(&config.menubar);
    crate::sysmon::configure(&config.menubar);
    crate::webapps::reconfigure(&app, &config.web_apps);
    let errors = crate::hotkey::reconfigure(&app, &config);
    crate::superpanel::refresh(&app);
    let keys: Vec<_> = config
        .hotkeys
        .iter()
        .filter(|b| b.enabled)
        .map(|b| b.accelerator.as_str())
        .collect();
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
        let cfg = decode_config(old.as_bytes()).unwrap();
        assert_eq!(cfg.hotkeys.len(), 1);
        assert_eq!(cfg.screenshot.target, "system");
        assert_eq!(cfg.relay_apps, default_relay_apps());
        assert!(cfg.pinyin);
        assert_eq!(cfg.web_apps, default_web_apps());
        assert_eq!(cfg.appearance, "system");
        assert_eq!(cfg.translate, TranslateConfig::default());
        assert_eq!(cfg.panel_reopen, PanelReopen::Resume);
        assert_eq!(cfg.clipboard_auto_paste, 5);
        assert!(cfg.web_search.contains("{q}"));
        let off: Config = serde_json::from_str(r#"{"clipboardAutoPaste":0,"webSearch":"https://cn.bing.com/search?q={q}"}"#).unwrap();
        assert_eq!(off.clipboard_auto_paste, 0);
        assert!(off.web_search.starts_with("https://cn.bing.com"));
    }

    #[test]
    fn panel_reopen_round_trips_and_unknown_values_keep_other_settings() {
        for (value, mode) in [
            ("resume", PanelReopen::Resume),
            ("search", PanelReopen::Search),
            ("afterFiveMinutes", PanelReopen::AfterFiveMinutes),
        ] {
            let cfg: Config =
                serde_json::from_str(&format!(r#"{{"panelReopen":"{value}","pinyin":false}}"#))
                    .unwrap();
            assert_eq!(cfg.panel_reopen, mode);
            assert!(!cfg.pinyin);
            assert_eq!(serde_json::to_value(&cfg).unwrap()["panelReopen"], value);
        }
        let cfg = decode_config(br#"{"panelReopen":"futureValue","netspeed":false}"#).unwrap();
        assert_eq!(cfg.panel_reopen, PanelReopen::Resume);
        assert!(cfg.menubar.is_empty());
    }

    #[test]
    fn menubar_migration_preserves_false_empty_order_and_unrelated_fields() {
        for (json, expected) in [
            (r#"{}"#, vec![MenubarItem::Netspeed]),
            (r#"{"netspeed":true}"#, vec![MenubarItem::Netspeed]),
            (r#"{"netspeed":false}"#, vec![]),
            (r#"{"netspeed":true,"menubar":[]}"#, vec![]),
            (
                r#"{"netspeed":false,"menubar":["memory","cpu","memory","netspeed"]}"#,
                vec![MenubarItem::Memory, MenubarItem::Cpu, MenubarItem::Netspeed],
            ),
        ] {
            let config = decode_config(json.as_bytes()).unwrap();
            assert_eq!(config.menubar, expected);
            let saved = serde_json::to_value(&config).unwrap();
            assert!(saved.get("netspeed").is_none());
            assert_eq!(
                decode_config(&serde_json::to_vec(&saved).unwrap())
                    .unwrap()
                    .menubar,
                expected
            );
        }
        let config =
            decode_config(br#"{"netspeed":false,"appearance":"dark","future":{"setting":3}}"#)
                .unwrap();
        let value = serde_json::to_value(config).unwrap();
        assert_eq!(value["appearance"], "dark");
        assert_eq!(value["future"]["setting"], 3);
    }

    #[test]
    fn menubar_migration_keeps_translation_and_panel_settings() {
        let config = serde_json::json!({
            "netspeed": false,
            "panelReopen": "afterFiveMinutes",
            "pinyin": false,
            "translate": {
                "profiles": [{ "id": "work", "name": "工作", "protocol": "openai-responses", "baseUrl": "https://example.com/v1", "model": "custom" }],
                "activeProfileId": "work", "direction": "en-zh"
            }
        });
        let mut migrated = decode_config(&serde_json::to_vec(&config).unwrap()).unwrap();
        assert!(migrated.menubar.is_empty());
        assert_eq!(migrated.panel_reopen, PanelReopen::AfterFiveMinutes);
        assert!(!migrated.pinyin);
        migrated.menubar.push(MenubarItem::Cpu);
        let saved = serde_json::to_value(migrated).unwrap();
        assert_eq!(saved["translate"], config["translate"]);
        assert_eq!(saved["panelReopen"], config["panelReopen"]);
        assert_eq!(saved["menubar"], serde_json::json!(["cpu"]));
        assert!(saved.get("netspeed").is_none());
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
        assert_eq!(
            cfg.relay_apps[1].accelerator,
            "Control+Alt+Shift+Super+Digit2"
        );
        assert!(!migrate_secret_keys(&mut cfg));
    }

    #[test]
    fn super_panel_migration_is_once_and_respects_conflicts() {
        let mut cfg = Config::default();
        cfg.hotkeys.retain(|b| b.action != Action::SuperPanel);
        cfg.hotkeys.push(Binding {
            accelerator: "Shift+Alt+Space".into(),
            action: Action::TogglePanel,
            enabled: true,
        });
        migrate_super_panel(&mut cfg);
        assert!(!cfg.hotkeys.last().unwrap().enabled);
        let len = cfg.hotkeys.len();
        migrate_super_panel(&mut cfg);
        assert_eq!(cfg.hotkeys.len(), len);
        let cfg: Config = serde_json::from_str(
            r#"{"hotkeys":[],"superPanel":{"pinned":[],"actions":[],"longPressRight":false}}"#,
        )
        .unwrap();
        assert!(cfg.hotkeys.is_empty());
        assert!(cfg.super_panel.pinned.is_empty());
    }

    #[test]
    fn actions_round_trip() {
        let json = r#"[{"type":"screenshot"},{"type":"forward","app":"utools"},{"type":"openFeature","plugin":"a","feature":"b"},{"type":"openWeb","id":"deepseek"}]"#;
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

pub fn super_binding(enabled: bool) -> Binding {
    Binding {
        accelerator: "Alt+Shift+Space".into(),
        action: Action::SuperPanel,
        enabled,
    }
}

fn migrate_super_panel(cfg: &mut Config) {
    if cfg.hotkeys.iter().any(|b| b.action == Action::SuperPanel) {
        return;
    }
    let target: tauri_plugin_global_shortcut::Shortcut = "Alt+Shift+Space".parse().unwrap();
    let conflict = cfg.hotkeys.iter().any(|b| {
        b.enabled
            && b.accelerator
                .parse::<tauri_plugin_global_shortcut::Shortcut>()
                .is_ok_and(|s| s.id() == target.id())
    });
    cfg.hotkeys.push(super_binding(!conflict));
}
