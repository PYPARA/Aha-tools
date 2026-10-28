//! Exclusive hotkeys via a HID-level CGEventTap.
//!
//! Carbon hotkeys are shared: when Aha, uTools and Codex all register ⌥Space, every one of
//! them fires. An event tap sees the key before any app does and can swallow it, so only
//! Aha reacts. This needs the Accessibility permission; without it the router falls back
//! to (shared) Carbon hotkeys.

use std::ffi::c_void;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

use super::Action;

type CFMachPortRef = *mut c_void;
type CGEventRef = *mut c_void;
type TapCallback = unsafe extern "C" fn(
    proxy: *mut c_void,
    etype: u32,
    event: CGEventRef,
    user: *mut c_void,
) -> CGEventRef;

const HID_EVENT_TAP: u32 = 0;
const HEAD_INSERT: u32 = 0;
const TAP_DEFAULT: u32 = 0;
const KEY_DOWN: u32 = 10;
const KEY_UP: u32 = 11;
const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;
const FIELD_AUTOREPEAT: u32 = 8;
const FIELD_KEYCODE: u32 = 9;

// CGEventFlags
const FLAG_SHIFT: u64 = 1 << 17;
const FLAG_CONTROL: u64 = 1 << 18;
const FLAG_ALT: u64 = 1 << 19;
const FLAG_COMMAND: u64 = 1 << 20;
const MOD_MASK: u64 = FLAG_SHIFT | FLAG_CONTROL | FLAG_ALT | FLAG_COMMAND;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: TapCallback,
        user_info: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    fn CGEventGetFlags(event: CGEventRef) -> u64;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFRunLoopCommonModes: *const c_void;
    static kCFBooleanTrue: *const c_void;
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
    fn CFMachPortCreateRunLoopSource(
        alloc: *const c_void,
        port: CFMachPortRef,
        order: isize,
    ) -> *mut c_void;
    fn CFRunLoopGetMain() -> *mut c_void;
    fn CFRunLoopAddSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
    fn CFDictionaryCreate(
        alloc: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *const c_void;
    fn CFRelease(cf: *const c_void);
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    static kAXTrustedCheckOptionPrompt: *const c_void;
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
}

#[derive(Clone, Debug)]
pub struct TapBinding {
    pub keycode: u16,
    pub flags: u64,
    pub action: Action,
}

struct State {
    app: AppHandle,
    tap: usize,
    bindings: Vec<TapBinding>,
    /// Keys whose key-down we swallowed; their key-up is swallowed too.
    held: Vec<u16>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);
/// User switch. The tap stays installed when off; it just lets every key through.
static ENABLED: AtomicBool = AtomicBool::new(true);

pub fn is_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Shows the system "allow Accessibility" prompt (adds Aha to the list in System Settings).
pub fn request_trust() -> bool {
    unsafe {
        let keys = [kAXTrustedCheckOptionPrompt];
        let values = [kCFBooleanTrue];
        let options = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            &raw const kCFTypeDictionaryKeyCallBacks,
            &raw const kCFTypeDictionaryValueCallBacks,
        );
        let trusted = AXIsProcessTrustedWithOptions(options);
        CFRelease(options);
        trusted
    }
}

pub fn is_installed() -> bool {
    STATE.lock().unwrap().is_some()
}

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

/// Installed and switched on: hotkeys are being swallowed.
pub fn is_active() -> bool {
    ENABLED.load(Ordering::Relaxed) && is_installed()
}

/// Creates the tap on the main run loop. Must be called on the main thread.
/// Returns false when not permitted (no Accessibility access yet).
pub fn install(app: &AppHandle) -> bool {
    let mut state = STATE.lock().unwrap();
    if state.is_some() {
        return true;
    }
    unsafe {
        let mask = (1u64 << KEY_DOWN) | (1u64 << KEY_UP);
        let tap = CGEventTapCreate(
            HID_EVENT_TAP,
            HEAD_INSERT,
            TAP_DEFAULT,
            mask,
            callback,
            std::ptr::null_mut(),
        );
        if tap.is_null() {
            return false;
        }
        let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
        if source.is_null() {
            return false;
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopCommonModes);
        CGEventTapEnable(tap, true);
        *state = Some(State {
            app: app.clone(),
            tap: tap as usize,
            bindings: vec![],
            held: vec![],
        });
    }
    true
}

pub fn set_bindings(bindings: Vec<TapBinding>) {
    if let Some(state) = STATE.lock().unwrap().as_mut() {
        state.bindings = bindings;
    }
}

/// Converts a parsed accelerator to (virtual key code, CGEventFlags).
pub fn binding_for(shortcut: &Shortcut, action: Action) -> Option<TapBinding> {
    let keycode = keycode(shortcut.key)?;
    let mut flags = 0;
    for (m, f) in [
        (Modifiers::SHIFT, FLAG_SHIFT),
        (Modifiers::CONTROL, FLAG_CONTROL),
        (Modifiers::ALT, FLAG_ALT),
        (Modifiers::SUPER, FLAG_COMMAND),
    ] {
        if shortcut.mods.contains(m) {
            flags |= f;
        }
    }
    Some(TapBinding {
        keycode,
        flags,
        action,
    })
}

