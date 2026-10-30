//! Menu-bar network speed, a replacement for eul.
//!
//! Reads 64-bit per-interface byte counters via `sysctl(NET_RT_IFLIST2)` once a second.
//! (`getifaddrs` only exposes 32-bit counters, which wrap at 4 GiB.)
//!
//! The tray icon is design A: vector ↑↓ arrows, upload over download, fixed-width digits
//! so the icon never jiggles. It's a template image, so macOS tints it for light and dark
//! menu bars. The last 60 seconds are kept for the menu popover's graph.

use std::collections::{HashMap, VecDeque};
use std::ffi::CStr;
use std::mem::size_of;
use std::ptr;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use ab_glyph::{Font, FontVec, Glyph, PxScale, ScaleFont, VariableFont, point};
use serde::Serialize;
use tauri::image::Image;
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Emitter};

use crate::config::MenubarItem;

/// Cumulative byte counters of one interface.
#[derive(Debug, Clone)]
pub struct Counters {
    pub name: String,
    pub rx: u64,
    pub tx: u64,
}

/// Counters of every physical interface that is up.
pub fn read_interfaces() -> Vec<Counters> {
    let mut mib = [libc::CTL_NET, libc::PF_ROUTE, 0, 0, libc::NET_RT_IFLIST2, 0];
    let mut len: libc::size_t = 0;
    let ok = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            6,
            ptr::null_mut(),
            &mut len,
            ptr::null_mut(),
            0,
        )
    };
    if ok != 0 {
        return vec![];
    }
    // Slack in case an interface appears between the two calls.
    len += 4096;
    let mut buf = vec![0u8; len];
    let ok = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            6,
            buf.as_mut_ptr().cast(),
            &mut len,
            ptr::null_mut(),
            0,
        )
    };
    if ok != 0 {
        return vec![];
    }

    let mut out = vec![];
    let mut off = 0usize;
    while off + 4 <= len {
        let msglen = u16::from_ne_bytes([buf[off], buf[off + 1]]) as usize;
        let msgtype = buf[off + 3] as i32;
        if msglen == 0 {
            break;
        }
        if msgtype == libc::RTM_IFINFO2 && off + size_of::<libc::if_msghdr2>() <= len {
            let m =
                unsafe { ptr::read_unaligned(buf.as_ptr().add(off) as *const libc::if_msghdr2) };
            if let Some(name) = counted_name(m.ifm_index, m.ifm_flags) {
                out.push(Counters {
                    name,
                    rx: m.ifm_data.ifi_ibytes,
                    tx: m.ifm_data.ifi_obytes,
                });
            }
        }
        off += msglen;
    }
    out
}

/// Total (received, sent) bytes across physical interfaces since they came up.
#[cfg(test)]
fn read_totals() -> (u64, u64) {
    read_interfaces()
        .iter()
        .fold((0, 0), |(rx, tx), c| (rx + c.rx, tx + c.tx))
}

/// Only physical `enN` interfaces (Wi-Fi, Ethernet, USB tethering) that are up.
/// VPN tunnels (utun*) would double-count traffic that also flows through en*.
fn counted_name(index: u16, flags: i32) -> Option<String> {
    if flags & libc::IFF_UP == 0 || flags & libc::IFF_LOOPBACK != 0 {
        return None;
    }
    let mut name = [0 as libc::c_char; libc::IF_NAMESIZE];
    let p = unsafe { libc::if_indextoname(index as u32, name.as_mut_ptr()) };
    if p.is_null() {
        return None;
    }
    let name = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
    name.starts_with("en").then_some(name)
}

/// Device → port name ("en0" → "Wi-Fi") from `networksetup -listallhardwareports`.
fn hardware_ports() -> HashMap<String, String> {
    let Ok(out) = std::process::Command::new("networksetup")
        .arg("-listallhardwareports")
        .output()
    else {
        return HashMap::new();
    };
    parse_hardware_ports(&String::from_utf8_lossy(&out.stdout))
}

fn parse_hardware_ports(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut port = None;
    for line in text.lines() {
        if let Some(p) = line.strip_prefix("Hardware Port: ") {
            port = Some(p.trim().to_string());
        } else if let (Some(d), Some(p)) = (line.strip_prefix("Device: "), port.take()) {
            map.insert(d.trim().to_string(), p);
        }
    }
    map
}

