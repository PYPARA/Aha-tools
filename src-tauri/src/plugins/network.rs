//! 网络工具: this Mac's addresses, ping, DNS lookups and listening ports. Everything
//! runs macOS's own tools (`ping`, `dig`, `lsof`, `route`) with argument lists, never a
//! shell; only the public IP needs a request to the outside.

use std::collections::{HashMap, HashSet};
use std::ffi::CStr;
use std::io::{BufRead, BufReader};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use fuzzy_matcher::skim::SkimMatcherV2;
use serde::Serialize;
use tauri::{AppHandle, Emitter, WebviewWindow};

use super::{ANSWER_SCORE, ItemAction, ItemKind, SearchItem, SearchProvider, detect};

pub const ID: &str = "network";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Address {
    pub interface: String,
    /// "Wi-Fi", "以太网", "VPN"…
    pub label: String,
    pub ip: String,
    pub v6: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Local {
    pub addresses: Vec<Address>,
    pub gateway: Option<String>,
    pub gateway_interface: Option<String>,
}

/// Interfaces people mean by 本机 IP: Wi-Fi / Ethernet / tethering (en*), VPN tunnels,
/// never loopback, and never link-local IPv6 that only works on one wire.
fn keep(name: &str, ip: &IpAddr) -> bool {
    let wanted = ["en", "utun", "ppp", "ipsec", "bridge"].iter().any(|p| name.starts_with(p));
    let link_local_v6 = matches!(ip, IpAddr::V6(v6) if (v6.segments()[0] & 0xffc0) == 0xfe80);
    wanted && !ip.is_loopback() && !ip.is_unspecified() && !link_local_v6
}

fn label(name: &str, ports: &HashMap<String, String>) -> String {
    if let Some(port) = ports.get(name) {
        return port.clone();
    }
    match name {
        n if n.starts_with("utun") || n.starts_with("ipsec") || n.starts_with("ppp") => "VPN".into(),
        n if n.starts_with("bridge") => "网桥".into(),
        n => n.into(),
    }
}

fn addresses() -> Vec<Address> {
    let mut found = vec![];
    unsafe {
        let mut list: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut list) != 0 {
            return vec![];
        }
        let mut cursor = list;
        while !cursor.is_null() {
            let ifa = &*cursor;
            cursor = ifa.ifa_next;
            let flags = ifa.ifa_flags as i32;
            if ifa.ifa_addr.is_null() || flags & libc::IFF_UP == 0 || flags & libc::IFF_LOOPBACK != 0 {
                continue;
            }
            let ip = match i32::from((*ifa.ifa_addr).sa_family) {
                libc::AF_INET => {
                    let sa = &*(ifa.ifa_addr as *const libc::sockaddr_in);
                    IpAddr::V4(Ipv4Addr::from(u32::from_be(sa.sin_addr.s_addr)))
                }
                libc::AF_INET6 => {
                    let sa = &*(ifa.ifa_addr as *const libc::sockaddr_in6);
                    IpAddr::V6(Ipv6Addr::from(sa.sin6_addr.s6_addr))
                }
                _ => continue,
            };
            let name = CStr::from_ptr(ifa.ifa_name).to_string_lossy().into_owned();
            if keep(&name, &ip) {
                found.push((name, ip));
            }
        }
        libc::freeifaddrs(list);
    }
    let ports = if found.is_empty() { HashMap::new() } else { hardware_ports() };
    let mut out: Vec<Address> = found
        .into_iter()
        .map(|(name, ip)| Address { label: label(&name, &ports), v6: ip.is_ipv6(), ip: ip.to_string(), interface: name })
        .collect();
    // Physical interfaces first (en0 before utun3), IPv4 before IPv6.
    out.sort_by(|a, b| (!a.interface.starts_with("en"), &a.interface, a.v6).cmp(&(!b.interface.starts_with("en"), &b.interface, b.v6)));
    out
}

/// `networksetup` is slow (~50 ms), and port names don't change while the app runs.
fn hardware_ports() -> HashMap<String, String> {
    static PORTS: LazyLock<HashMap<String, String>> = LazyLock::new(crate::netspeed::hardware_ports);
    PORTS.clone()
}

/// "gateway: 10.0.0.1" and "interface: en0" from `route -n get default`.
fn parse_route(text: &str) -> (Option<String>, Option<String>) {
    let field = |key: &str| text.lines().find_map(|l| l.trim().strip_prefix(key).map(|v| v.trim().to_string())).filter(|v| !v.is_empty());
    (field("gateway:"), field("interface:"))
}

