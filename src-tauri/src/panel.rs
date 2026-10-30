//! The search panel window: a borderless window toggled by the launcher hotkey,
//! hidden again when it loses focus. It has two sizes, search and page (settings and
//! plugin pages), each resizable by dragging an edge and remembered in window.json.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};

use crate::config;

pub const LABEL: &str = "panel";
const STORE: &str = "window";

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(default)]
struct Sizes {
    search: (f64, f64),
    page: (f64, f64),
}

impl Default for Sizes {
    fn default() -> Self {
        Sizes {
            search: (760.0, 500.0),
            page: (880.0, 580.0),
        }
    }
}

static SIZES: Mutex<Option<Sizes>> = Mutex::new(None);
/// Showing a settings or plugin page rather than search.
static PAGE: AtomicBool = AtomicBool::new(false);
/// Resize events until then come from `resize`, not from the user dragging an edge.
static OURS_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
/// While pinned, losing focus doesn't hide the panel (e.g. a file dialog is open).
static PINNED: AtomicBool = AtomicBool::new(false);

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

fn sizes() -> Sizes {
    SIZES.lock().unwrap().unwrap_or_default()
}

fn current_size() -> (f64, f64) {
    let s = sizes();
    if PAGE.load(Ordering::Relaxed) {
        s.page
    } else {
        s.search
    }
}

pub fn init(app: &AppHandle) {
    *SIZES.lock().unwrap() = Some(config::load_json(app, STORE));
    let Some(w) = window(app) else { return };
    let (w2, app2) = (w.clone(), app.clone());
    w.on_window_event(move |e| match e {
        WindowEvent::Focused(false) if !PINNED.load(Ordering::Relaxed) => {
            let _ = w2.hide();
            crate::hotkey::stop_recording(&app2);
            save(&app2);
        }
        WindowEvent::Resized(size) => remember(&w2, *size),
        _ => {}
    });
}

/// Keeps a size the user dragged to, for the mode on screen.
fn remember(w: &WebviewWindow, size: tauri::PhysicalSize<u32>) {
    let ours = OURS_UNTIL
        .lock()
        .unwrap()
        .is_some_and(|t| Instant::now() < t);
    if ours || !w.is_visible().unwrap_or(false) {
        return;
    }
    let scale = w.scale_factor().unwrap_or(2.0);
    let logical = size.to_logical::<f64>(scale);
    let mut guard = SIZES.lock().unwrap();
    let s = guard.get_or_insert_with(Sizes::default);
    let slot = if PAGE.load(Ordering::Relaxed) {
        &mut s.page
    } else {
        &mut s.search
    };
    *slot = (logical.width, logical.height);
}

fn save(app: &AppHandle) {
    let _ = config::save_json(app, STORE, &sizes());
}

/// Resizes keeping the top edge and the horizontal centre, so the search box doesn't jump.
fn resize(w: &WebviewWindow, (width, height): (f64, f64)) {
    let (Ok(pos), Ok(size), Ok(scale)) = (w.outer_position(), w.outer_size(), w.scale_factor())
    else {
        return;
    };
    if (size.width as f64 - width * scale).abs() < 1.0
        && (size.height as f64 - height * scale).abs() < 1.0
    {
        return;
    }
    *OURS_UNTIL.lock().unwrap() = Some(Instant::now() + Duration::from_millis(400));
    let x = pos.x as f64 + (size.width as f64 - width * scale) / 2.0;
    let _ = w.set_size(LogicalSize::new(width, height));
    let _ = w.set_position(PhysicalPosition::new(x, pos.y as f64));
}

pub fn show(app: &AppHandle) {
    let Some(w) = window(app) else { return };
    crate::plugins::on_panel_shown(app);
    // Reopens on the page that was showing (the frontend keeps it), at that page's size.
    resize(&w, current_size());
    let _ = w.show();
    let _ = w.set_focus();
    let _ = app.emit("panel-shown", ());
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = window(app) {
        let _ = w.hide();
        crate::hotkey::stop_recording(app);
        save(app);
    }
}

pub fn toggle(app: &AppHandle) {
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

/// Switches between the search size and the page size.
#[tauri::command]
pub fn set_panel_large(app: AppHandle, large: bool) {
    PAGE.store(large, Ordering::Relaxed);
    if let Some(w) = window(&app) {
        resize(&w, current_size());
    }
}

/// Latest unacknowledged navigation survives the webview's initial load.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub id: u64,
    pub plugin: String,
    pub feature: String,
    pub input: Option<String>,
    pub view_only: bool,
    pub query: Option<String>,
}
static REQUEST: Mutex<Option<Request>> = Mutex::new(None);
static NEXT_REQUEST: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub fn open_feature(
    app: &AppHandle,
    plugin: &str,
    feature: &str,
    input: Option<String>,
    view_only: bool,
) {
    send_request(
        app,
        Request {
            id: 0,
            plugin: plugin.into(),
            feature: feature.into(),
            input,
            view_only,
            query: None,
        },
    );
}
pub fn open_query(app: &AppHandle, query: String) {
    send_request(
        app,
        Request {
            id: 0,
            plugin: String::new(),
            feature: String::new(),
            input: None,
            view_only: false,
            query: Some(query),
        },
    );
}
fn send_request(app: &AppHandle, mut request: Request) {
    request.id = NEXT_REQUEST.fetch_add(1, Ordering::Relaxed);
    *REQUEST.lock().unwrap() = Some(request.clone());
    show(app);
    let _ = app.emit_to(
        LABEL,
        if request.query.is_some() {
            "panel-query"
        } else {
            "open-feature"
        },
        &request,
    );
}
#[tauri::command]
pub fn panel_pending() -> Option<Request> {
    REQUEST.lock().unwrap().clone()
}
#[tauri::command]
pub fn panel_ack(id: u64) {
    let mut pending = REQUEST.lock().unwrap();
    if pending.as_ref().is_some_and(|r| r.id == id) {
        *pending = None;
    }
}
