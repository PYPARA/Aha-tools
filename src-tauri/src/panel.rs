//! The search panel window: a borderless window toggled by the launcher hotkey,
//! hidden again when it loses focus. It has two sizes, search and page (settings and
//! plugin pages), each resizable by dragging an edge and remembered in window.json.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

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

#[derive(Default)]
struct Session {
    visible: bool,
    hidden_at: Option<Instant>,
}

impl Session {
    fn show(&mut self, mode: config::PanelReopen, direct_feature: bool, now: Instant) -> bool {
        let reset = !self.visible
            && !direct_feature
            && match mode {
                config::PanelReopen::Resume => false,
                config::PanelReopen::Search => true,
                config::PanelReopen::AfterFiveMinutes => self.hidden_at.is_some_and(|hidden| {
                    now.saturating_duration_since(hidden) > Duration::from_secs(300)
                }),
            };
        self.visible = true;
        self.hidden_at = None;
        reset
    }

    fn hide(&mut self, now: Instant) {
        // Focus loss can be reported again after hide. Count only the transition.
        if self.visible {
            self.visible = false;
            self.hidden_at = Some(now);
        }
    }
}

static SESSION: Mutex<Session> = Mutex::new(Session {
    visible: false,
    hidden_at: None,
});

#[derive(Clone, Serialize)]
struct PanelShown {
    reset: bool,
}

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
        WindowEvent::Focused(false)
            if !PINNED.load(Ordering::Relaxed) && !crate::screenshot::is_capturing() =>
        {
            hide(&app2);
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
    *OURS_UNTIL.lock().unwrap() = Some(Instant::now() + Duration::from_millis(400));
    let w2 = w.clone();
    let _ =
        w.run_on_main_thread(move || crate::window_position::resize_panel(&w2, (width, height)));
}

pub fn show(app: &AppHandle) {
    show_with_intent(app, false);
}

/// An explicit feature shortcut always opens its target, regardless of reopen mode.
pub fn show_feature(app: &AppHandle) {
    show_with_intent(app, true);
}

fn show_with_intent(app: &AppHandle, direct_feature: bool) {
    let Some(w) = window(app) else { return };
    crate::plugins::on_panel_shown(app);
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let reset = SESSION.lock().unwrap().show(
            config::load(&app2).panel_reopen,
            direct_feature,
            Instant::now(),
        );
        if reset {
            PAGE.store(false, Ordering::Relaxed);
        }
        *OURS_UNTIL.lock().unwrap() = Some(Instant::now() + Duration::from_millis(400));
        crate::window_position::place_panel(&w, current_size());
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app2.emit_to(LABEL, "panel-shown", PanelShown { reset });
    });
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = window(app) {
        SESSION.lock().unwrap().hide(Instant::now());
        let _ = w.hide();
        crate::hotkey::stop_recording(app);
        save(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use config::PanelReopen::*;

    #[test]
    fn reopen_policies_use_time_since_the_first_real_hide() {
        let now = Instant::now();
        for mode in [Resume, Search, AfterFiveMinutes] {
            for seconds in [0, 299, 300, 301, 600] {
                let mut session = Session::default();
                assert_eq!(session.show(mode, false, now), mode == Search);
                // Showing an already visible panel doesn't discard its page.
                assert!(!session.show(mode, false, now));
                session.hide(now);
                session.hide(now + Duration::from_secs(200));
                assert_eq!(
                    session.show(mode, false, now + Duration::from_secs(seconds)),
                    mode == Search || (mode == AfterFiveMinutes && seconds > 300)
                );
                assert!(session.hidden_at.is_none());
            }
        }
    }

    #[test]
    fn direct_features_override_reopen_policy_and_restart_the_next_hide_timer() {
        let now = Instant::now();
        let mut session = Session::default();
        session.show(Resume, false, now);
        session.hide(now);
        assert!(!session.show(Search, true, now + Duration::from_secs(600)));
        session.hide(now + Duration::from_secs(700));
        assert!(!session.show(AfterFiveMinutes, false, now + Duration::from_secs(800)));
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