unsafe extern "C" fn callback(
    _proxy: *mut c_void,
    etype: u32,
    event: CGEventRef,
    _user: *mut c_void,
) -> CGEventRef {
    let Ok(mut guard) = STATE.lock() else {
        return event;
    };
    let Some(state) = guard.as_mut() else {
        return event;
    };

    if etype == TAP_DISABLED_BY_TIMEOUT || etype == TAP_DISABLED_BY_USER_INPUT {
        // macOS disables taps that respond slowly; turn it straight back on.
        unsafe { CGEventTapEnable(state.tap as CFMachPortRef, true) };
        return event;
    }

    if !ENABLED.load(Ordering::Relaxed) {
        state.held.clear();
        return event;
    }

    let keycode = unsafe { CGEventGetIntegerValueField(event, FIELD_KEYCODE) } as u16;
    match etype {
        KEY_DOWN => {
            let flags = unsafe { CGEventGetFlags(event) } & MOD_MASK;
            let Some(b) = state
                .bindings
                .iter()
                .find(|b| b.keycode == keycode && b.flags == flags)
            else {
                return event;
            };
            let repeat = unsafe { CGEventGetIntegerValueField(event, FIELD_AUTOREPEAT) } != 0;
            if !repeat {
                // Defer: keep the tap callback fast and don't hold STATE while dispatching.
                let app = state.app.clone();
                let action = b.action.clone();
                let _ = state
                    .app
                    .run_on_main_thread(move || super::dispatch(&app, &action));
            }
            if !state.held.contains(&keycode) {
                state.held.push(keycode);
            }
            std::ptr::null_mut()
        }
        KEY_UP => match state.held.iter().position(|&k| k == keycode) {
            Some(i) => {
                state.held.swap_remove(i);
                std::ptr::null_mut()
            }
            None => event,
        },
        _ => event,
    }
}

/// macOS virtual key codes (ANSI layout).
fn keycode(code: Code) -> Option<u16> {
    use Code::*;
    Some(match code {
        KeyA => 0x00,
        KeyS => 0x01,
        KeyD => 0x02,
        KeyF => 0x03,
        KeyH => 0x04,
        KeyG => 0x05,
        KeyZ => 0x06,
        KeyX => 0x07,
        KeyC => 0x08,
        KeyV => 0x09,
        KeyB => 0x0B,
        KeyQ => 0x0C,
        KeyW => 0x0D,
        KeyE => 0x0E,
        KeyR => 0x0F,
        KeyY => 0x10,
        KeyT => 0x11,
        KeyO => 0x1F,
        KeyU => 0x20,
        KeyI => 0x22,
        KeyP => 0x23,
        KeyL => 0x25,
        KeyJ => 0x26,
        KeyK => 0x28,
        KeyN => 0x2D,
        KeyM => 0x2E,
        Digit1 => 0x12,
        Digit2 => 0x13,
        Digit3 => 0x14,
        Digit4 => 0x15,
        Digit5 => 0x17,
        Digit6 => 0x16,
        Digit7 => 0x1A,
        Digit8 => 0x1C,
        Digit9 => 0x19,
        Digit0 => 0x1D,
        Space => 0x31,
        Enter => 0x24,
        Tab => 0x30,
        Escape => 0x35,
        Backspace => 0x33,
        Backquote => 0x32,
        Minus => 0x1B,
        Equal => 0x18,
        BracketLeft => 0x21,
        BracketRight => 0x1E,
        Backslash => 0x2A,
        Semicolon => 0x29,
        Quote => 0x27,
        Comma => 0x2B,
        Period => 0x2F,
        Slash => 0x2C,
        ArrowLeft => 0x7B,
        ArrowRight => 0x7C,
        ArrowDown => 0x7D,
        ArrowUp => 0x7E,
        F1 => 0x7A,
        F2 => 0x78,
        F3 => 0x63,
        F4 => 0x76,
        F5 => 0x60,
        F6 => 0x61,
        F7 => 0x62,
        F8 => 0x64,
        F9 => 0x65,
        F10 => 0x6D,
        F11 => 0x67,
        F12 => 0x6F,
        F13 => 0x69,
        F14 => 0x6B,
        F15 => 0x71,
        F16 => 0x6A,
        F17 => 0x40,
        F18 => 0x4F,
        F19 => 0x50,
        F20 => 0x5A,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alt_space_maps_to_keycode_and_flags() {
        let s: Shortcut = "Alt+Space".parse().unwrap();
        let b = binding_for(&s, Action::TogglePanel).unwrap();
        assert_eq!((b.keycode, b.flags), (0x31, FLAG_ALT));
    }
}
