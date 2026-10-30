//! Screenshot routing: one AhaTools hotkey, handed to the tool picked in settings.
//! The system tool is called directly; others are relay apps (relay.rs).

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::config::{self, SystemMode};
use crate::relay;

// Independent of native-dialog pinning, so either operation can finish safely.
static CAPTURING: AtomicBool = AtomicBool::new(false);
static FINISHED: AtomicBool = AtomicBool::new(false);

pub fn is_capturing() -> bool {
    CAPTURING.load(Ordering::Acquire)
}

struct VisibilityHold<'a>(&'a AtomicBool);
impl<'a> VisibilityHold<'a> {
    fn acquire(active: &'a AtomicBool) -> Option<Self> {
        active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(active))
    }
}
impl Drop for VisibilityHold<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

struct Capture {
    _hold: VisibilityHold<'static>,
    app: AppHandle,
    focused: Option<&'static str>,
    clipboard: isize,
    completed: bool,
}

impl Capture {
    fn begin(app: &AppHandle) -> Option<Self> {
        let hold = VisibilityHold::acquire(&CAPTURING)?;
        FINISHED.store(false, Ordering::Release);
        let focused = [crate::panel::LABEL, crate::popover::LABEL]
            .into_iter()
            .find(|label| {
                app.get_webview_window(label).is_some_and(|w| {
                    w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false)
                })
            });
        Some(Self {
            _hold: hold,
            app: app.clone(),
            focused,
            clipboard: crate::clipboard::change_count(),
            completed: false,
        })
    }

    /// Relay tools don't expose a completion callback. Watch completion/cancel, never pixels.
    fn wait_for_tool(&mut self) {
        let start = Instant::now();
        let mut blurred = false;
        while start.elapsed() < Duration::from_secs(120) {
            if FINISHED.load(Ordering::Acquire)
                || crate::clipboard::change_count() != self.clipboard
            {
                self.completed = true;
                break;
            }
            if let Some(label) = self.focused {
                if let Some(w) = self.app.get_webview_window(label) {
                    if !w.is_visible().unwrap_or(false) {
                        break;
                    }
                    let focused = w.is_focused().unwrap_or(false);
                    if blurred && focused {
                        self.completed = true;
                        break;
                    }
                    blurred |= !focused;
                }
            } else {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        // Allow the tool's final blur/cancel animation to finish before restoring normal blur.
        thread::sleep(Duration::from_millis(250));
        if self.completed {
            if let Some(label) = self.focused {
                let app = self.app.clone();
                let _ = self.app.run_on_main_thread(move || {
                    if let Some(window) = app.get_webview_window(label) {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.set_focus();
                        }
                    }
                });
            }
        }
    }
}

/// The relay apps' screenshot UIs consume Escape before it reaches our webview.
pub fn cancel() {
    FINISHED.store(true, Ordering::Release);
}

/// Takes a screenshot with `target` (or the configured tool). Falls back to the system
/// tool when the chosen app isn't running or isn't set up yet. Runs off the calling thread.
pub fn take(app: &AppHandle, target: Option<String>) {
    let Some(mut capture) = Capture::begin(app) else {
        return;
    };
    let app = app.clone();
    thread::spawn(move || {
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
                    Ok(()) => {
                        capture.wait_for_tool();
                        return;
                    }
                    Err(e) => relay::notify(&format!("{e}，已改用系统截图")),
                }
            } else {
                relay::notify(&format!("{} 没在运行，已改用系统截图", r.name));
            }
        }
        system(cfg.screenshot.system_mode);
        capture.completed = true;
        drop(capture);
    });
}

fn system(mode: SystemMode) {
    let mut command = Command::new("screencapture");
    command.arg("-i");
    match mode {
        SystemMode::Region => {
            command.arg("-c");
        }
        SystemMode::Toolbar => {
            command.args(["-U", "-u"]);
        }
    }
    // Wait on this background thread, keeping visible windows in the captured scene.
    if let Err(error) = command.status() {
        relay::notify(&format!("无法启动系统截图：{error}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_screenshots_cannot_release_an_existing_visibility_hold() {
        let active = AtomicBool::new(false);
        let hold = VisibilityHold::acquire(&active).unwrap();
        assert!(VisibilityHold::acquire(&active).is_none());
        assert!(active.load(Ordering::Acquire));
        drop(hold);
        assert!(!active.load(Ordering::Acquire));
        assert!(VisibilityHold::acquire(&active).is_some());
    }

    #[test]
    fn early_failure_restores_normal_blur_behavior() {
        let active = AtomicBool::new(false);
        let result: Result<(), &str> = (|| {
            let _hold = VisibilityHold::acquire(&active).unwrap();
            Err("截图工具启动失败")
        })();
        assert!(result.is_err());
        assert!(!active.load(Ordering::Acquire));
    }
}

#[tauri::command]
pub fn screenshot_take(app: AppHandle, target: Option<String>) {
    take(&app, target);
}
