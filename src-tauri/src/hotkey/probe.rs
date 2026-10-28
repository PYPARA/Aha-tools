//! Detects which candidate hotkeys are already taken.
//!
//! Two sources, because neither sees everything:
//! - macOS system shortcuts (screenshots, Spotlight, input source) from
//!   `com.apple.symbolichotkeys.plist`. These don't show up as Carbon registrations.
//! - Other apps' Carbon hotkeys: an exclusive `RegisterEventHotKey` fails with
//!   `eventHotKeyExistsErr` when someone already holds the combo *exclusively*. It can't
//!   tell *who*, so `KNOWN_OWNERS` adds a best-guess hint.
//!
//! Blind spots, so "free" means "nobody holds it exclusively", not "unused":
//! - Non-exclusive Carbon registrations (options = 0). The global-hotkey crate, and so AhaTools
//!   itself, registers this way; verified: AhaTools holding ⌥Space still probes as free.
//! - Apps that grab keys through an event tap (Karabiner, some launchers).
//! The event-tap router planned in `hotkey/mod.rs` is what removes the guesswork.

use std::ffi::c_void;
use std::path::PathBuf;

use serde::Serialize;
use tauri_plugin_global_shortcut::Shortcut;

use crate::config::Binding;

// Carbon modifier masks.
const CMD: u32 = 1 << 8;
const SHIFT: u32 = 1 << 9;
const OPT: u32 = 1 << 11;
const CTRL: u32 = 1 << 12;

// Virtual key codes.
const K_SPACE: u32 = 49;
const K_A: u32 = 0;
const K_X: u32 = 7;
const K_3: u32 = 20;
const K_4: u32 = 21;
const K_5: u32 = 23;
const K_F1: u32 = 122;

const K_EVENT_HOT_KEY_EXCLUSIVE: u32 = 1;
const EVENT_HOT_KEY_EXISTS_ERR: i32 = -9878;

#[repr(C)]
struct EventHotKeyID {
    signature: u32,
    id: u32,
}

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn RegisterEventHotKey(
        key_code: u32,
        modifiers: u32,
        id: EventHotKeyID,
        target: *mut c_void,
        options: u32,
        out_ref: *mut *mut c_void,
    ) -> i32;
    fn UnregisterEventHotKey(hot_key: *mut c_void) -> i32;
    fn GetApplicationEventTarget() -> *mut c_void;
}

struct Candidate {
    label: &'static str,
    accelerator: &'static str,
    purpose: &'static str,
    key: u32,
    mods: u32,
}

