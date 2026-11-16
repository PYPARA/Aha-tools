//! Web apps: sites like DeepSeek in their own long-lived windows.
//!
//! Each app gets a normal titled window ("web-<id>") loading the site directly. Closing it
//! only hides it, so the conversation, scroll position and login survive; the next open
//! shows it as it was. Cookies live in the default persistent WebKit store, so a login
//! also survives restarts. The windows have no capability: the site can't call AhaTools.

use tauri::Emitter;
use std::collections::HashMap;
use std::sync::{Mutex, mpsc};

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::config::{self, WebApp};

#[cfg(target_os = "macos")]
mod native;
mod session;
use session::Session;

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
static SESSION: Mutex<Session> = Mutex::new(Session::new());

/// Serialize creation, visibility, Dock policy and focus on the AppKit thread.
/// No session lock is held while calling native APIs (which may emit focus events).
fn on_main<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    #[cfg(target_os = "macos")]
    if objc2::MainThreadMarker::new().is_some() {
        return f(app.clone());
    }
    let (tx, rx) = mpsc::sync_channel(1);
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(f(app2));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|_| "无法执行网页窗口操作".to_string())?
}

fn sync_dock() -> Result<(), String> {
    let desired = {
        let s = SESSION.lock().unwrap();
        if s.wants_dock() == s.dock_visible {
            return Ok(());
        }
        s.wants_dock()
    };
    #[cfg(target_os = "macos")]
    native::set_dock_visible(
        desired,
        objc2::MainThreadMarker::new().expect("web app main thread"),
    )?;
    SESSION.lock().unwrap().dock_visible = desired;
    Ok(())
}

fn include_in_window_menu(w: &WebviewWindow, included: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    native::include_in_window_menu(
        w,
        included,
        objc2::MainThreadMarker::new().expect("web app main thread"),
    )?;
    Ok(())
}

/// Called after the local floating panels exist; they are never document windows.
pub fn init(app: &AppHandle) -> Result<(), String> {
    for name in ["panel", "menu", "super"] {
        if let Some(w) = app.get_webview_window(name) {
            include_in_window_menu(&w, false)?;
        }
    }
    Ok(())
}

fn label(id: &str) -> String {
    format!("{PREFIX}{id}")
}

/// The app id of a web app window, from its label.
pub fn id_of(window_label: &str) -> Option<&str> {
    window_label
        .strip_prefix(PREFIX)
        .filter(|id| !id.is_empty())
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
fn hide(app: &AppHandle, w: &WebviewWindow) -> Result<(), String> {
    remember(app, w);
    let hidden = w.hide().map_err(|e| e.to_string());
    SESSION
        .lock()
        .unwrap()
        .visibility_completed(w.label(), false, hidden)?;
    let menu = include_in_window_menu(w, false);
    let dock = sync_dock();
    menu.and(dock)
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
        .visible(false)
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
                let _ = w.eval_with_callback(
                    "document.head ? document.head.innerHTML : ''",
                    move |json| {
                        let head: String = serde_json::from_str(&json).unwrap_or_default();
                        let (app, url, page) = (app.clone(), url.clone(), page.clone());
                        // Downloads block; keep them off the main thread.
                        std::thread::spawn(move || {
                            crate::favicon::learn_from_page(&app, &url, &page, &head)
                        });
                    },
                );
            }
        });
    builder = match geo {
        Some(g) => builder.position(g.x, g.y),
        None => builder.center(),
    };
    let w = builder.build().map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    if let Err(error) = native::attach_refresh(
        &w,
        objc2::MainThreadMarker::new().expect("web app main thread"),
    ) {
        let _ = w.destroy();
        return Err(error);
    }

    let (app2, w2) = (app.clone(), w.clone());
    w.on_window_event(move |e| match e {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if let Err(error) = hide(&app2, &w2) {
                crate::relay::notify(&error);
            }
        }
        _ => {
            SESSION.lock().unwrap().observe(w2.label(), e);
            if matches!(e, WindowEvent::Destroyed) {
                if let Err(error) = sync_dock() {
                    eprintln!("[webapps] {error}");
                }
            }
        }
    });
    Ok(w)
}

fn present(w: &WebviewWindow) -> Result<(), String> {
    let shown = w
        .unminimize()
        .and_then(|_| w.show())
        .map_err(|e| e.to_string());
    SESSION
        .lock()
        .unwrap()
        .visibility_completed(w.label(), true, shown)?;
    let menu = include_in_window_menu(w, true);
    let dock = sync_dock();
    let focus = w.set_focus().map_err(|e| e.to_string());
    menu.and(dock).and(focus)
}

/// Shows the app's window, creating it the first time. The search panel gets out of the way.
pub fn open(app: &AppHandle, id: &str) -> Result<(), String> {
    let id = id.to_owned();
    on_main(app, move |app| open_main(&app, &id))
}

fn open_main(app: &AppHandle, id: &str) -> Result<(), String> {
    let web = find(app, id)?;
    crate::panel::hide(app);
    if let Some(w) = app.get_webview_window(&label(id)) {
        return present(&w);
    }
    let w = create(app, &web)?;
    present(&w)
}

