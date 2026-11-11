//! What a piece of text looks like, so features can offer themselves for it: a pasted
//! JSON document finds 格式化 JSON, a domain finds ping. Manifests list these as
//! `match.types`.

use std::net::IpAddr;
use std::sync::LazyLock;

use regex::Regex;

pub const URL: &str = "url";
pub const JSON: &str = "json";
pub const IP: &str = "ip";
pub const DOMAIN: &str = "domain";
pub const PORT: &str = "port";
pub const PATH: &str = "path";

/// Last labels that are far more often file extensions than top-level domains.
const FILE_EXTENSIONS: [&str; 40] = [
    "md", "json", "txt", "js", "mjs", "ts", "tsx", "jsx", "rs", "py", "go", "java", "png", "jpg", "jpeg", "gif", "svg", "pdf", "zip",
    "html", "css", "toml", "yaml", "yml", "lock", "log", "sh", "app", "dmg", "doc", "docx", "xls", "xlsx", "csv", "mp3", "mp4", "mov",
    "webp", "heic", "swift",
];

static DOMAIN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63})\.?$").unwrap()
});

/// Every kind `text` is, most specific first; empty for ordinary text.
pub fn kinds(text: &str) -> Vec<&'static str> {
    let t = text.trim();
    if t.is_empty() || t.len() > 4 * 1024 * 1024 {
        return vec![];
    }
    let mut kinds = vec![];
    if (t.starts_with('{') || t.starts_with('['))
        && serde_json::from_str::<serde_json::Value>(t).is_ok_and(|v| v.is_object() || v.is_array())
    {
        kinds.push(JSON);
    }
    if t.chars().any(char::is_whitespace) {
        return kinds;
    }
    if tauri::Url::parse(t).is_ok_and(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some()) {
        kinds.push(URL);
    }
    if t.parse::<IpAddr>().is_ok() {
        kinds.push(IP);
    } else if let Some(tld) = DOMAIN_RE.captures(t).and_then(|c| c.get(1)) {
        if !FILE_EXTENSIONS.contains(&tld.as_str().to_ascii_lowercase().as_str()) {
            kinds.push(DOMAIN);
        }
    }
    let digits = t.strip_prefix(':').unwrap_or(t);
    if (2..=5).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit()) && digits.parse::<u16>().is_ok_and(|p| p > 0) {
        kinds.push(PORT);
    }
    if (t.starts_with('/') || t.starts_with("~/")) && std::path::Path::new(&super::expand_home(t)).exists() {
        kinds.push(PATH);
    }
    kinds
}

/// The host to ping or look up: the text itself, or a URL's host.
pub fn host(text: &str) -> Option<String> {
    let t = text.trim();
    let kinds = kinds(t);
    if kinds.contains(&IP) || kinds.contains(&DOMAIN) {
        return Some(t.trim_end_matches('.').to_string());
    }
    tauri::Url::parse(t).ok().filter(|_| kinds.contains(&URL)).and_then(|u| u.host_str().map(|h| h.trim_matches(['[', ']']).to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_each_kind() {
        assert_eq!(kinds(r#" {"a": [1, 2]} "#), [JSON]);
        assert_eq!(kinds("[1, 2, 3]"), [JSON]);
        assert_eq!(kinds("https://example.com/a?b=1"), [URL]);
        assert_eq!(kinds("192.168.1.10"), [IP]);
        assert_eq!(kinds("::1"), [IP]);
        assert_eq!(kinds("github.com"), [DOMAIN]);
        assert_eq!(kinds("api.例子.com").len(), 0, "IDN needs punycode; not offered");
        assert_eq!(kinds("3000"), [PORT]);
        assert_eq!(kinds(":8080"), [PORT]);
        assert_eq!(kinds("/Applications"), [PATH]);
    }

    #[test]
    fn ordinary_text_and_look_alikes_are_nothing() {
        for text in ["", "hello world", "README.md", "package.json", "{not json", "1", "70000", "123456", "/no/such/path/here", "微信", "a.b c.d"] {
            assert!(kinds(text).is_empty(), "{text}: {:?}", kinds(text));
        }
    }

    #[test]
    fn hosts_come_from_domains_ips_and_urls() {
        assert_eq!(host("github.com.").as_deref(), Some("github.com"));
        assert_eq!(host("10.0.0.1").as_deref(), Some("10.0.0.1"));
        assert_eq!(host("https://www.example.com:8443/x").as_deref(), Some("www.example.com"));
        assert_eq!(host("http://[::1]:3000/").as_deref(), Some("::1"));
        assert_eq!(host("hello"), None);
    }
}