#[tauri::command]
pub async fn network_local() -> Result<Local, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let route = crate::sysmon::command_output("/sbin/route", &["-n", "get", "default"]).unwrap_or_default();
        let (gateway, gateway_interface) = parse_route(&route);
        Local { addresses: addresses(), gateway, gateway_interface }
    })
    .await
    .map_err(|_| "读取网络信息失败".to_string())
}

/// The address the internet sees, from the service in settings (plain-text reply).
#[tauri::command]
pub async fn network_public_ip(app: AppHandle) -> Result<String, String> {
    let url = crate::config::load(&app).public_ip_url;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "无法初始化网络连接".to_string())?;
    let text = client
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("查询公网 IP 失败：{e}"))?
        .text()
        .await
        .map_err(|e| format!("查询公网 IP 失败：{e}"))?;
    let ip = text.trim();
    ip.parse::<IpAddr>().map(|ip| ip.to_string()).map_err(|_| format!("{url} 返回的不是 IP 地址"))
}

/// What ping and DNS may be given: a host name or address, or a URL's host. Never
/// anything starting with "-", which `ping` would read as an option.
pub fn valid_host(text: &str) -> Result<String, String> {
    let host = detect::host(text).unwrap_or_else(|| text.trim().to_string());
    let ok = !host.is_empty()
        && host.len() <= 253
        && !host.starts_with('-')
        && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '_'));
    ok.then_some(host).ok_or_else(|| "请输入域名或 IP 地址，例如 github.com 或 1.1.1.1".to_string())
}

/// Running pings by (window, request id), so 停止 and leaving the page can end them.
static PINGS: LazyLock<Mutex<HashMap<(String, String), u32>>> = LazyLock::new(Default::default);

#[derive(Serialize, Clone)]
struct PingLine {
    id: String,
    line: String,
}
#[derive(Serialize, Clone)]
struct PingDone {
    id: String,
    ok: bool,
}

/// Ten pings, one per second; every output line is sent to the page as it arrives.
#[tauri::command]
pub fn network_ping_start(window: WebviewWindow, id: String, host: String) -> Result<String, String> {
    let host = valid_host(&host)?;
    let mut command = Command::new(if host.contains(':') { "/sbin/ping6" } else { "/sbin/ping" });
    command.args(["-c", "10", "-i", "1"]);
    if !host.contains(':') {
        // Give up on an unreachable host instead of waiting forever.
        command.args(["-t", "20"]);
    }
    let mut child = command
        .arg(&host)
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法运行 ping：{e}"))?;
    let key = (window.label().to_string(), id.clone());
    PINGS.lock().unwrap().insert(key.clone(), child.id());
    let (stdout, stderr) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let send = {
        let (window, id) = (window.clone(), id.clone());
        move |line: String| {
            let _ = window.emit_to(window.label(), "network-ping", PingLine { id: id.clone(), line });
        }
    };
    let errors = {
        let send = send.clone();
        std::thread::spawn(move || BufReader::new(stderr).lines().map_while(Result::ok).for_each(|l| send(l)))
    };
    std::thread::spawn(move || {
        BufReader::new(stdout).lines().map_while(Result::ok).for_each(|l| send(l));
        let _ = errors.join();
        let ok = child.wait().is_ok_and(|s| s.success());
        PINGS.lock().unwrap().remove(&key);
        let _ = window.emit_to(window.label(), "network-ping-done", PingDone { id: key.1, ok });
    });
    Ok(host)
}

