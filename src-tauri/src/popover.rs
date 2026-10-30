//! The menu popover: a small borderless window under the tray icon, replacing the native
//! menu. Shows live network speed and the app's switches; hides when it loses focus.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

pub const LABEL: &str = "menu";
const WIDTH: f64 = 300.0;
const HEIGHT: f64 = 720.0;
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
    let handle = app.clone();
    w.on_window_event(move |e| match e {
        WindowEvent::Focused(false) => {
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

    let initial_scale = w.scale_factor().unwrap_or(2.0);
    let anchor_pos = anchor.position.to_physical::<f64>(initial_scale);
    let monitor = app
        .monitor_from_point(anchor_pos.x, anchor_pos.y)
        .ok()
        .flatten();
    let scale = monitor
        .as_ref()
        .map(|m| m.scale_factor())
        .unwrap_or(initial_scale);
    let pos = anchor.position.to_physical::<f64>(scale);
    let size = anchor.size.to_physical::<f64>(scale);
    let width = WIDTH * scale;
    let mut x = pos.x + size.width / 2.0 - width / 2.0;
    let mut y = pos.y + size.height + OFFSET * scale;
    let mut height = HEIGHT;
    // Keep it on the screen the icon is on.
    if let Some(m) = monitor {
        let area = m.work_area();
        let left = area.position.x as f64 + 8.0 * scale;
        let right = area.position.x as f64 + area.size.width as f64 - 8.0 * scale - width;
        x = x.clamp(left, right.max(left));
        let top = area.position.y as f64 + OFFSET * scale;
        let bottom = area.position.y as f64 + area.size.height as f64 - 8.0 * scale;
        y = y.max(top).min(bottom - 1.0);
        height = HEIGHT.min(((bottom - y) / scale).max(1.0));
    }
    let _ = w.set_size(LogicalSize::new(WIDTH, height));
    let _ = w.set_position(PhysicalPosition::new(x, y));
    if w.show().is_err() {
        return;
    }
    crate::sysmon::set_menu_visible(true);
    let _ = w.set_focus();
    let _ = app.emit_to(LABEL, "menu-shown", ());
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
