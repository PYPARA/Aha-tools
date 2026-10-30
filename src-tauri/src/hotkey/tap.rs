//! Exclusive hotkeys via a HID-level CGEventTap.
//!
//! Carbon hotkeys are shared: when AhaTools, uTools and Codex all register ⌥Space, every one of
//! them fires. An event tap sees the key before any app does and can swallow it, so only
//! AhaTools reacts. This needs the Accessibility permission; without it the router falls back
//! to (shared) Carbon hotkeys.

use std::ffi::c_void;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};
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
/// kCGEventSourceUserData: free for the poster's own use.
const FIELD_SOURCE_USER_DATA: u32 = 42;
/// Marks key events AhaTools posts itself, so the tap lets them through.
const SYNTHETIC_MARK: i64 = 0x4154_4b59; // "ATKY"
const SOURCE_STATE_HID_SYSTEM: i32 = 1;

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
    fn CGEventSourceCreate(state: i32) -> *mut c_void;
    fn CGEventCreateKeyboardEvent(source: *mut c_void, keycode: u16, key_down: bool) -> CGEventRef;
    fn CGEventSetFlags(event: CGEventRef, flags: u64);
    fn CGEventSetIntegerValueField(event: CGEventRef, field: u32, value: i64);
    fn CGEventPost(tap: u32, event: CGEventRef);
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
/// While a hotkey is being recorded in settings, every key goes through to the page.
static RECORDING: AtomicBool = AtomicBool::new(false);

pub fn set_recording(on: bool) {
    RECORDING.store(on, Ordering::Relaxed);
}

pub fn is_recording() -> bool {
    RECORDING.load(Ordering::Relaxed)
}

pub fn is_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Shows the system "allow Accessibility" prompt (adds AhaTools to the list in System Settings).
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
    Some(TapBinding {
        keycode: keycode(shortcut.key)?,
        flags: flags_for(shortcut.mods),
        action,
    })
}

fn flags_for(mods: Modifiers) -> u64 {
    [
        (Modifiers::SHIFT, FLAG_SHIFT),
        (Modifiers::CONTROL, FLAG_CONTROL),
        (Modifiers::ALT, FLAG_ALT),
        (Modifiers::SUPER, FLAG_COMMAND),
    ]
    .into_iter()
    .filter(|(m, _)| mods.contains(*m))
    .fold(0, |acc, (_, f)| acc | f)
}

/// Modifier keys in the order a person presses them, with their key codes.
const MODIFIER_KEYS: [(u64, u16); 4] = [
    (FLAG_CONTROL, 0x3B),
    (FLAG_ALT, 0x3A),
    (FLAG_SHIFT, 0x38),
    (FLAG_COMMAND, 0x37),
];

/// The key events of typing `keycode` with `flags` held: each modifier goes down one by
/// one, then the key, then the modifiers come up in reverse, as with a real keyboard. Some
/// apps track modifiers from those separate events and miss ones that only ride on the
/// key event (QQ recorded ⌘⌃2 when sent a lone ⌃⌥⇧⌘2).
fn key_sequence(keycode: u16, flags: u64) -> Vec<(u16, bool, u64)> {
    let mods: Vec<_> = MODIFIER_KEYS.iter().filter(|(f, _)| flags & f != 0).collect();
    let mut held = 0;
    let mut seq = vec![];
    for &&(f, k) in &mods {
        held |= f;
        seq.push((k, true, held));
    }
    seq.push((keycode, true, flags));
    seq.push((keycode, false, flags));
    for &&(f, k) in mods.iter().rev() {
        held &= !f;
        seq.push((k, false, held));
    }
    seq
}

