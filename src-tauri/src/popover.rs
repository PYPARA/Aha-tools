//! The menu popover: a small borderless window under the tray icon, replacing the native
//! menu. Shows live network speed and the app's switches; hides when it loses focus.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Emitter, Manager, Rect, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

pub const LABEL: &str = "menu";
const WIDTH: f64 = 300.0;
const HEIGHT: f64 = 720.0;

/// When the popover last hid itself on blur. A click on the tray icon blurs the popover
/// first, so a toggle right after that must not show it again.
static BLUR_HIDDEN_AT: Mutex<Option<Instant>> = Mutex::new(None);

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?view=menu".into()))
        .title("AhaTools")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        .build()?;
    let handle = app.clone();
    w.on_window_event(move |e| match e {
        WindowEvent::Focused(false) => {
            if crate::screenshot::is_capturing() {
                return;
            }
            *BLUR_HIDDEN_AT.lock().unwrap() = Some(Instant::now());
            hide(&handle);
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            hide(&handle);
        }
        WindowEvent::Destroyed => crate::sysmon::set_menu_visible(false),
        _ => {}
    });
    Ok(())
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Shows the popover centred under the tray icon at `anchor`, or hides it.
pub fn toggle(app: &AppHandle, anchor: Rect) {
    let Some(w) = window(app) else { return };
    let just_hidden = BLUR_HIDDEN_AT
        .lock()
        .unwrap()
        .is_some_and(|t| t.elapsed() < Duration::from_millis(300));
    if w.is_visible().unwrap_or(false) || just_hidden {
        hide(app);
        return;
    }

    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        crate::window_position::place_popover(&w, anchor, (WIDTH, HEIGHT));
        if w.show().is_err() {
            return;
        }
        crate::sysmon::set_menu_visible(true);
        let _ = w.set_focus();
        let _ = app2.emit_to(LABEL, "menu-shown", ());
    });
}

pub fn hide(app: &AppHandle) {
    crate::sysmon::set_menu_visible(false);
    if let Some(w) = window(app) {
        let _ = w.hide();
    }
    let _ = app.emit_to(LABEL, "menu-hidden", ());
}

#[tauri::command]
pub fn menu_hide(app: AppHandle) {
    hide(&app);
}

/// Popover actions. Each closes the popover first.
#[tauri::command]
pub fn menu_open_panel(app: AppHandle) {
    hide(&app);
    crate::panel::show(&app);
}

#[tauri::command]
pub fn menu_open_feature(app: AppHandle, plugin: String, feature: String) {
    hide(&app);
    crate::hotkey::dispatch(
        &app,
        &crate::hotkey::Action::OpenFeature { plugin, feature },
    );
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
