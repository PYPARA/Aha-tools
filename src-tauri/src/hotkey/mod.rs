//! Hotkey router: every global hotkey goes through here and is dispatched to an `Action`.
//!
//! Two backends:
//! - `tap` (exclusive): a CGEventTap swallows the key so other apps holding the same
//!   combo (uTools, Codex…) never see it. Needs Accessibility permission.
//! - Carbon via the global-shortcut plugin (shared): every app registered for the combo
//!   fires. Used until the permission is granted.
//!
//! Actions can also hand a key to another app (`Forward`, `Screenshot`): AhaTools presses
//! that app's own secret hotkey for it (see relay.rs).

pub mod probe;
pub mod tap;

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::config::{Binding, Config};
use crate::panel;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
    /// Show / hide the search panel.
    TogglePanel,
    /// Show the panel and jump straight into a plugin feature.
    OpenFeature { plugin: String, feature: String },
    /// Take a screenshot with the tool chosen in settings.
    Screenshot,
    /// Press a relay app's own hotkey, e.g. to open uTools.
    Forward { app: String },
}

#[derive(Default)]
pub struct Router {
    routes: Mutex<HashMap<u32, Action>>,
}

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let action = app
                .state::<Router>()
                .routes
                .lock()
                .unwrap()
                .get(&shortcut.id())
                .cloned();
            if let Some(action) = action {
                dispatch(app, &action);
            }
        })
        .build()
}

pub fn dispatch(app: &AppHandle, action: &Action) {
    match action {
        Action::TogglePanel => panel::toggle(app),
        Action::OpenFeature { plugin, feature } => {
            panel::show(app);
            let _ = app.emit(
                "open-feature",
                serde_json::json!({ "plugin": plugin, "feature": feature }),
            );
        }
        Action::Screenshot => crate::screenshot::take(app, None),
        Action::Forward { app: id } => {
            if let Err(e) = crate::relay::forward(app, id) {
                crate::relay::notify(&e);
            }
        }
    }
}

/// Registers the configured hotkeys, exclusively when the config asks for it and
/// macOS allows it. Call from setup (main thread).
pub fn init(app: &AppHandle, cfg: &Config) {
    tap::set_enabled(cfg.exclusive_hotkeys);
    if cfg.exclusive_hotkeys {
        ensure_tap(app);
    }
    apply(app, &cfg.hotkeys);
}

/// Installs the event tap now if permitted; otherwise asks for Accessibility access and
/// installs it (switching hotkeys over) as soon as access is granted.
fn ensure_tap(app: &AppHandle) {
    static WAITING: AtomicBool = AtomicBool::new(false);
    if tap::is_trusted() && tap::install(app) {
        return;
    }
    if WAITING.swap(true, Ordering::SeqCst) {
        return;
    }
    tap::request_trust();
    let app = app.clone();
    thread::spawn(move || {
        while !tap::is_trusted() {
            thread::sleep(Duration::from_secs(2));
        }
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            WAITING.store(false, Ordering::SeqCst);
            if tap::install(&app2) {
                apply(&app2, &crate::config::load(&app2).hotkeys);
                notify(&app2);
            }
        });
    });
}

/// Turns exclusive hotkeys on or off, persists it, and re-registers the bindings.
pub fn set_exclusive(app: &AppHandle, on: bool) -> Result<(), String> {
    let mut cfg = crate::config::load(app);
    cfg.exclusive_hotkeys = on;
    crate::config::save_json(app, "config", &cfg)?;
    reconfigure(app, &cfg);
    Ok(())
}

/// Applies the hotkey settings in `cfg` right away. Returns one message per binding
/// that couldn't be registered.
pub fn reconfigure(app: &AppHandle, cfg: &Config) -> Vec<String> {
    tap::set_enabled(cfg.exclusive_hotkeys);
    if cfg.exclusive_hotkeys {
        ensure_tap(app);
    }
    let errors = apply(app, &cfg.hotkeys);
    notify(app);
    errors
}

/// Tells every window (panel, menu popover) that the hotkey mode changed.
fn notify(app: &AppHandle) {
    let _ = app.emit("hotkey-status", status(app));
}

/// (Re)registers all enabled bindings. Returns one message per binding that failed.
pub fn apply(app: &AppHandle, bindings: &[Binding]) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let router = app.state::<Router>();
    let mut routes = router.routes.lock().unwrap();
    routes.clear();

    let exclusive = tap::is_active();
    let mut tap_bindings = vec![];
    let mut errors = vec![];
    // Rows still being set up in settings have no accelerator yet.
    for b in bindings
        .iter()
        .filter(|b| b.enabled && !b.accelerator.trim().is_empty())
    {
        let shortcut: Shortcut = match b.accelerator.parse() {
            Ok(s) => s,
            Err(e) => {
                errors.push(format!("{}: {e}", b.accelerator));
                continue;
            }
        };
        if exclusive {
            if let Some(tb) = tap::binding_for(&shortcut, b.action.clone()) {
                tap_bindings.push(tb);
                continue;
            }
        }
        match gs.register(shortcut) {
            Ok(()) => {
                routes.insert(shortcut.id(), b.action.clone());
            }
            Err(e) => errors.push(format!("{}: {e}", b.accelerator)),
        }
    }
    if exclusive {
        tap::set_bindings(tap_bindings);
    }
    for e in &errors {
        eprintln!("[hotkey] {e}");
    }
    errors
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    /// The user setting.
    pub enabled: bool,
    /// Hotkeys are actually being swallowed (setting on and permission granted).
    pub exclusive: bool,
    pub trusted: bool,
}

fn status(app: &AppHandle) -> HotkeyStatus {
    HotkeyStatus {
        enabled: crate::config::load(app).exclusive_hotkeys,
        exclusive: tap::is_active(),
        trusted: tap::is_trusted(),
    }
}

#[tauri::command]
pub fn hotkey_status(app: AppHandle) -> HotkeyStatus {
    status(&app)
}

#[tauri::command]
pub fn hotkey_set_exclusive(app: AppHandle, enabled: bool) -> Result<HotkeyStatus, String> {
    set_exclusive(&app, enabled)?;
    Ok(status(&app))
}

/// Shows the system prompt and opens Privacy & Security → Accessibility.
#[tauri::command]
pub fn hotkey_request_access() {
    tap::request_trust();
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
}

/// While recording a hotkey in settings, nothing may react to key presses.
#[tauri::command]
pub fn hotkey_set_recording(app: AppHandle, on: bool) {
    tap::set_recording(on);
    if on {
        let _ = app.global_shortcut().unregister_all();
    } else {
        apply(&app, &crate::config::load(&app).hotkeys);
    }
}

#[tauri::command]
pub fn hotkey_bindings(app: AppHandle) -> Vec<Binding> {
    crate::config::load(&app).hotkeys
}

/// Sync command on purpose: Tauri runs it on the main thread, which Carbon needs.
#[tauri::command]
pub fn hotkey_probe(app: AppHandle) -> Vec<probe::ProbeResult> {
    let cfg: Config = crate::config::load(&app);
    probe::probe(&cfg.hotkeys)
}