const CANDIDATES: &[Candidate] = &[
    Candidate {
        label: "⌥ Space",
        accelerator: "Alt+Space",
        purpose: "launcher",
        key: K_SPACE,
        mods: OPT,
    },
    Candidate {
        label: "⌘ Space",
        accelerator: "Super+Space",
        purpose: "launcher",
        key: K_SPACE,
        mods: CMD,
    },
    Candidate {
        label: "⌃ Space",
        accelerator: "Control+Space",
        purpose: "launcher",
        key: K_SPACE,
        mods: CTRL,
    },
    Candidate {
        label: "⌥⌘ Space",
        accelerator: "Alt+Super+Space",
        purpose: "launcher",
        key: K_SPACE,
        mods: OPT | CMD,
    },
    Candidate {
        label: "⌘⇧ 3",
        accelerator: "Super+Shift+3",
        purpose: "screenshot",
        key: K_3,
        mods: CMD | SHIFT,
    },
    Candidate {
        label: "⌘⇧ 4",
        accelerator: "Super+Shift+4",
        purpose: "screenshot",
        key: K_4,
        mods: CMD | SHIFT,
    },
    Candidate {
        label: "⌃⌘⇧ 4",
        accelerator: "Control+Super+Shift+4",
        purpose: "screenshot",
        key: K_4,
        mods: CTRL | CMD | SHIFT,
    },
    Candidate {
        label: "⌘⇧ 5",
        accelerator: "Super+Shift+5",
        purpose: "screenshot",
        key: K_5,
        mods: CMD | SHIFT,
    },
    Candidate {
        label: "⌃⌘ A",
        accelerator: "Control+Super+KeyA",
        purpose: "screenshot",
        key: K_A,
        mods: CTRL | CMD,
    },
    Candidate {
        label: "⌃⌥ A",
        accelerator: "Control+Alt+KeyA",
        purpose: "screenshot",
        key: K_A,
        mods: CTRL | OPT,
    },
    Candidate {
        label: "⌃⇧ A",
        accelerator: "Control+Shift+KeyA",
        purpose: "screenshot",
        key: K_A,
        mods: CTRL | SHIFT,
    },
    Candidate {
        label: "⌘⇧ A",
        accelerator: "Super+Shift+KeyA",
        purpose: "screenshot",
        key: K_A,
        mods: CMD | SHIFT,
    },
    Candidate {
        label: "⌥⇧ A",
        accelerator: "Alt+Shift+KeyA",
        purpose: "screenshot",
        key: K_A,
        mods: OPT | SHIFT,
    },
    Candidate {
        label: "⌘⇧ X",
        accelerator: "Super+Shift+KeyX",
        purpose: "screenshot",
        key: K_X,
        mods: CMD | SHIFT,
    },
    Candidate {
        label: "F1",
        accelerator: "F1",
        purpose: "screenshot",
        key: K_F1,
        mods: 0,
    },
];

/// Default owners of common combos. Guesses: the probe can't identify the process.
const KNOWN_OWNERS: &[(u32, u32, &str)] = &[
    (K_A, CTRL | CMD, "微信 / QQ 截图默认键，或 uTools"),
    (K_A, CTRL | OPT, "QQ 截图常用"),
    (K_A, CTRL | SHIFT, "钉钉截图默认键"),
    (K_SPACE, OPT, "uTools / Alfred 常用"),
    (K_SPACE, CMD | OPT, "Raycast / Alfred 常用"),
    (K_F1, 0, "Snipaste / PixPin 默认键"),
];

/// macOS symbolic hotkey ids we care about, with their default combo.
const SYSTEM_HOTKEYS: &[(&str, &str, u32, u32)] = &[
    ("28", "系统截屏：全屏存文件", K_3, CMD | SHIFT),
    ("29", "系统截屏：全屏到剪贴板", K_3, CTRL | CMD | SHIFT),
    ("30", "系统截屏：区域存文件", K_4, CMD | SHIFT),
    ("31", "系统截屏：区域到剪贴板", K_4, CTRL | CMD | SHIFT),
    ("184", "系统截屏工具", K_5, CMD | SHIFT),
    ("64", "Spotlight", K_SPACE, CMD),
    ("65", "Finder 搜索窗口", K_SPACE, CMD | OPT),
    ("60", "切换输入法", K_SPACE, CTRL),
    ("61", "切换输入法（下一个）", K_SPACE, CTRL | OPT),
];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub label: String,
    pub accelerator: String,
    pub purpose: String,
    /// "free" | "occupied" | "system" | "self"
    pub status: String,
    pub owner: Option<String>,
}

pub fn probe(own: &[Binding]) -> Vec<ProbeResult> {
    let system = enabled_system_hotkeys();
    let own: Vec<Shortcut> = own
        .iter()
        .filter(|b| b.enabled)
        .filter_map(|b| b.accelerator.parse().ok())
        .collect();

    CANDIDATES
        .iter()
        .map(|c| {
            let is_own = c
                .accelerator
                .parse::<Shortcut>()
                .is_ok_and(|s| own.contains(&s));
            let system_owner = system
                .iter()
                .find(|(_, k, m)| *k == c.key && *m == c.mods)
                .map(|(name, _, _)| name.to_string());

            let (status, owner) = if is_own {
                ("self", Some("AhaTools".to_string()))
            } else if let Some(name) = system_owner {
                ("system", Some(name))
            } else if is_taken(c.key, c.mods) {
                let hint = KNOWN_OWNERS
                    .iter()
                    .find(|(k, m, _)| *k == c.key && *m == c.mods)
                    .map(|(_, _, h)| format!("可能是：{h}"));
                ("occupied", hint)
            } else {
                ("free", None)
            };
            ProbeResult {
                label: c.label.into(),
                accelerator: c.accelerator.into(),
                purpose: c.purpose.into(),
                status: status.into(),
                owner,
            }
        })
        .collect()
}

