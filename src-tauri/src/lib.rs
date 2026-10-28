mod config;
mod hotkey;
mod netspeed;
mod panel;
mod plugins;
mod popover;
mod relay;
mod screenshot;

use std::thread;

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Manager};

use plugins::launcher::{self, Launcher};
use plugins::{Registry, SearchProvider};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(hotkey::plugin())
        .manage(hotkey::Router::default())
        .setup(|app| {
            // Menu-bar only: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let cfg = config::load(app.handle());

            let launcher = Launcher::new(app.handle().clone());
            let mut registry = Registry::new();
            registry.add_provider(launcher::ID, launcher.clone());
            app.manage(registry);
            app.manage(launcher.clone());
            thread::spawn(move || launcher.refresh());

            panel::init(app.handle());
            popover::init(app.handle())?;
            setup_tray(app, &cfg)?;
            hotkey::init(app.handle(), &cfg);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::config_get,
            config::config_set,
            panel::hide_panel,
            panel::set_panel_pinned,
            plugins::list_plugins,
            plugins::search,
            plugins::open_path,
            launcher::launcher_saved,
            launcher::launcher_add,
            launcher::launcher_remove,
            hotkey::hotkey_bindings,
            hotkey::hotkey_probe,
            hotkey::hotkey_status,
            hotkey::hotkey_request_access,
            hotkey::hotkey_set_exclusive,
            hotkey::hotkey_set_recording,
            relay::relay_status,
            relay::relay_press_later,
            screenshot::screenshot_take,
            netspeed::netspeed_snapshot,
            popover::menu_open_panel,
            popover::menu_open_feature,
            popover::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &App, cfg: &config::Config) -> tauri::Result<()> {
    // No native menu: a left click opens the popover (popover.rs) under the icon.
    let tray = TrayIconBuilder::with_id("main")
        .title("AhaTools")
        .tooltip("AhaTools")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                popover::toggle(tray.app_handle(), rect);
            }
        })
        .build(app)?;

    // Sample even without the menu-bar display: the popover needs the numbers.
    netspeed::start(app.handle().clone(), cfg.netspeed.then_some(tray));
    Ok(())
}