/// eul-style rate: "4 KB/s", "1.2 MB/s", "35 MB/s".
pub fn format_rate(bytes_per_sec: f64) -> String {
    let kb = bytes_per_sec / 1024.0;
    let (value, unit) = if kb < 1000.0 {
        (kb, "KB")
    } else if kb / 1024.0 < 1000.0 {
        (kb / 1024.0, "MB")
    } else {
        (kb / 1024.0 / 1024.0, "GB")
    };
    if unit != "KB" && value < 10.0 {
        format!("{value:.1} {unit}/s")
    } else {
        format!("{value:.0} {unit}/s")
    }
}

// ---- Tray icon (design A) ----

/// tray-icon scales icons to 18pt tall; draw at 2x for Retina.
const HEIGHT: u32 = 36;
/// Text size in px at 2x (9pt).
const TEXT_SIZE: f32 = 18.0;
const BASELINES: [f32; 2] = [15.0, 33.0];
const ARROW_WIDTH: f32 = 22.0;
const GAP: f32 = 8.0;
const STROKE: f32 = 2.6;
/// The two arrows in a 22×28 box (same geometry as the design), centred vertically.
const ARROW_TOP: f32 = (HEIGHT as f32 - 28.0) / 2.0;
const ARROWS: &[[(f32, f32); 2]] = &[
    [(6.0, 24.0), (6.0, 4.0)],
    [(1.5, 8.5), (6.0, 4.0)],
    [(10.5, 8.5), (6.0, 4.0)],
    [(16.0, 4.0), (16.0, 24.0)],
    [(11.5, 19.5), (16.0, 24.0)],
    [(20.5, 19.5), (16.0, 24.0)],
];

fn arrow_segments() -> Vec<[(f32, f32); 2]> {
    ARROWS
        .iter()
        .map(|[(x1, y1), (x2, y2)]| [(*x1, y1 + ARROW_TOP), (*x2, y2 + ARROW_TOP)])
        .collect()
}

pub struct Renderer {
    font: FontVec,
    scale: PxScale,
    /// Every digit takes this width (tabular figures), so values don't shift sideways.
    digit_width: f32,
    text_width: f32,
    percent_width: f32,
}

impl Renderer {
    pub fn new() -> Option<Self> {
        let bytes = std::fs::read("/System/Library/Fonts/SFNS.ttf").ok()?;
        let mut font = FontVec::try_from_vec(bytes).ok()?;
        font.set_variation(b"wght", 500.0);
        // ab_glyph's scale is ascent-to-descent height; convert from a CSS-style em size.
        let em = font.units_per_em()?;
        let scale = PxScale::from(TEXT_SIZE * font.height_unscaled() / em);
        let scaled = font.as_scaled(scale);
        let digit_width = ('0'..='9')
            .map(|c| scaled.h_advance(scaled.glyph_id(c)))
            .fold(0.0, f32::max);
        let mut r = Renderer {
            font,
            scale,
            digit_width,
            text_width: 0.0,
            percent_width: 0.0,
        };
        // Fixed column width = widest possible value, so the icon never changes width.
        r.text_width = ["999 KB/s", "9.9 MB/s", "999 MB/s", "9.9 GB/s"]
            .iter()
            .map(|s| r.measure(s))
            .fold(0.0, f32::max);
        r.percent_width = r.measure("100%");
        Some(r)
    }

    /// Black + alpha pixels, meant to be shown as a template image.
    pub fn render(&self, up: f64, down: f64) -> Image<'static> {
        let width = (ARROW_WIDTH + GAP + self.text_width).ceil() as u32 + 2;
        let mut canvas = Canvas {
            width,
            rgba: vec![0; (width * HEIGHT * 4) as usize],
        };
        canvas.stroke(&arrow_segments(), STROKE);

