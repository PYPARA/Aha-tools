//! Window geometry in AppKit screen points (bottom-left origin, y upwards).
//!
//! Do not mix Tauri's monitor, cursor and window "physical" coordinates here:
//! on macOS they can be multiplied by different displays' backing scales.
//! AppKit gives all screens and windows one shared coordinate system, including
//! screens to the left of, above and below the primary display.

use objc2::MainThreadMarker;
use objc2_app_kit::{NSEvent, NSScreen, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::WebviewWindow;

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl From<NSRect> for Rect {
    fn from(rect: NSRect) -> Self {
        Self {
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height,
        }
    }
}

impl Rect {
    fn top(self) -> f64 {
        self.y + self.height
    }

    fn contains(self, (x, y): (f64, f64)) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.top()
    }

    fn distance_squared(self, (x, y): (f64, f64)) -> f64 {
        (x - x.clamp(self.x, self.x + self.width)).powi(2)
            + (y - y.clamp(self.y, self.top())).powi(2)
    }

    fn constrain(self, area: Rect) -> Self {
        let margin = 8.0_f64.min(area.width / 4.0).min(area.height / 4.0);
        let width = self.width.min(area.width - 2.0 * margin);
        let height = self.height.min(area.height - 2.0 * margin);
        Self {
            x: self
                .x
                .clamp(area.x + margin, area.x + area.width - margin - width),
            y: self.y.clamp(area.y + margin, area.top() - margin - height),
            width,
            height,
        }
    }

    fn native(self) -> NSRect {
        NSRect::new(
            NSPoint::new(self.x, self.y),
            NSSize::new(self.width, self.height),
        )
    }
}

fn panel_frame(screen: Rect, work: Rect, (width, height): (f64, f64)) -> Rect {
    Rect {
        x: screen.x + (screen.width - width) / 2.0,
        y: screen.top() - screen.height * 0.22 - height,
        width,
        height,
    }
    .constrain(work)
}

fn popover_frame(
    screen: Rect,
    work: Rect,
    anchor: tauri::Rect,
    scale: f64,
    (width, height): (f64, f64),
) -> Rect {
    // tray-icon 0.25 multiplies the *whole* global x coordinate by the clicked
    // screen's scale. Undo that once, never using the popover's previous scale.
    let pos = anchor.position.to_logical::<f64>(scale);
    let size = anchor.size.to_logical::<f64>(scale);
    Rect {
        x: pos.x + size.width / 2.0 - width / 2.0,
        // Every menu bar belongs to the top of its own screen. Deriving this
        // from that screen also avoids tray-icon's primary-height y conversion.
        y: (screen.top() - size.height).min(work.top()) - 8.0 - height,
        width,
        height,
    }
    .constrain(work)
}

fn mouse_screen(mtm: MainThreadMarker) -> Option<objc2::rc::Retained<NSScreen>> {
    let mouse = NSEvent::mouseLocation();
    let point = (mouse.x, mouse.y);
    let screens = NSScreen::screens(mtm);
    screens
        .iter()
        .find(|screen| Rect::from(screen.frame()).contains(point))
        // A display can disappear between the click and this callback.
        .or_else(|| {
            screens.iter().min_by(|a, b| {
                Rect::from(a.frame())
                    .distance_squared(point)
                    .total_cmp(&Rect::from(b.frame()).distance_squared(point))
            })
        })
}

fn native_window(w: &WebviewWindow, _mtm: MainThreadMarker) -> Option<&NSWindow> {
    let ptr = w.ns_window().ok()?;
    // SAFETY: Tauri owns this NSWindow for the lifetime of `w`. All callers hold
    // a MainThreadMarker, and only borrow the window during this main-thread call.
    unsafe { ptr.cast::<NSWindow>().as_ref() }
}

/// Called on the main thread, before showing/focusing the panel.
pub fn place_panel(w: &WebviewWindow, size: (f64, f64)) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let (Some(window), Some(screen)) = (native_window(w, mtm), mouse_screen(mtm)) else {
        return;
    };
    window.setFrame_display(
        panel_frame(screen.frame().into(), screen.visibleFrame().into(), size).native(),
        false,
    );
}

/// Called on the main thread, before showing/focusing the menu popover.
pub fn place_popover(w: &WebviewWindow, anchor: tauri::Rect, size: (f64, f64)) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let (Some(window), Some(screen)) = (native_window(w, mtm), mouse_screen(mtm)) else {
        return;
    };
    window.setFrame_display(
        popover_frame(
            screen.frame().into(),
            screen.visibleFrame().into(),
            anchor,
            screen.backingScaleFactor(),
            size,
        )
        .native(),
        false,
    );
}