/// For a hotkey: hides the window when it's already in front, otherwise opens it.
pub fn toggle(app: &AppHandle, id: &str) -> Result<(), String> {
    let id = id.to_owned();
    on_main(app, move |app| {
        if let Some(w) = app.get_webview_window(&label(&id)) {
            if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
                return hide(&app, &w);
            }
        }
        open_main(&app, &id)
    })
}

/// The Dock restores only explicitly open windows, including minimized ones.
pub fn reopen(app: &AppHandle) -> Result<(), String> {
    on_main(app, |app| {
        loop {
            let label = SESSION.lock().unwrap().recent().map(str::to_owned);
            let Some(label) = label else { break };
            if let Some(w) = app.get_webview_window(&label) {
                crate::panel::hide(&app);
                return present(&w);
            }
            SESSION.lock().unwrap().closed(&label);
        }
        sync_dock()?;
        crate::panel::show(&app);
        Ok(())
    })
}

/// Native button and ⌘R share this route; never reload the host panels.
pub fn reload_window(app: &AppHandle, window_label: &str) -> Result<(), String> {
    if id_of(window_label).is_none() {
        return Err("只能刷新网页应用窗口".into());
    }
    let label = window_label.to_owned();
    on_main(app, move |app| {
        app.get_webview_window(&label)
            .ok_or("网页窗口已关闭")?
            .reload()
            .map_err(|e| format!("无法刷新页面：{e}"))
    })
}

/// Applies renamed or removed apps to windows that are already open.
pub fn reconfigure(app: &AppHandle, apps: &[WebApp]) {
    let apps = apps.to_vec();
    let app2 = app.clone();
    // Configuration is saved under a lock: enqueue, do not wait for the UI thread.
    if let Err(error) = app.run_on_main_thread(move || {
        for (label, w) in app2.webview_windows() {
            let Some(id) = id_of(&label) else { continue };
            let result = match apps.iter().find(|a| a.id == id) {
                Some(web) => w.set_title(&web.name),
                None => w
                    .destroy()
                    .inspect(|_| SESSION.lock().unwrap().closed(&label)),
            };
            if let Err(error) = result {
                eprintln!("[webapps] 更新窗口失败：{error}");
            }
        }
        if let Err(error) = sync_dock() {
            eprintln!("[webapps] {error}");
        }
    }) {
        eprintln!("[webapps] 更新窗口失败：{error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edit_keeps_identity_bindings_and_complete_home_url() {
        let mut cfg=crate::config::Config::default();
        cfg.web_apps=vec![WebApp { id:"stable".into(),name:"旧名称".into(),url:"https://example.com/old".into(),keywords:vec![] }];
        let before=serde_json::to_value(&cfg).unwrap();
        let url="https://example.com/new/?next=/";
        update_definition(&mut cfg,"stable"," 新名称 ",url,vec!["new".into()]).unwrap();
        assert_eq!(cfg.web_apps[0].id,"stable"); assert_eq!(cfg.web_apps[0].name,"新名称"); assert_eq!(cfg.web_apps[0].url,url);
        let mut after=serde_json::to_value(&cfg).unwrap(); after["webApps"]=before["webApps"].clone(); assert_eq!(before,after);
        let valid=cfg.web_apps[0].clone(); assert!(update_definition(&mut cfg,"stable","bad","file:///tmp/",vec![]).is_err()); assert_eq!(cfg.web_apps[0].url,valid.url);
    }
    #[test]
    fn reload_routing_accepts_only_named_web_windows() {
        assert_eq!(id_of("web-deepseek"), Some("deepseek"));
        assert_eq!(id_of("web-site-2"), Some("site-2"));
        for label in ["panel", "menu", "super", "web-", "website"] {
            assert_eq!(id_of(label), None);
        }
    }
}

/// Async on purpose: Tauri builds windows from async commands without blocking the
/// thread that handles IPC.
#[tauri::command]
pub async fn webapp_open(app: AppHandle, id: String) -> Result<(), String> {
    open(&app, &id)
}

fn update_definition(cfg: &mut crate::config::Config, id: &str, name: &str, url: &str, keywords: Vec<String>) -> Result<(), String> {
    let url = Url::parse(url).map_err(|_| "请输入完整的 HTTP 或 HTTPS 网址")?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() || name.trim().is_empty() { return Err("请填写名称和有效网址".into()); }
    let web = cfg.web_apps.iter_mut().find(|w| w.id == id).ok_or("网页应用已移除")?;
    web.name = name.trim().into(); web.url = url.to_string(); web.keywords = keywords.into_iter().filter(|k| !k.trim().is_empty()).collect();
    Ok(())
}
#[tauri::command]
pub fn webapp_update(app: AppHandle, id: String, name: String, url: String, keywords: Vec<String>) -> Result<crate::config::Config, String> {
    let _guard = crate::config::WRITE_LOCK.lock().unwrap();
    let mut cfg = config::load(&app);
    update_definition(&mut cfg, &id, &name, &url, keywords)?;
    config::save_json(&app, "config", &cfg)?;
    reconfigure(&app, &cfg.web_apps);
    let _ = app.emit("config-changed", &cfg); crate::superpanel::refresh(&app); Ok(cfg)
}
