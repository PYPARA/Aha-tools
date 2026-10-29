//! Web apps: sites like DeepSeek in their own long-lived windows.
//!
//! Each app gets a normal titled window ("web-<id>") loading the site directly. Closing it
//! only hides it, so the conversation, scroll position and login survive; the next open
//! shows it as it was. Cookies live in the default persistent WebKit store, so a login
//! also survives restarts. The windows have no capability: the site can't call AhaTools.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::config::{self, WebApp};

const PREFIX: &str = "web-";
const STORE: &str = "webapps";
const DEFAULT_SIZE: (f64, f64) = (1100.0, 760.0);

/// Window position and size per app, in logical points.
#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
struct Geometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

static GEOMETRY: Mutex<Option<HashMap<String, Geometry>>> = Mutex::new(None);

fn label(id: &str) -> String {
    format!("{PREFIX}{id}")
}

/// The app id of a web app window, from its label.
pub fn id_of(window_label: &str) -> Option<&str> {
    window_label.strip_prefix(PREFIX)
}

fn find(app: &AppHandle, id: &str) -> Result<WebApp, String> {
    config::load(app)
        .web_apps
        .into_iter()
        .find(|w| w.id == id)
        .ok_or_else(|| format!("找不到网页应用 {id}"))
}

fn geometry(app: &AppHandle, id: &str) -> Option<Geometry> {
    let mut guard = GEOMETRY.lock().unwrap();
    guard
        .get_or_insert_with(|| config::load_json(app, STORE))
        .get(id)
        .copied()
}

/// Remembers where the window is, so it reopens there (also after a restart).
fn remember(app: &AppHandle, w: &WebviewWindow) {
    let Some(id) = id_of(w.label()) else { return };
    let scale = w.scale_factor().unwrap_or(2.0);
    let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) else {
        return;
    };
    let (pos, size) = (pos.to_logical::<f64>(scale), size.to_logical::<f64>(scale));
    let mut guard = GEOMETRY.lock().unwrap();
    let map = guard.get_or_insert_with(|| config::load_json(app, STORE));
    map.insert(
        id.to_string(),
        Geometry {
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
        },
    );
    let _ = config::save_json(app, STORE, &*map);
}

/// Hides instead of closing; used for the close button and ⌘W.
pub fn hide(app: &AppHandle, w: &WebviewWindow) {
    remember(app, w);
    let _ = w.hide();
}

fn create(app: &AppHandle, web: &WebApp) -> Result<WebviewWindow, String> {
    let url: Url = web
        .url
        .parse()
        .map_err(|e| format!("网址不对：{} ({e})", web.url))?;
    let geo = geometry(app, &web.id);
    let (width, height) = geo.map_or(DEFAULT_SIZE, |g| (g.width, g.height));
    let mut builder = WebviewWindowBuilder::new(app, label(&web.id), WebviewUrl::External(url))
        .title(&web.name)
        .inner_size(width, height)
        .min_inner_size(480.0, 400.0)
        // Links that open a new window (most links in an answer) go to the default
        // browser. Navigation inside the window, logins included, is left alone.
        .on_new_window(|url, _features| {
            let _ = std::process::Command::new("open").arg(url.as_str()).spawn();
            NewWindowResponse::Deny
        })
        .on_page_load({
            let (app, url) = (app.clone(), web.url.clone());
            move |w, payload| {
                if payload.event() != PageLoadEvent::Finished {
                    return;
                }
                let (app, url, page) = (app.clone(), url.clone(), payload.url().clone());
                let _ = w.eval_with_callback("document.head ? document.head.innerHTML : ''", move |json| {
                    let head: String = serde_json::from_str(&json).unwrap_or_default();
                    let (app, url, page) = (app.clone(), url.clone(), page.clone());
                    // Downloads block; keep them off the main thread.
                    std::thread::spawn(move || crate::favicon::learn_from_page(&app, &url, &page, &head));
                });
            }
        });
    builder = match geo {
        Some(g) => builder.position(g.x, g.y),
        None => builder.center(),
    };
    let w = builder.build().map_err(|e| e.to_string())?;

    let (app2, w2) = (app.clone(), w.clone());
    w.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            hide(&app2, &w2);
        }
    });
    Ok(w)
}

fn present(w: &WebviewWindow) {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
}

/// Shows the app's window, creating it the first time. The search panel gets out of the way.
pub fn open(app: &AppHandle, id: &str) -> Result<(), String> {
    crate::panel::hide(app);
    if let Some(w) = app.get_webview_window(&label(id)) {
        present(&w);
        return Ok(());
    }
    let web = find(app, id)?;
    let w = create(app, &web)?;
    present(&w);
    Ok(())
}

/// For a hotkey: hides the window when it's already in front, otherwise opens it.
pub fn toggle(app: &AppHandle, id: &str) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&label(id)) {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            hide(app, &w);
            return Ok(());
        }
    }
    open(app, id)
}

/// Applies renamed or removed apps to windows that are already open.
pub fn reconfigure(app: &AppHandle, apps: &[WebApp]) {
    for (label, w) in app.webview_windows() {
        let Some(id) = id_of(&label) else { continue };
        match apps.iter().find(|a| a.id == id) {
            Some(web) => {
                let _ = w.set_title(&web.name);
            }
            None => {
                let _ = w.destroy();
            }
        }
    }
}

/// Async on purpose: Tauri builds windows from async commands without blocking the
/// thread that handles IPC.
#[tauri::command]
pub async fn webapp_open(app: AppHandle, id: String) -> Result<(), String> {
    open(&app, &id)
}
