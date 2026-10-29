//! Screenshot routing: one AhaTools hotkey, handed to the tool picked in settings.
//! The system tool is called directly; others are relay apps (relay.rs).

use std::process::Command;
use std::thread;
use std::time::Duration;

use tauri::AppHandle;

use crate::config::{self, SystemMode};
use crate::relay;

/// Takes a screenshot with `target` (or the configured tool). Falls back to the system
/// tool when the chosen app isn't running or isn't set up yet. Runs off the calling thread.
pub fn take(app: &AppHandle, target: Option<String>) {
    let app = app.clone();
    thread::spawn(move || {
        // The panel must be out of the way before anything captures the screen.
        crate::panel::hide(&app);
        crate::popover::hide(&app);
        thread::sleep(Duration::from_millis(150));

        let cfg = config::load(&app);
        // 「测试截图」 names the tool explicitly: that's how the user checks the setup.
        let testing = target.is_some();
        let target = target.unwrap_or(cfg.screenshot.target.clone());
        if let Some(r) = cfg.relay_apps.iter().find(|a| a.id == target) {
            if !r.ready && !testing {
                relay::notify(&format!(
                    "{} 还没设置暗号键，已改用系统截图。在截图插件的设置里完成一次性设置",
                    r.name
                ));
            } else if relay::is_running(&r.bundle_id) {
                match relay::press(&r.accelerator) {
                    Ok(()) => return,
                    Err(e) => relay::notify(&format!("{e}，已改用系统截图")),
                }
            } else {
                relay::notify(&format!("{} 没在运行，已改用系统截图", r.name));
            }
        }
        system(cfg.screenshot.system_mode);
    });
}

fn system(mode: SystemMode) {
    let _ = match mode {
        SystemMode::Region => Command::new("screencapture").args(["-i", "-c"]).spawn(),
        SystemMode::Toolbar => Command::new("open")
            .args(["-b", "com.apple.screenshot.launcher"])
            .spawn(),
    };
}

#[tauri::command]
pub fn screenshot_take(app: AppHandle, target: Option<String>) {
    take(&app, target);
}
