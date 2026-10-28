use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tauri::{AppHandle, Manager};

use crate::hotkey::Action;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub hotkeys: Vec<Binding>,
    pub netspeed: bool,
    /// Swallow Aha's hotkeys so other apps bound to the same keys don't fire.
    pub exclusive_hotkeys: bool,
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
            hotkeys: vec![Binding {
                accelerator: "Alt+Space".into(),
                action: Action::TogglePanel,
                enabled: true,
            }],
            netspeed: true,
            exclusive_hotkeys: true,
        }
    }
}

/// ~/Library/Application Support/com.aha.tools
pub fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().expect("no app config dir");
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
    load_json(app, "config")
}
