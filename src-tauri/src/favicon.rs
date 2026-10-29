//! Web app icons: the site's own icon, found the way a browser does and cached as PNG.
//!
//! Reads the page's `<link rel="…icon…">` tags, preferring the large apple-touch-icon,
//! falls back to /favicon.ico, and converts with `sips` (ImageIO reads PNG, ICO, JPEG).
//! SVG icons are kept as SVG. Downloads go through `curl`, like the other system tools here.

use std::collections::HashSet;
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;

use base64::Engine;
use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Url};

/// Some sites only serve their real page to browsers.
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
/// Icons smaller than this are drawn small inside a tile rather than filling it.
const FILL_MIN_PX: u32 = 64;

/// Sites with no usable icon this session; not retried until the next launch.
static MISSING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebIcon {
    /// A data: URL.
    pub src: String,
    /// Big enough (or vector) to fill the whole tile.
    pub fill: bool,
}

fn curl(url: &str) -> Option<Vec<u8>> {
    let out = Command::new("curl")
        .args(["-sfL", "--max-time", "8", "--max-filesize", "4000000", "-A", USER_AGENT])
        .arg(url)
        .output()
        .ok()?;
    (out.status.success() && !out.stdout.is_empty()).then_some(out.stdout)
}

fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let re = Regex::new(&format!(r#"(?i)\b{name}\s*=\s*["']([^"']*)["']"#)).ok()?;
    re.captures(tag)?.get(1).map(|m| m.as_str())
}

/// Icon URLs from the page, best first, then /favicon.ico.
fn candidates(html: &str, base: &Url) -> Vec<Url> {
    let link = Regex::new(r"(?is)<link\b[^>]*>").unwrap();
    let mut found: Vec<(u8, u32, Url)> = link
        .find_iter(html)
        .filter_map(|m| {
            let tag = m.as_str();
            let rel = attr(tag, "rel")?.to_ascii_lowercase();
            if !rel.contains("icon") || rel.contains("mask-icon") {
                return None;
            }
            // Light and dark variants: the light one reads on our tiles in both themes.
            if attr(tag, "media").is_some_and(|m| m.contains("dark")) {
                return None;
            }
            let href = attr(tag, "href")?;
            let url = base.join(href).ok()?;
            let path = url.path().to_ascii_lowercase();
            let rank = if rel.contains("apple-touch-icon") {
                0
            } else if path.ends_with(".png") {
                1
            } else if path.ends_with(".svg") {
                2
            } else {
                3
            };
            let size = attr(tag, "sizes")
                .and_then(|s| s.split(['x', 'X']).next()?.parse().ok())
                .unwrap_or(0);
            Some((rank, size, url))
        })
        .collect();
    found.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    let mut urls: Vec<Url> = found.into_iter().map(|(_, _, u)| u).collect();
    if let Ok(ico) = base.join("/favicon.ico") {
        if !urls.contains(&ico) {
            urls.push(ico);
        }
    }
    urls
}

fn is_svg(bytes: &[u8]) -> bool {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_ascii_lowercase();
    head.contains("<svg")
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn pixel_width(png: &Path) -> u32 {
    Command::new("sips")
        .args(["-g", "pixelWidth"])
        .arg(png)
        .output()
        .ok()
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .split_whitespace()
                .last()?
                .parse()
                .ok()
        })
        .unwrap_or(0)
}

/// Writes the icon at `url` into the cache as .svg or .png; true on success.
fn download(url: &Url, stem: &Path) -> bool {
    let Some(bytes) = curl(url.as_str()) else {
        return false;
    };
    if is_svg(&bytes) {
        return fs::write(stem.with_extension("svg"), &bytes).is_ok();
    }
    let raw = stem.with_extension("download");
    if fs::write(&raw, &bytes).is_err() {
        return false;
    }
    // 128px: the largest tile is 44pt on a Retina screen. -Z never enlarges.
    let ok = Command::new("sips")
        .args(["-s", "format", "png", "-Z", "128"])
        .arg(&raw)
        .arg("--out")
        .arg(stem.with_extension("png"))
        .output()
        .is_ok_and(|o| o.status.success());
    let _ = fs::remove_file(&raw);
    ok
}