/// Presses and releases `shortcut` as if typed, for other apps' global hotkeys to see.
/// Needs Accessibility permission. Blocks for a few milliseconds per key.
pub fn post_shortcut(shortcut: &Shortcut) -> Result<(), String> {
    if !is_trusted() {
        return Err("需要先在系统设置里允许 AhaTools 使用「辅助功能」".into());
    }
    let keycode = keycode(shortcut.key).ok_or("这个按键不支持代按")?;
    let flags = flags_for(shortcut.mods);
    unsafe {
        let source = CGEventSourceCreate(SOURCE_STATE_HID_SYSTEM);
        for (key, down, flags) in key_sequence(keycode, flags) {
            let event = CGEventCreateKeyboardEvent(source, key, down);
            if event.is_null() {
                continue;
            }
            CGEventSetFlags(event, flags);
            CGEventSetIntegerValueField(event, FIELD_SOURCE_USER_DATA, SYNTHETIC_MARK);
            CGEventPost(HID_EVENT_TAP, event);
            CFRelease(event);
            // Apps read modifier state as events arrive; give each one a moment.
            std::thread::sleep(std::time::Duration::from_millis(8));
        }
        if !source.is_null() {
            CFRelease(source);
        }
    }
    Ok(())
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

    if RECORDING.load(Ordering::Relaxed) {
        // Record here rather than in the page: the combo may never reach the web view
        // (macOS or another app can claim it first). Swallow it so nothing else reacts.
        let keycode = unsafe { CGEventGetIntegerValueField(event, FIELD_KEYCODE) } as u16;
        if etype == KEY_DOWN {
            let flags = unsafe { CGEventGetFlags(event) } & MOD_MASK;
            if let Some(acc) = accelerator_for(keycode, flags) {
                state.held.push(keycode);
                let app = state.app.clone();
                let _ = state.app.run_on_main_thread(move || {
                    let _ = app.emit("hotkey-recorded", acc);
                });
                return std::ptr::null_mut();
            }
        } else if etype == KEY_UP {
            if let Some(i) = state.held.iter().position(|&k| k == keycode) {
                state.held.swap_remove(i);
                return std::ptr::null_mut();
            }
        }
        return event;
    }
    if unsafe { CGEventGetIntegerValueField(event, FIELD_SOURCE_USER_DATA) } == SYNTHETIC_MARK {
        return event;
    }
    // Cancel an already running screenshot even if exclusive hotkeys were switched off.
    if etype == KEY_DOWN && unsafe { CGEventGetIntegerValueField(event, FIELD_KEYCODE) } == 0x35 {
        crate::screenshot::cancel();
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
const KEYS: &[(Code, u16)] = &[
    (Code::KeyA, 0x00),
    (Code::KeyS, 0x01),
    (Code::KeyD, 0x02),
    (Code::KeyF, 0x03),
    (Code::KeyH, 0x04),
    (Code::KeyG, 0x05),
    (Code::KeyZ, 0x06),
    (Code::KeyX, 0x07),
    (Code::KeyC, 0x08),
    (Code::KeyV, 0x09),
    (Code::KeyB, 0x0B),
    (Code::KeyQ, 0x0C),
    (Code::KeyW, 0x0D),
    (Code::KeyE, 0x0E),
    (Code::KeyR, 0x0F),
    (Code::KeyY, 0x10),
    (Code::KeyT, 0x11),
    (Code::KeyO, 0x1F),
    (Code::KeyU, 0x20),
    (Code::KeyI, 0x22),
    (Code::KeyP, 0x23),
    (Code::KeyL, 0x25),
    (Code::KeyJ, 0x26),
    (Code::KeyK, 0x28),
    (Code::KeyN, 0x2D),
    (Code::KeyM, 0x2E),
    (Code::Digit1, 0x12),
    (Code::Digit2, 0x13),
    (Code::Digit3, 0x14),
    (Code::Digit4, 0x15),
    (Code::Digit5, 0x17),
    (Code::Digit6, 0x16),
    (Code::Digit7, 0x1A),
    (Code::Digit8, 0x1C),
    (Code::Digit9, 0x19),
    (Code::Digit0, 0x1D),
    (Code::Space, 0x31),
    (Code::Enter, 0x24),
    (Code::Tab, 0x30),
    (Code::Escape, 0x35),
    (Code::Backspace, 0x33),
    (Code::Backquote, 0x32),
    (Code::Minus, 0x1B),
    (Code::Equal, 0x18),
    (Code::BracketLeft, 0x21),
    (Code::BracketRight, 0x1E),
    (Code::Backslash, 0x2A),
    (Code::Semicolon, 0x29),
    (Code::Quote, 0x27),
    (Code::Comma, 0x2B),
    (Code::Period, 0x2F),
    (Code::Slash, 0x2C),
    (Code::ArrowLeft, 0x7B),
    (Code::ArrowRight, 0x7C),
    (Code::ArrowDown, 0x7D),
    (Code::ArrowUp, 0x7E),
    (Code::F1, 0x7A),
    (Code::F2, 0x78),
    (Code::F3, 0x63),
    (Code::F4, 0x76),
    (Code::F5, 0x60),
    (Code::F6, 0x61),
    (Code::F7, 0x62),
    (Code::F8, 0x64),
    (Code::F9, 0x65),
    (Code::F10, 0x6D),
    (Code::F11, 0x67),
    (Code::F12, 0x6F),
    (Code::F13, 0x69),
    (Code::F14, 0x6B),
    (Code::F15, 0x71),
    (Code::F16, 0x6A),
    (Code::F17, 0x40),
    (Code::F18, 0x4F),
    (Code::F19, 0x50),
    (Code::F20, 0x5A),
];

fn keycode(code: Code) -> Option<u16> {
    KEYS.iter().find(|(c, _)| *c == code).map(|&(_, k)| k)
}

fn code_for(keycode: u16) -> Option<Code> {
    KEYS.iter().find(|&&(_, k)| k == keycode).map(|&(c, _)| c)
}

/// "Control+Alt+KeyA" from a key-down, in the order the settings page writes them.
/// None for keys without modifiers (except F-keys): they'd fire while typing.
fn accelerator_for(keycode: u16, flags: u64) -> Option<String> {
    let code = code_for(keycode)?;
    let mut parts: Vec<String> = [
        (FLAG_CONTROL, "Control"),
        (FLAG_ALT, "Alt"),
        (FLAG_SHIFT, "Shift"),
        (FLAG_COMMAND, "Super"),
    ]
    .iter()
    .filter(|(f, _)| flags & f != 0)
    .map(|(_, n)| n.to_string())
    .collect();
    let name = code.to_string();
    if parts.is_empty() && !(name.starts_with('F') && name[1..].parse::<u8>().is_ok()) {
        return None;
    }
    parts.push(name);
    Some(parts.join("+"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hyper_digit_parses_for_relay_keys() {
        let s: Shortcut = "Control+Alt+Shift+Super+Digit1".parse().unwrap();
        let b = binding_for(&s, Action::TogglePanel).unwrap();
        assert_eq!(b.keycode, 0x12);
        assert_eq!(b.flags, MOD_MASK);
    }

    #[test]
    fn modifiers_press_one_by_one() {
        let seq = key_sequence(0x13, FLAG_CONTROL | FLAG_COMMAND);
        assert_eq!(
            seq,
            vec![
                (0x3B, true, FLAG_CONTROL),
                (0x37, true, FLAG_CONTROL | FLAG_COMMAND),
                (0x13, true, FLAG_CONTROL | FLAG_COMMAND),
                (0x13, false, FLAG_CONTROL | FLAG_COMMAND),
                (0x37, false, FLAG_CONTROL),
                (0x3B, false, 0),
            ]
        );
    }

    #[test]
    fn recorded_combo_round_trips() {
        let acc = accelerator_for(0x00, FLAG_COMMAND | FLAG_SHIFT).unwrap();
        assert_eq!(acc, "Shift+Super+KeyA");
        let s: Shortcut = acc.parse().unwrap();
        assert_eq!(binding_for(&s, Action::TogglePanel).unwrap().keycode, 0x00);
        assert_eq!(accelerator_for(0x31, FLAG_ALT).as_deref(), Some("Alt+Space"));
        assert_eq!(accelerator_for(0x7A, 0).as_deref(), Some("F1"));
        assert!(accelerator_for(0x00, 0).is_none());
    }

    #[test]
    fn alt_space_maps_to_keycode_and_flags() {
        let s: Shortcut = "Alt+Space".parse().unwrap();
        let b = binding_for(&s, Action::TogglePanel).unwrap();
        assert_eq!((b.keycode, b.flags), (0x31, FLAG_ALT));
    }
}