/// Must run on the main thread.
fn is_taken(key: u32, mods: u32) -> bool {
    let mut hot_key: *mut c_void = std::ptr::null_mut();
    let status = unsafe {
        RegisterEventHotKey(
            key,
            mods,
            EventHotKeyID {
                signature: u32::from_be_bytes(*b"ATpb"),
                id: 1,
            },
            GetApplicationEventTarget(),
            K_EVENT_HOT_KEY_EXCLUSIVE,
            &mut hot_key,
        )
    };
    if !hot_key.is_null() {
        unsafe { UnregisterEventHotKey(hot_key) };
    }
    status == EVENT_HOT_KEY_EXISTS_ERR
}

/// Enabled system shortcuts as (name, key code, Carbon mods), honouring user overrides.
fn enabled_system_hotkeys() -> Vec<(&'static str, u32, u32)> {
    let path = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join("Library/Preferences/com.apple.symbolichotkeys.plist");
    let overrides = plist::Value::from_file(path)
        .ok()
        .and_then(|v| v.into_dictionary())
        .and_then(|mut d| d.remove("AppleSymbolicHotKeys"))
        .and_then(|v| v.into_dictionary())
        .unwrap_or_default();

    SYSTEM_HOTKEYS
        .iter()
        .filter_map(|&(id, name, key, mods)| {
            let Some(entry) = overrides.get(id).and_then(|v| v.as_dictionary()) else {
                return Some((name, key, mods)); // not customised: default applies
            };
            let enabled = entry
                .get("enabled")
                .and_then(|v| {
                    v.as_boolean()
                        .or_else(|| v.as_signed_integer().map(|i| i != 0))
                })
                .unwrap_or(true);
            if !enabled {
                return None;
            }
            // parameters = (ascii char, key code, NSEvent modifier flags)
            let params = entry
                .get("value")
                .and_then(|v| v.as_dictionary())
                .and_then(|v| v.get("parameters"))
                .and_then(|v| v.as_array());
            match params {
                Some(p) if p.len() == 3 => {
                    let key = p[1].as_signed_integer().unwrap_or(-1) as u32;
                    let flags = p[2].as_signed_integer().unwrap_or(0) as u64;
                    Some((name, key, ns_flags_to_carbon(flags)))
                }
                _ => Some((name, key, mods)),
            }
        })
        .collect()
}

fn ns_flags_to_carbon(flags: u64) -> u32 {
    let mut m = 0;
    if flags & (1 << 17) != 0 {
        m |= SHIFT
    }
    if flags & (1 << 18) != 0 {
        m |= CTRL
    }
    if flags & (1 << 19) != 0 {
        m |= OPT
    }
    if flags & (1 << 20) != 0 {
        m |= CMD
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ns_flags_convert() {
        // ⌘⇧ as stored by macOS: 1179648 = (1<<20)|(1<<17)
        assert_eq!(ns_flags_to_carbon(1_179_648), CMD | SHIFT);
        assert_eq!(ns_flags_to_carbon(262_144), CTRL);
    }

    #[test]
    fn candidate_accelerators_parse() {
        for c in CANDIDATES {
            assert!(
                c.accelerator.parse::<Shortcut>().is_ok(),
                "{}",
                c.accelerator
            );
        }
    }
}
