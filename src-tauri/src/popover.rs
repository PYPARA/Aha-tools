//! The menu popover: a small borderless window under the tray icon, replacing the native
//! menu. Shows live network speed and the app's switches; hides when it loses focus.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

pub const LABEL: &str = "menu";
const WIDTH: f64 = 300.0;
const HEIGHT: f64 = 412.0;
/// Gap between the menu bar and the popover, in points.
const OFFSET: f64 = 6.0;

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
    let w2 = w.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            *BLUR_HIDDEN_AT.lock().unwrap() = Some(Instant::now());
            let _ = w2.hide();
        }
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
        let _ = w.hide();
        return;
    }

    let scale = w.scale_factor().unwrap_or(2.0);
    let pos = anchor.position.to_physical::<f64>(scale);
    let size = anchor.size.to_physical::<f64>(scale);
    let width = WIDTH * scale;
    let mut x = pos.x + size.width / 2.0 - width / 2.0;
    let y = pos.y + size.height + OFFSET * scale;
    // Keep it on the screen the icon is on.
    if let Ok(Some(m)) = app.monitor_from_point(pos.x, pos.y) {
        let left = m.position().x as f64 + 8.0 * scale;
        let right = left - 16.0 * scale + m.size().width as f64 - width;
        x = x.clamp(left, right.max(left));
    }
    let _ = w.set_position(PhysicalPosition::new(x, y));
    let _ = w.show();
    let _ = w.set_focus();
    let _ = app.emit_to(LABEL, "menu-shown", ());
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = window(app) {
        let _ = w.hide();
    }
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