        for (text, baseline) in [format_rate(up), format_rate(down)].iter().zip(BASELINES) {
            let x = width as f32 - 2.0 - self.measure(text);
            self.draw(&mut canvas, text, x, baseline);
        }
        Image::new_owned(canvas.rgba, width, HEIGHT)
    }

    /// The AhaTools mark (a 2×2 grid of tiles), for when all metrics are switched off:
    /// arrows without numbers would still read as "network".
    pub fn render_idle() -> Image<'static> {
        const SIDE: f32 = 11.0;
        const GAP: f32 = 5.0;
        let width = (2.0 * SIDE + GAP) as u32 + 6;
        let top = (HEIGHT as f32 - (2.0 * SIDE + GAP)) / 2.0;
        let mut segments = vec![];
        for (col, row) in [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)] {
            let (x, y) = (3.0 + col * (SIDE + GAP), top + row * (SIDE + GAP));
            let (r, b) = (x + SIDE, y + SIDE);
            segments.extend([
                [(x, y), (r, y)],
                [(r, y), (r, b)],
                [(r, b), (x, b)],
                [(x, b), (x, y)],
            ]);
        }
        let mut canvas = Canvas {
            width,
            rgba: vec![0; (width * HEIGHT * 4) as usize],
        };
        canvas.stroke(&segments, 2.4);
        Image::new_owned(canvas.rgba, width, HEIGHT)
    }

    /// Each selected item has a fixed width, composed into one template image.
    pub fn render_menubar(
        &self,
        items: &[MenubarItem],
        up: f64,
        down: f64,
        cpu: Option<f64>,
        memory: Option<f64>,
    ) -> Image<'static> {
        if items.is_empty() {
            return Self::render_idle();
        }
        let parts: Vec<_> = items
            .iter()
            .map(|item| match item {
                MenubarItem::Netspeed => self.render(up, down),
                MenubarItem::Cpu => self.render_percent(*item, cpu),
                MenubarItem::Memory => self.render_percent(*item, memory),
            })
            .collect();
        const ITEM_GAP: u32 = 16;
        let width =
            parts.iter().map(|p| p.width()).sum::<u32>() + ITEM_GAP * (parts.len() - 1) as u32;
        let mut rgba = vec![0; (width * HEIGHT * 4) as usize];
        let mut left = 0;
        for part in parts {
            for y in 0..HEIGHT {
                let start = ((y * width + left) * 4) as usize;
                let source = (y * part.width() * 4) as usize;
                rgba[start..start + (part.width() * 4) as usize]
                    .copy_from_slice(&part.rgba()[source..source + (part.width() * 4) as usize]);
            }
            left += part.width() + ITEM_GAP;
        }
        Image::new_owned(rgba, width, HEIGHT)
    }

    fn render_percent(&self, item: MenubarItem, value: Option<f64>) -> Image<'static> {
        let width = (32.0 + GAP + self.percent_width).ceil() as u32 + 2;
        let mut canvas = Canvas {
            width,
            rgba: vec![0; (width * HEIGHT * 4) as usize],
        };
        let mut segments = vec![];
        let (left, top, right, bottom) = if item == MenubarItem::Cpu {
            (8.0, 8.0, 26.0, 28.0)
        } else {
            (2.0, 10.0, 32.0, 26.0)
        };
        segments.extend([
            [(left, top), (right, top)],
            [(right, top), (right, bottom)],
            [(right, bottom), (left, bottom)],
            [(left, bottom), (left, top)],
        ]);
        if item == MenubarItem::Cpu {
            for p in [12.0, 22.0] {
                segments.extend([
                    [(p, 3.0), (p, 7.0)],
                    [(p, 29.0), (p, 33.0)],
                    [(3.0, p), (7.0, p)],
                    [(27.0, p), (31.0, p)],
                ]);
            }
        } else {
            for x in [8.0, 16.0, 24.0] {
                segments.extend([[(x, 14.0), (x, 22.0)], [(x, 27.0), (x, 30.0)]]);
            }
        }
        canvas.stroke(&segments, 2.4);
        let text = percent_text(value);
        self.draw(
            &mut canvas,
            &text,
            width as f32 - 2.0 - self.measure(&text),
            24.0,
        );
        Image::new_owned(canvas.rgba, width, HEIGHT)
    }

    fn advance(&self, c: char) -> f32 {
        if c.is_ascii_digit() {
            return self.digit_width;
        }
        let f = self.font.as_scaled(self.scale);
        f.h_advance(f.glyph_id(c))
    }

    fn measure(&self, text: &str) -> f32 {
        text.chars().map(|c| self.advance(c)).sum()
    }

    fn draw(&self, canvas: &mut Canvas, text: &str, x: f32, baseline: f32) {
        let f = self.font.as_scaled(self.scale);
        let mut caret = x;
        for c in text.chars() {
            let id = f.glyph_id(c);
            // Centre each digit in its fixed-width cell.
            let inset = (self.advance(c) - f.h_advance(id)) / 2.0;
            let glyph: Glyph =
                id.with_scale_and_position(self.scale, point(caret + inset, baseline));
            if let Some(outline) = self.font.outline_glyph(glyph) {
                let b = outline.px_bounds();
                outline.draw(|gx, gy, coverage| {
                    canvas.blend(
                        b.min.x as i32 + gx as i32,
                        b.min.y as i32 + gy as i32,
                        coverage,
                    );
                });
            }
            caret += self.advance(c);
        }
    }
}