/// Preserve the search box's top edge and horizontal centre when opening a page.
pub fn resize_panel(w: &WebviewWindow, (width, height): (f64, f64)) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Some(window) = native_window(w, mtm) else {
        return;
    };
    let old = Rect::from(window.frame());
    let frame = Rect {
        x: old.x + (old.width - width) / 2.0,
        y: old.top() - height,
        width,
        height,
    };
    let frame = window.screen().map_or(frame, |screen| {
        frame.constrain(screen.visibleFrame().into())
    });
    if frame != old {
        window.setFrame_display(frame.native(), true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::{PhysicalPosition, PhysicalSize};

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn panel_uses_each_screens_origin_and_height() {
        for screen in [
            rect(0.0, 0.0, 1512.0, 982.0),
            rect(-1920.0, 100.0, 1920.0, 1080.0),
            rect(1512.0, -900.0, 1920.0, 1080.0),
            rect(200.0, 982.0, 2560.0, 1440.0),
        ] {
            let placed = panel_frame(screen, screen, (760.0, 500.0));
            assert_eq!(placed.x, screen.x + (screen.width - 760.0) / 2.0);
            assert!((placed.top() - (screen.top() - screen.height * 0.22)).abs() < 0.001);
        }
    }

    #[test]
    fn mixed_scale_tray_rects_have_the_same_logical_anchor() {
        let screen = rect(-1920.0, 100.0, 1920.0, 1080.0);
        let work = rect(-1920.0, 100.0, 1920.0, 1056.0);
        for scale in [1.0, 1.5, 2.0] {
            let anchor = tauri::Rect {
                position: PhysicalPosition::new(-500.0 * scale, -2000.0).into(),
                size: PhysicalSize::new(80.0 * scale, 24.0 * scale).into(),
            };
            assert_eq!(
                popover_frame(screen, work, anchor, scale, (300.0, 412.0)),
                rect(-610.0, 736.0, 300.0, 412.0)
            );
        }
    }

    #[test]
    fn popover_follows_upper_and_lower_screens_without_primary_y_offsets() {
        for y in [-1080.0, 0.0, 1440.0] {
            let screen = rect(1920.0, y, 1920.0, 1080.0);
            let work = rect(1920.0, y + 40.0, 1920.0, 1016.0);
            let anchor = tauri::Rect {
                position: PhysicalPosition::new(6400.0, 9999.0).into(),
                size: PhysicalSize::new(160.0, 48.0).into(),
            };
            let placed = popover_frame(screen, work, anchor, 2.0, (300.0, 412.0));
            assert_eq!(placed.x, 3090.0);
            assert_eq!(placed.top(), y + 1048.0);
        }
    }

    #[test]
    fn system_monitor_popover_fits_short_screens_at_each_scale() {
        let screen = rect(-1280.0, -900.0, 1280.0, 500.0);
        let work = rect(-1280.0, -900.0, 1280.0, 460.0);
        for scale in [1.0, 1.5, 2.0] {
            let anchor = tauri::Rect {
                position: PhysicalPosition::new(-500.0 * scale, 9999.0).into(),
                size: PhysicalSize::new(80.0 * scale, 24.0 * scale).into(),
            };
            let frame = popover_frame(screen, work, anchor, scale, (300.0, 720.0));
            assert_eq!(frame.width, 300.0);
            assert_eq!(frame.height, work.height - 16.0);
            assert_eq!(frame.x, -610.0);
            assert!(frame.y >= work.y + 8.0 && frame.top() <= work.top() - 8.0);
        }
    }

    #[test]
    fn windows_stay_inside_work_area_at_edges_and_with_oversized_saved_sizes() {
        let work = rect(-1280.0, -900.0, 1280.0, 860.0);
        for frame in [
            rect(-1500.0, -1200.0, 300.0, 412.0),
            rect(-20.0, 200.0, 300.0, 412.0),
            rect(-5000.0, -5000.0, 3000.0, 2000.0),
        ] {
            let placed = frame.constrain(work);
            assert!(
                placed.x >= work.x + 8.0 && placed.x + placed.width <= work.x + work.width - 8.0
            );
            assert!(placed.y >= work.y + 8.0 && placed.top() <= work.top() - 8.0);
        }
    }
}
