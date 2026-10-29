//! Relay apps: other apps AhaTools triggers by pressing their own hotkey for them.
//!
//! Global hotkeys go to every app registered for them, so you can't make just WeChat
//! answer ⌘⇧A. Instead each app gets its own rarely used "secret" combo (⌃⌘1…), set
//! once in that app's settings, and AhaTools presses it when its own hotkey routes there.

use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::Shortcut;

use crate::config::{self, RelayApp};
use crate::hotkey::tap;

pub fn find(app: &AppHandle, id: &str) -> Option<RelayApp> {
    config::load(app)
        .relay_apps
        .into_iter()
        .find(|a| a.id == id)
}

/// Presses `accelerator` system-wide (marked so AhaTools' own tap ignores it).
pub fn press(accelerator: &str) -> Result<(), String> {
    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|e| format!("无法识别的组合键 {accelerator}: {e}"))?;
    tap::post_shortcut(&shortcut)
}

pub fn forward(app: &AppHandle, id: &str) -> Result<(), String> {
    let relay = find(app, id).ok_or_else(|| format!("找不到转发目标 {id}"))?;
    if !relay.ready {
        return Err(format!("{0} 还没设置暗号键：先在 {0} 里把快捷键改成 AhaTools 设置里显示的暗号键", relay.name));
    }
    if !is_running(&relay.bundle_id) {
        return Err(format!("{} 没在运行", relay.name));
    }
    press(&relay.accelerator)
}

pub fn is_running(bundle_id: &str) -> bool {
    Command::new("lsappinfo")
        .args(["info", "-only", "pid", "-app", bundle_id])
        .output()
        .map(|o| parse_lsappinfo_pid(&String::from_utf8_lossy(&o.stdout)).is_some())
        .unwrap_or(false)
}

/// `lsappinfo info -only pid` prints `"pid"=123` (or `pid = 123`) when running, nothing otherwise.
fn parse_lsappinfo_pid(out: &str) -> Option<u32> {
    let i = out.find("pid")?;
    let rest = out[i + 3..].trim_start_matches(['"', ' ', '=']);
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok().filter(|&pid| pid > 0)
}

pub fn is_installed(bundle_id: &str) -> bool {
    crate::plugins::launcher::app_dirs().iter().any(|dir| {
        std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .any(|e| bundle_id_of(&e.path()).as_deref() == Some(bundle_id))
    })
}

fn bundle_id_of(app: &Path) -> Option<String> {
    if app.extension()? != "app" {
        return None;
    }
    plist::Value::from_file(app.join("Contents/Info.plist"))
        .ok()?
        .as_dictionary()?
        .get("CFBundleIdentifier")?
        .as_string()
        .map(str::to_owned)
}

/// A macOS notification; used when AhaTools acts while no window is showing.
pub fn notify(message: &str) {
    let script = format!(
        "display notification \"{}\" with title \"AhaTools\"",
        message.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let _ = Command::new("osascript").args(["-e", &script]).spawn();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatus {
    pub id: String,
    pub installed: bool,
    pub running: bool,
}

#[tauri::command]
pub async fn relay_status(app: AppHandle) -> Vec<RelayStatus> {
    config::load(&app)
        .relay_apps
        .iter()
        .map(|a| {
            let running = is_running(&a.bundle_id);
            RelayStatus {
                id: a.id.clone(),
                installed: running || is_installed(&a.bundle_id),
                running,
            }
        })
        .collect()
}

/// Presses a relay app's secret combo after `delay_ms`, so the user can first click into
/// that app's shortcut field and let it record the combo.
#[tauri::command]
pub fn relay_press_later(app: AppHandle, id: String, delay_ms: u64) -> Result<(), String> {
    let relay = find(&app, &id).ok_or_else(|| format!("找不到 {id}"))?;
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(delay_ms));
        if let Err(e) = press(&relay.accelerator) {
            notify(&e);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lsappinfo_output() {
        assert_eq!(parse_lsappinfo_pid("\"pid\"=73451\n"), Some(73451));
        assert_eq!(
            parse_lsappinfo_pid("    pid = 14912 !cgsConnection"),
            Some(14912)
        );
        assert_eq!(parse_lsappinfo_pid(""), None);
    }

    #[test]
    fn finds_installed_system_app() {
        assert!(is_installed("com.apple.systempreferences"));
        assert!(!is_installed("com.example.not-installed"));
    }
}
