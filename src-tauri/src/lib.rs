mod config;
mod context;
mod clipboard;
mod favicon;
mod hotkey;
mod netspeed;
mod panel;
mod plugins;
mod popover;
mod relay;
mod screenshot;
mod superpanel;
mod superpanel_commands;
mod sysmon;
mod usage;
mod webapps;
mod window_position;

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
        .manage(plugins::translate::TranslationState::default())
        .setup(|app| {
            // Menu-bar only: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let cfg = config::load(app.handle());
            plugins::configure(&cfg);
            usage::init(app.handle());

            let launcher = Launcher::new(app.handle().clone());
            let mut registry = Registry::new();
            registry.add_provider(launcher::ID, launcher.clone());
            registry.add_provider(
                plugins::webapps::ID,
                std::sync::Arc::new(plugins::webapps::WebApps),
            );
            app.manage(registry);
            app.manage(launcher.clone());
            thread::spawn(move || launcher.refresh());

            panel::init(app.handle());
            plugins::compress::init(app.handle());
            popover::init(app.handle())?;
            superpanel::init(app.handle())?;
            plugins::system::init(app.handle());
            setup_tray(app, &cfg)?;
            setup_menu(app)?;
            hotkey::init(app.handle(), &cfg);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::config_get,
            config::config_set,
            config::config_dir,
            clipboard::clipboard_files,
            panel::hide_panel,
            panel::panel_pending,
            panel::panel_ack,
            superpanel::superpanel_state,
            superpanel::superpanel_open,
            superpanel::superpanel_run,
            superpanel::superpanel_hide,
            superpanel::superpanel_remove_pin,
            superpanel::superpanel_validate_command,
            superpanel::superpanel_pin_status,
            superpanel::superpanel_resize,
            superpanel::superpanel_toggle_pin,
            superpanel::superpanel_pin_first,
            plugins::system::system_run,
            plugins::system::system_ocr_get,
            plugins::processes::processes_snapshot,
            plugins::processes::processes_quit,
            panel::set_panel_pinned,
            panel::set_panel_large,
            plugins::list_plugins,
            plugins::search,
            plugins::search_files,
            plugins::compress::compress_start,
            plugins::compress::compress_reprocess,
            plugins::compress::compress_list_batches,
            plugins::compress::compress_export,
            plugins::open_path,
            plugins::qrcode::qr_read_image,
            plugins::qrcode::qr_save_png,
            plugins::hosts::hosts_load,
            plugins::hosts::hosts_validate,
            plugins::hosts::hosts_apply,
            plugins::hosts::hosts_restore,
            plugins::translate::translate_save_profile,
            plugins::translate::translate_delete_profile,
            plugins::translate::translate_has_key,
            plugins::translate::translate_select,
            plugins::translate::translate_list_models,
            plugins::translate::translate_test_connection,
            plugins::translate::translate_start,
            plugins::translate::translate_stop,
            launcher::launcher_saved,
            launcher::launcher_add,
            launcher::launcher_remove,
            launcher::app_icon,
            usage::usage_home,
            usage::usage_record,
            usage::usage_toggle_pin,
            usage::usage_forget,
            usage::usage_reorder_pinned,
            webapps::webapp_open,
            favicon::webapp_icon,
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
            sysmon::sysmon_snapshot,
            popover::menu_resize,
            popover::menu_hide,
            popover::menu_open_panel,
            popover::menu_open_feature,
            popover::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The app menu is never shown (menu-bar app), but macOS routes ⌘C / ⌘V / ⌘A / ⌘Z in
/// web views through it. Replaces Tauri's default, whose ⌘Q would quit all of AhaTools
/// from inside a web app window.
fn setup_menu(app: &App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

    let edit = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let reload = MenuItemBuilder::with_id("reload", "重新加载")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let window = SubmenuBuilder::new(app, "窗口")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::close_window(app, Some("关闭窗口"))?)
        .item(&reload)
        .build()?;
    let app_menu = SubmenuBuilder::new(app, "AhaTools").build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &window])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == "reload" {
            // Only web app windows; reloading the panel would lose its state for nothing.
            for (label, w) in app.webview_windows() {
                if webapps::id_of(&label).is_some() && w.is_focused().unwrap_or(false) {
                    let _ = w.eval("location.reload()");
                }
            }
        }
    });
    Ok(())
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
    sysmon::start(app.handle().clone(), &cfg.menubar);
    netspeed::start(app.handle().clone(), tray, &cfg.menubar);
    Ok(())
}
