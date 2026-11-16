mod config;
mod context;
mod clipboard;
mod clipboard_watch;
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
        .on_window_event(|window, event| { if let tauri::WindowEvent::Focused(focused) = event { hotkey::tap::local_focus(window.label(), *focused); } })
        .setup(|app| {
            // Menu-bar only: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            launcher::migrate_data(app.handle());
            let cfg = config::load(app.handle());
            plugins::configure(&cfg);
            usage::init(app.handle());
            clipboard_watch::start(app.handle().clone());
            plugins::clipboard_history::init(app.handle());

            let launcher = Launcher::new(app.handle().clone());
            let mut registry = Registry::new();
            registry.add_provider(launcher::ID, launcher.clone());
            registry.add_provider(plugins::network::ID, std::sync::Arc::new(plugins::network::Answers));
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
            webapps::init(app.handle())?;
            hotkey::init(app.handle(), &cfg);
            Ok(())
        })
        .invoke_handler({
            let handler: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
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
            superpanel::superpanel_edit_pins,
            plugins::system::system_run,
            plugins::system::system_ocr_get,
            plugins::processes::processes_snapshot,
            plugins::processes::processes_quit,
            plugins::network::network_local,
            plugins::network::network_public_ip,
            plugins::network::network_ping_start,
            plugins::network::network_ping_stop,
            plugins::network::network_dns,
            plugins::network::network_ports,
            plugins::clipboard_history::clipboard_history_list,
            plugins::clipboard_history::clipboard_history_get,
            plugins::clipboard_history::clipboard_history_image,
            plugins::clipboard_history::clipboard_history_image_action,
            plugins::clipboard_history::clipboard_history_use,
            plugins::clipboard_history::clipboard_history_pin,
            plugins::clipboard_history::clipboard_history_delete,
            plugins::clipboard_history::clipboard_history_restore,
            plugins::clipboard_history::clipboard_history_undo_state,
            plugins::clipboard_history::clipboard_history_clear,
            panel::set_panel_pinned,
            panel::set_panel_large,
            plugins::list_plugins,
            plugins::search,
            plugins::search_files,
            plugins::compress::compress_start,
            plugins::compress::compress_reprocess,
            plugins::compress::compress_list_batches,
            plugins::compress::compress_export,
            plugins::compress::compress_result_action,
            plugins::compress::compress_retry,
            plugins::open_path,
            plugins::reveal_path,
            plugins::reveal_paths,
            clipboard_watch::clipboard_mark_own,
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
            launcher::launcher_update,
            launcher::launcher_open,
            launcher::launcher_apps,
            launcher::launcher_add,
            launcher::launcher_remove,
            launcher::app_icon,
            usage::usage_home,
            usage::usage_record,
            usage::usage_toggle_pin,
            usage::usage_forget,
            usage::usage_reorder_pinned,
            webapps::webapp_open,
            webapps::webapp_update,
            panel::host_open_feature,
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
        ];
            move |invoke: tauri::ipc::Invoke| {
                if !matches!(invoke.message.webview_ref().label(), "panel" | "menu" | "super") { invoke.resolver.reject("此命令仅供 AhaTools 本地面板使用"); return true; }
                handler(invoke)
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Err(error) = webapps::reopen(app) { crate::relay::notify(&error); }
            }
        });
}

/// The app menu appears while web windows are open. macOS routes ⌘C / ⌘V / ⌘A / ⌘Z in
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
    #[cfg(target_os = "macos")]
    window.set_as_windows_menu_for_nsapp()?;
    app.on_menu_event(|app, event| {
        if event.id() == "reload" {
            // Only web app windows; reloading the panel would lose its state for nothing.
            if let Some((label, _)) = app.webview_windows().into_iter().find(|(label, w)| {
                webapps::id_of(label).is_some() && w.is_focused().unwrap_or(false)
            }) {
                if let Err(error) = webapps::reload_window(app, &label) {
                    crate::relay::notify(&error);
                }
            }
        }
    });
    Ok(())
}

fn setup_tray(app: &App, cfg: &config::Config) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let search = MenuItem::with_id(app, "tray-search", "打开搜索面板", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "tray-settings", "设置…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出 AhaTools", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&search, &settings, &separator, &quit])?;
    let tray = TrayIconBuilder::with_id("main")
        .title("AhaTools")
        .tooltip("AhaTools")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-search" => { superpanel::hide(app); popover::hide(app); panel::show(app); },
            "tray-settings" => { popover::hide(app); panel::open_feature(app, "settings", "general", None, false); },
            "tray-quit" => app.exit(0),
            _ => {},
        })
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