/// Like ⌃C: ping stops and still prints its summary.
#[tauri::command]
pub fn network_ping_stop(window: WebviewWindow, id: String) {
    if let Some(pid) = PINGS.lock().unwrap().get(&(window.label().to_string(), id)) {
        unsafe { libc::kill(*pid as i32, libc::SIGINT) };
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DnsRecord {
    pub kind: String,
    pub values: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DnsResult {
    pub host: String,
    pub server: Option<String>,
    pub records: Vec<DnsRecord>,
    /// What this Mac actually resolves to (including /etc/hosts and VPN DNS).
    pub system: Vec<String>,
    /// /etc/hosts lines naming the host: they override DNS for this Mac.
    pub hosts_file: Vec<String>,
}

const DNS_KINDS: [&str; 5] = ["A", "AAAA", "CNAME", "MX", "TXT"];

/// /etc/hosts lines that map `host` (comments ignored).
fn hosts_lines(text: &str, host: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.split('#').next().unwrap_or("").trim())
        .filter(|l| l.split_whitespace().skip(1).any(|name| name.eq_ignore_ascii_case(host)))
        .map(str::to_string)
        .collect()
}

/// Asks DNS directly (`dig`, optionally at `server`) and the system resolver, so a
/// difference shows a hosts file, VPN or cache at work.
#[tauri::command]
pub async fn network_dns(host: String, server: Option<String>) -> Result<DnsResult, String> {
    let host = valid_host(&host)?;
    let server = server.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if let Some(s) = &server {
        s.parse::<IpAddr>().map_err(|_| "DNS 服务器请填写 IP 地址，例如 1.1.1.1".to_string())?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let lookups: Vec<_> = DNS_KINDS
            .iter()
            .map(|kind| {
                let (host, server) = (host.clone(), server.clone());
                std::thread::spawn(move || {
                    let mut args = vec!["+short".to_string(), "+time=3".into(), "+tries=1".into()];
                    if let Some(s) = server {
                        args.push(format!("@{s}"));
                    }
                    args.extend([host, kind.to_string()]);
                    let args: Vec<&str> = args.iter().map(String::as_str).collect();
                    crate::sysmon::command_output("/usr/bin/dig", &args).map(|out| DnsRecord {
                        kind: kind.to_string(),
                        values: out.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with(";;")).map(str::to_string).collect(),
                    })
                })
            })
            .collect();
        let records = lookups
            .into_iter()
            .map(|t| t.join().map_err(|_| "DNS 查询失败".to_string())?)
            .collect::<Result<Vec<_>, String>>()
            .map_err(|e| format!("无法运行 dig：{e}"))?;
        let mut seen = HashSet::new();
        let system = (host.as_str(), 0)
            .to_socket_addrs()
            .map(|addrs| addrs.map(|a| a.ip().to_string()).filter(|ip| seen.insert(ip.clone())).collect())
            .unwrap_or_default();
        let hosts_file = std::fs::read_to_string("/etc/hosts").map(|t| hosts_lines(&t, &host)).unwrap_or_default();
        Ok(DnsResult { host, server, records, system, hosts_file })
    })
    .await
    .map_err(|_| "DNS 查询失败".to_string())?
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listener {
    pub port: u16,
    /// "*", "127.0.0.1", "[::1]"…
    pub address: String,
    pub pid: i32,
    pub process: String,
    pub user: String,
}

/// `lsof -F pcLn` output: a "p" line starts each process, "n" lines are its sockets.
fn parse_lsof(text: &str) -> Vec<Listener> {
    let (mut pid, mut process, mut user) = (0, String::new(), String::new());
    let mut out: Vec<Listener> = vec![];
    for line in text.lines() {
        let (tag, value) = line.split_at(line.chars().next().map_or(0, char::len_utf8));
        match tag {
            "p" => {
                pid = value.parse().unwrap_or(0);
                process.clear();
                user.clear();
            }
            "c" => process = value.to_string(),
            "L" => user = value.to_string(),
            "n" => {
                let Some((address, port)) = value.rsplit_once(':') else { continue };
                let Ok(port) = port.parse() else { continue };
                let entry = Listener { port, address: address.to_string(), pid, process: process.clone(), user: user.clone() };
                if !out.contains(&entry) {
                    out.push(entry);
                }
            }
            _ => {}
        }
    }
    out.sort_by(|a, b| (a.port, a.pid, &a.address).cmp(&(b.port, b.pid, &b.address)));
    out
}

/// TCP ports something listens on. Without administrator rights `lsof` only sees the
/// user's own processes, which are the ones that can be quit anyway.
#[tauri::command]
pub async fn network_ports() -> Result<Vec<Listener>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let out = Command::new("/usr/sbin/lsof")
            .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-FpcLn"])
            .env("LC_ALL", "C")
            .output()
            .map_err(|e| format!("无法运行 lsof：{e}"))?;
        // Exit status 1 with no output just means nothing is listening.
        Ok(parse_lsof(&String::from_utf8_lossy(&out.stdout)))
    })
    .await
    .map_err(|_| "读取端口失败".to_string())?
}

/// Typing 「ip」 answers right in the result list: each local address, ↵ copies it.
pub struct Answers;

