//! The search panel window: a borderless window toggled by the launcher hotkey,
//! hidden again when it loses focus.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow, WindowEvent};

pub const LABEL: &str = "panel";

/// While pinned, losing focus doesn't hide the panel (e.g. a file dialog is open).
static PINNED: AtomicBool = AtomicBool::new(false);

fn window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(LABEL)
}

pub fn init<R: Runtime>(app: &AppHandle<R>) {
    let Some(w) = window(app) else { return };
    let w2 = w.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            if !PINNED.load(Ordering::Relaxed) {
                let _ = w2.hide();
            }
        }
    });
}

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let Some(w) = window(app) else { return };
    crate::plugins::on_panel_shown(app);
    let _ = w.show();
    let _ = w.set_focus();
    let _ = app.emit("panel-shown", ());
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = window(app) {
        let _ = w.hide();
    }
}

pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let Some(w) = window(app) else { return };
    if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
        hide(app);
    } else {
        show(app);
    }
}

#[tauri::command]
pub fn hide_panel(app: AppHandle) {
    hide(&app);
}

#[tauri::command]
pub fn set_panel_pinned(pinned: bool) {
    PINNED.store(pinned, Ordering::Relaxed);
}