struct Canvas {
    width: u32,
    rgba: Vec<u8>,
}

impl Canvas {
    fn blend(&mut self, x: i32, y: i32, coverage: f32) {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= HEIGHT as i32 {
            return;
        }
        let alpha = &mut self.rgba[((y as u32 * self.width + x as u32) * 4 + 3) as usize];
        *alpha = (*alpha).max((coverage.clamp(0.0, 1.0) * 255.0) as u8);
    }

    /// Anti-aliased round-capped lines.
    fn stroke(&mut self, segments: &[[(f32, f32); 2]], width: f32) {
        let half = width / 2.0;
        for y in 0..HEIGHT as i32 {
            for x in 0..self.width as i32 {
                let p = (x as f32 + 0.5, y as f32 + 0.5);
                let d = segments
                    .iter()
                    .map(|[a, b]| distance_to_segment(p, *a, *b))
                    .fold(f32::MAX, f32::min);
                if d < half + 1.0 {
                    self.blend(x, y, half + 0.5 - d);
                }
            }
        }
    }
}

fn distance_to_segment(p: (f32, f32), a: (f32, f32), b: (f32, f32)) -> f32 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 {
        0.0
    } else {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0.0, 1.0)
    };
    let (cx, cy) = (a.0 + t * dx, a.1 + t * dy);
    ((p.0 - cx).powi(2) + (p.1 - cy).powi(2)).sqrt()
}

// ---- Sampling loop and popover data ----

const HISTORY: usize = 60;

/// What the menu popover shows; also emitted as the "netspeed" event every second.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Bytes per second.
    pub up: f64,
    pub down: f64,
    /// Last 60 seconds as [down, up], oldest first.
    pub history: Vec<[f64; 2]>,
    /// Bytes since the interfaces came up (roughly: since boot).
    pub rx_total: u64,
    pub tx_total: u64,
    /// Busiest interface, e.g. "en0", and its port name, e.g. "Wi-Fi".
    pub iface: Option<String>,
    pub iface_label: Option<String>,
}

static LATEST: Mutex<Option<Snapshot>> = Mutex::new(None);
/// Selected metrics in display order; an empty list shows the AhaTools mark.
static ITEMS: Mutex<Vec<MenubarItem>> = Mutex::new(Vec::new());

pub fn configure(items: &[MenubarItem]) {
    *ITEMS.lock().unwrap() = items.to_vec();
}

fn percent_text(value: Option<f64>) -> String {
    value
        .filter(|v| v.is_finite())
        .map(|v| format!("{:.0}%", v.clamp(0.0, 100.0)))
        .unwrap_or_else(|| "—".into())
}

fn title_fallback(
    items: &[MenubarItem],
    up: f64,
    down: f64,
    cpu: Option<f64>,
    memory: Option<f64>,
) -> String {
    items
        .iter()
        .map(|item| match item {
            MenubarItem::Netspeed => format!("↑{} ↓{}", format_rate(up), format_rate(down)),
            MenubarItem::Cpu => format!("CPU {}", percent_text(cpu)),
            MenubarItem::Memory => format!("RAM {}", percent_text(memory)),
        })
        .collect::<Vec<_>>()
        .join("  ")
}

#[tauri::command]
pub fn netspeed_snapshot() -> Snapshot {
    LATEST.lock().unwrap().clone().unwrap_or_default()
}