fn read_cached(stem: &Path) -> Option<WebIcon> {
    if let Ok(svg) = fs::read(stem.with_extension("svg")) {
        return Some(WebIcon {
            src: data_url("image/svg+xml", &svg),
            fill: true,
        });
    }
    let png = stem.with_extension("png");
    let bytes = fs::read(&png).ok()?;
    Some(WebIcon {
        src: data_url("image/png", &bytes),
        fill: pixel_width(&png) >= FILL_MIN_PX,
    })
}

/// Cache path without extension for the web app whose configured address is `url`.
fn stem_for(app: &AppHandle, url: &str) -> Option<std::path::PathBuf> {
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    let dir = app.path().app_cache_dir().ok()?.join("icons");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join(format!("web-{:016x}", h.finish())))
}

/// Second chance for sites that refuse plain downloads of their page (Cloudflare, e.g.
/// ChatGPT): the web app window got past that, so it hands over its `<head>`.
pub fn learn_from_page(app: &AppHandle, url: &str, page: &Url, head_html: &str) {
    let Some(stem) = stem_for(app, url) else { return };
    if read_cached(&stem).is_some() {
        return;
    }
    if candidates(head_html, page).iter().any(|u| download(u, &stem)) {
        if let Some(set) = MISSING.lock().unwrap().as_mut() {
            set.remove(url);
        }
        let _ = app.emit("webapp-icon", url);
    }
}

/// The icon of the site at `url`, fetched once and cached. None when it has none we can use.
#[tauri::command]
pub async fn webapp_icon(app: AppHandle, url: String) -> Option<WebIcon> {
    let stem = stem_for(&app, &url)?;
    if let Some(icon) = read_cached(&stem) {
        return Some(icon);
    }
    if MISSING.lock().unwrap().get_or_insert_with(HashSet::new).contains(&url) {
        return None;
    }
    let page = Url::parse(&url).ok()?;
    let html = curl(page.as_str()).map(|b| String::from_utf8_lossy(&b).into_owned());
    let found = candidates(html.as_deref().unwrap_or(""), &page)
        .iter()
        .any(|u| download(u, &stem));
    if !found {
        MISSING.lock().unwrap().get_or_insert_with(HashSet::new).insert(url);
        return None;
    }
    read_cached(&stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_apple_touch_icon_and_skips_dark() {
        let base = Url::parse("https://kimi.com/chat").unwrap();
        let html = r#"
            <link rel="shortcut icon" href="/favicon.ico">
            <link rel="icon" href="/favicon-dark.ico" media="(prefers-color-scheme: dark)">
            <link rel="icon" type="image/png" sizes="32x32" href="/i32.png">
            <link rel="icon" type="image/png" sizes="96x96" href="/i96.png">
            <link rel="apple-touch-icon" href="/pwa-192.png">"#;
        let urls: Vec<_> = candidates(html, &base).iter().map(|u| u.path().to_string()).collect();
        assert_eq!(urls, ["/pwa-192.png", "/i96.png", "/i32.png", "/favicon.ico"]);
    }

    /// Hits the network: `cargo test favicon::tests::real_sites -- --ignored`.
    #[test]
    #[ignore]
    fn real_sites() {
        let dir = std::env::temp_dir().join("ahatools-favicon-test");
        fs::create_dir_all(&dir).unwrap();
        // ChatGPT is missing on purpose: Cloudflare refuses curl; learn_from_page covers it.
        for site in ["https://chat.deepseek.com", "https://kimi.com"] {
            let page = Url::parse(site).unwrap();
            let html = curl(site).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
            let stem = dir.join(page.host_str().unwrap());
            let ok = candidates(&html, &page).iter().any(|u| download(u, &stem));
            let icon = read_cached(&stem);
            println!("{site}: found {ok}, fill {:?}", icon.map(|i| i.fill));
            assert!(ok, "{site}");
        }
    }

    #[test]
    fn absolute_hrefs_and_fallback() {
        let base = Url::parse("https://chat.deepseek.com").unwrap();
        let html = r#"<link rel="icon" type="image/x-icon" href="https://fe-static.deepseek.com/chat/favicon.svg">"#;
        let urls = candidates(html, &base);
        assert_eq!(urls[0].as_str(), "https://fe-static.deepseek.com/chat/favicon.svg");
        assert_eq!(urls[1].as_str(), "https://chat.deepseek.com/favicon.ico");
        assert_eq!(candidates("", &base).len(), 1);
    }
}
