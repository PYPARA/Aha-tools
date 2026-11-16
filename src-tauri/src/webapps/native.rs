//! Native chrome only. External pages receive no additional IPC permissions.

use objc2::rc::Retained;
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{
    NSAccessibility, NSApplication, NSApplicationActivationPolicy, NSAutoresizingMaskOptions,
    NSButton, NSImage, NSImageNameRefreshTemplate, NSLayoutAttribute,
    NSTitlebarAccessoryViewController, NSView, NSWindow,
};
use objc2_foundation::{NSObjectProtocol, NSPoint, NSRect, NSSize, ns_string};
use tauri::{AppHandle, Manager, WebviewWindow};

struct RefreshContext {
    app: AppHandle,
    label: String,
}

define_class!(
    // SAFETY: We preserve the superclass's main-thread and initialization requirements.
    #[unsafe(super = NSTitlebarAccessoryViewController)]
    #[thread_kind = MainThreadOnly]
    #[name = "AhaToolsWebRefreshController"]
    #[ivars = RefreshContext]
    struct RefreshController;

    unsafe impl NSObjectProtocol for RefreshController {}

    impl RefreshController {
        #[unsafe(method(refreshPage:))]
        fn refresh_page(&self, _sender: &NSButton) {
            let ctx = self.ivars();
            if let Err(error) = super::reload_window(&ctx.app, &ctx.label) {
                crate::relay::notify(&error);
            }
        }
    }
);

fn window(w: &WebviewWindow, _mtm: MainThreadMarker) -> Result<&NSWindow, String> {
    let ptr = w.ns_window().map_err(|e| e.to_string())?;
    // SAFETY: Tauri owns the window; callers borrow it only on the main thread.
    unsafe { ptr.cast::<NSWindow>().as_ref() }.ok_or_else(|| "网页窗口已关闭".into())
}

pub(super) fn set_dock_visible(visible: bool, mtm: MainThreadMarker) -> Result<(), String> {
    let policy = if visible {
        NSApplicationActivationPolicy::Regular
    } else {
        NSApplicationActivationPolicy::Accessory
    };
    // Apply synchronously before focusing. Queued policy updates can overtake a close/reopen.
    if NSApplication::sharedApplication(mtm).setActivationPolicy(policy) {
        Ok(())
    } else {
        Err("无法更新 AhaTools 的程序坞图标".into())
    }
}

pub(super) fn include_in_window_menu(
    w: &WebviewWindow,
    included: bool,
    mtm: MainThreadMarker,
) -> Result<(), String> {
    window(w, mtm)?.setExcludedFromWindowsMenu(!included);
    Ok(())
}

pub(super) fn attach_refresh(w: &WebviewWindow, mtm: MainThreadMarker) -> Result<(), String> {
    let native = window(w, mtm)?;
    let this = RefreshController::alloc(mtm).set_ivars(RefreshContext {
        app: w.app_handle().clone(),
        label: w.label().to_owned(),
    });
    // SAFETY: NSTitlebarAccessoryViewController supports init, with no additional arguments.
    let controller: Retained<RefreshController> = unsafe { msg_send![super(this), init] };
    // SAFETY: Apple's exported image-name constant is immutable.
    let image = NSImage::imageNamed(unsafe { NSImageNameRefreshTemplate })
        .ok_or_else(|| "无法读取系统刷新图标".to_string())?;
    // SAFETY: refreshPage: is defined above with the NSButton action signature.
    // NSWindow retains the controller; NSButton's weak target stays valid for its whole lifetime.
    let button = unsafe {
        NSButton::buttonWithImage_target_action(
            &image,
            Some(&controller),
            Some(sel!(refreshPage:)),
            mtm,
        )
    };
    button.setBordered(false);
    button.setFrame(NSRect::new(NSPoint::new(4.0, 0.0), NSSize::new(28.0, 24.0)));
    // AppKit controls titlebar height, including fullscreen transitions.
    button.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewMinYMargin | NSAutoresizingMaskOptions::ViewMaxYMargin,
    );
    button.setToolTip(Some(ns_string!("刷新页面 ⌘R")));
    button.setAccessibilityLabel(Some(ns_string!("刷新页面")));
    let container = NSView::initWithFrame(
        NSView::alloc(mtm),
        NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(40.0, 24.0)),
    );
    container.addSubview(&button);
    controller.setView(&container);
    controller.setLayoutAttribute(NSLayoutAttribute::Right);
    native.addTitlebarAccessoryViewController(&controller);
    native.setExcludedFromWindowsMenu(true); // Included only after successfully showing.
    Ok(())
}