/// Samples once a second: redraws the tray icon and emits a `Snapshot`.
pub fn start(app: AppHandle, tray: TrayIcon, items: &[MenubarItem]) {
    configure(items);
    let renderer = Renderer::new();
    if let Some(r) = &renderer {
        let _ = tray.set_title(None::<&str>);
        let _ = tray
            .set_icon_with_as_template(Some(r.render_menubar(items, 0.0, 0.0, None, None)), true);
    }
    thread::spawn(move || {
        let ports = hardware_ports();
        let mut last: HashMap<String, (u64, u64)> = read_interfaces()
            .into_iter()
            .map(|c| (c.name, (c.rx, c.tx)))
            .collect();
        let mut last_t = Instant::now();
        let mut history: VecDeque<[f64; 2]> = VecDeque::with_capacity(HISTORY);
        let mut busiest: Option<String> = None;
        loop {
            thread::sleep(Duration::from_secs(1));
            let now = read_interfaces();
            let dt = last_t.elapsed().as_secs_f64().max(0.001);
            last_t = Instant::now();

            let (mut down, mut up, mut rx_total, mut tx_total) = (0.0, 0.0, 0, 0);
            let mut top = (0u64, None);
            for c in &now {
                // saturating_sub: counters reset when an interface goes away.
                let (prx, ptx) = last.get(&c.name).copied().unwrap_or((c.rx, c.tx));
                let (drx, dtx) = (c.rx.saturating_sub(prx), c.tx.saturating_sub(ptx));
                down += drx as f64 / dt;
                up += dtx as f64 / dt;
                rx_total += c.rx;
                tx_total += c.tx;
                if drx + dtx > top.0 {
                    top = (drx + dtx, Some(c.name.clone()));
                }
            }
            last = now.into_iter().map(|c| (c.name, (c.rx, c.tx))).collect();
            // Keep the last busy interface while idle.
            if top.1.is_some() {
                busiest = top.1;
            }

            if history.len() == HISTORY {
                history.pop_front();
            }
            history.push_back([down, up]);

            let snapshot = Snapshot {
                up,
                down,
                history: history.iter().copied().collect(),
                rx_total,
                tx_total,
                iface_label: busiest.as_ref().and_then(|i| ports.get(i).cloned()),
                iface: busiest.clone(),
            };
            *LATEST.lock().unwrap() = Some(snapshot.clone());
            let _ = app.emit("netspeed", snapshot);

            let items = ITEMS.lock().unwrap().clone();
            let system = crate::sysmon::sysmon_snapshot();
            let cpu = system.cpu.usage.data().copied();
            let memory = system
                .memory
                .data()
                .map(|m| 100.0 * m.used_bytes as f64 / m.total_bytes as f64);
            match &renderer {
                // Redrawn every second anyway, so toggling needs no extra bookkeeping.
                _ if items.is_empty() => {
                    let _ = tray.set_title(None::<&str>);
                    let _ = tray.set_icon_with_as_template(Some(Renderer::render_idle()), true);
                }
                // Not `set_icon`: tray-icon resets the template flag there, which leaves
                // black text that vanishes on a dark menu bar.
                Some(r) => {
                    let _ = tray.set_icon_with_as_template(
                        Some(r.render_menubar(&items, up, down, cpu, memory)),
                        true,
                    );
                }
                // No system font to draw with: fall back to a plain title.
                None => {
                    let _ = tray.set_icon_with_as_template(None::<Image<'_>>, true);
                    let _ = tray.set_title(Some(title_fallback(&items, up, down, cpu, memory)));
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_are_readable() {
        let (rx, tx) = read_totals();
        assert!(rx > 0 || tx > 0, "expected some traffic on en* since boot");
    }

    #[test]
    fn rate_format() {
        assert_eq!(format_rate(0.0), "0 KB/s");
        assert_eq!(format_rate(4.0 * 1024.0), "4 KB/s");
        assert_eq!(format_rate(1.25 * 1024.0 * 1024.0), "1.2 MB/s");
        assert_eq!(format_rate(35.0 * 1024.0 * 1024.0), "35 MB/s");
    }

    #[test]
    fn renders_fixed_width_icon() {
        let r = Renderer::new().expect("SF font available");
        let a = r.render(0.0, 0.0);
        let b = r.render(999.0 * 1024.0, 12.0 * 1024.0 * 1024.0);
        assert_eq!((a.width(), a.height()), (b.width(), b.height()));
        assert!(a.rgba().iter().skip(3).step_by(4).any(|&alpha| alpha > 0));
        // Same digit count, different digits: identical width thanks to tabular figures.
        assert_eq!(r.measure("111 KB/s"), r.measure("888 KB/s"));
    }

    #[test]
    fn hardware_ports_parse() {
        let text = "\nHardware Port: Wi-Fi\nDevice: en0\nEthernet Address: aa\n\nHardware Port: Thunderbolt Bridge\nDevice: bridge0\n";
        let map = parse_hardware_ports(text);
        assert_eq!(map.get("en0").map(String::as_str), Some("Wi-Fi"));
        assert_eq!(
            map.get("bridge0").map(String::as_str),
            Some("Thunderbolt Bridge")
        );
    }

    #[test]
    fn all_menubar_combinations_have_stable_width_and_preserve_order() {
        let r = Renderer::new().expect("SF font available");
        let choices = [MenubarItem::Netspeed, MenubarItem::Cpu, MenubarItem::Memory];
        for mask in 0..8 {
            let items: Vec<_> = choices
                .iter()
                .enumerate()
                .filter(|(i, _)| mask & (1 << i) != 0)
                .map(|(_, item)| *item)
                .collect();
            for order in [items.clone(), items.iter().rev().copied().collect()] {
                let waiting = r.render_menubar(&order, 0.0, 0.0, None, None);
                let zero = r.render_menubar(&order, 0.0, 0.0, Some(0.0), Some(0.0));
                let full =
                    r.render_menubar(&order, 512.0, 999.0 * 1024.0, Some(100.0), Some(100.0));
                assert_eq!(
                    (waiting.width(), waiting.height()),
                    (full.width(), full.height())
                );
                assert_eq!(zero.width(), full.width());
                assert!(waiting.rgba().iter().skip(3).step_by(4).any(|&a| a > 0));
                if let Some(first) = order.first() {
                    let solo = r.render_menubar(&[*first], 0.0, 0.0, None, None);
                    for y in 0..HEIGHT {
                        let a = (y * waiting.width() * 4) as usize;
                        let b = (y * solo.width() * 4) as usize;
                        assert_eq!(
                            &waiting.rgba()[a..a + solo.width() as usize * 4],
                            &solo.rgba()[b..b + solo.width() as usize * 4]
                        );
                    }
                }
            }
        }
        assert_eq!(percent_text(None), "—");
        assert_eq!(percent_text(Some(f64::NAN)), "—");
        assert_eq!(
            title_fallback(
                &[MenubarItem::Memory, MenubarItem::Cpu],
                0.0,
                0.0,
                Some(23.0),
                Some(70.0)
            ),
            "RAM 70%  CPU 23%"
        );
    }
}

#[cfg(test)]
mod preview {
    /// `AHATOOLS_PREVIEW=out.pgm cargo test preview -- --ignored` writes the icon on a dark
    /// menu bar; add `AHATOOLS_PREVIEW_IDLE=1` for the mark or `AHATOOLS_PREVIEW_SYSTEM=1`
    /// for network + CPU + memory.
    #[test]
    #[ignore]
    fn dump() {
        let r = super::Renderer::new().unwrap();
        let img = if std::env::var_os("AHATOOLS_PREVIEW_IDLE").is_some() {
            super::Renderer::render_idle()
        } else if std::env::var_os("AHATOOLS_PREVIEW_SYSTEM").is_some() {
            r.render_menubar(
                &[
                    crate::config::MenubarItem::Netspeed,
                    crate::config::MenubarItem::Cpu,
                    crate::config::MenubarItem::Memory,
                ],
                120.0 * 1024.0,
                3.4 * 1024.0 * 1024.0,
                Some(23.0),
                Some(70.0),
            )
        } else {
            r.render(120.0 * 1024.0, 3.4 * 1024.0 * 1024.0)
        };
        let (w, h) = (img.width(), img.height());
        let mut out = format!("P5 {w} {h} 255\n").into_bytes();
        out.extend(
            img.rgba()
                .chunks(4)
                .map(|p| 30 + (p[3] as u32 * 225 / 255) as u8),
        );
        std::fs::write(std::env::var("AHATOOLS_PREVIEW").unwrap(), out).unwrap();
    }
}