const IP_QUERIES: [&str; 10] = ["ip", "内网ip", "本机ip", "局域网ip", "localip", "myip", "ipconfig", "ifconfig", "nwip", "bjip"];

impl SearchProvider for Answers {
    fn search(&self, query: &str, _: &SkimMatcherV2) -> Vec<SearchItem> {
        let q: String = query.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect();
        if !IP_QUERIES.contains(&q.as_str()) {
            return vec![];
        }
        addresses()
            .into_iter()
            .filter(|a| !a.v6)
            .enumerate()
            .map(|(i, a)| SearchItem {
                title: a.ip.clone(),
                subtitle: format!("内网 IP · {} ({})", a.label, a.interface),
                score: ANSWER_SCORE - i as i64,
                plugin: ID.into(),
                kind: ItemKind::Feature,
                icon: None,
                action: ItemAction::Copy { text: a.ip },
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_addresses_skip_loopback_link_local_and_virtual_interfaces() {
        let v4 = |s: &str| s.parse::<IpAddr>().unwrap();
        assert!(keep("en0", &v4("192.168.1.10")));
        assert!(keep("utun4", &v4("10.8.0.2")));
        assert!(keep("en0", &v4("2408:8207::1")));
        assert!(!keep("en0", &v4("fe80::1c2d:3e4f")));
        assert!(!keep("lo0", &v4("127.0.0.1")));
        assert!(!keep("awdl0", &v4("192.168.1.11")));
        assert!(!keep("llw0", &v4("192.168.1.12")));
        let ports = HashMap::from([("en0".to_string(), "Wi-Fi".to_string())]);
        assert_eq!(label("en0", &ports), "Wi-Fi");
        assert_eq!(label("utun3", &ports), "VPN");
    }

    #[test]
    fn default_route_gives_gateway_and_interface() {
        let text = "   route to: default\ndestination: default\n    gateway: 10.3.107.254\n  interface: en0\n";
        assert_eq!(parse_route(text), (Some("10.3.107.254".into()), Some("en0".into())));
        assert_eq!(parse_route(""), (None, None));
    }

    #[test]
    fn hosts_must_be_names_or_addresses_never_options() {
        assert_eq!(valid_host(" github.com ").unwrap(), "github.com");
        assert_eq!(valid_host("https://example.com:8443/a").unwrap(), "example.com");
        assert_eq!(valid_host("::1").unwrap(), "::1");
        for bad in ["", "-f", "a b", "github.com;rm", "$(x)", &"a".repeat(300)] {
            assert!(valid_host(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn hosts_file_lines_name_the_host_and_skip_comments() {
        let text = "127.0.0.1 localhost\n# 10.0.0.1 example.com\n10.0.0.2 api.example.com example.com # dev\n";
        assert_eq!(hosts_lines(text, "Example.com"), ["10.0.0.2 api.example.com example.com"]);
        assert!(hosts_lines(text, "github.com").is_empty());
    }

    #[test]
    fn lsof_fields_become_one_row_per_socket() {
        let text = "p1056\ncrapportd\nL0x10\nf11\nn*:49152\nf12\nn*:49152\np1366\ncWeChat\nL0x10\nf256\nn127.0.0.1:14013\nf257\nn[::1]:14013\np42\ncnode\nLme\nnbad\n";
        let rows = parse_lsof(text);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0], Listener { port: 14013, address: "127.0.0.1".into(), pid: 1366, process: "WeChat".into(), user: "0x10".into() });
        assert_eq!(rows[1].address, "[::1]");
        assert_eq!(rows[2].port, 49152);
        assert!(parse_lsof("").is_empty());
    }

    #[test]
    fn ip_answers_only_for_ip_queries() {
        let m = SkimMatcherV2::default();
        assert!(Answers.search("hello", &m).is_empty());
        let answers = Answers.search(" IP ", &m);
        assert!(answers.iter().all(|a| matches!(&a.action, ItemAction::Copy { text } if text.parse::<Ipv4Addr>().is_ok())));
    }

    #[test]
    #[ignore = "reads this Mac's network"]
    fn native_addresses_and_ports() {
        assert!(!addresses().is_empty());
        assert!(tauri::async_runtime::block_on(network_dns("localhost".into(), None)).is_ok());
        assert!(tauri::async_runtime::block_on(network_ports()).is_ok());
    }
}
