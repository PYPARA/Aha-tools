//! Local hosts profiles. Only the fixed native adapter can write the system file.
//! Parsing, merge, persistence and transactions are testable without administrator access.

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Write},
    net::IpAddr,
    ops::Range,
    path::Path,
    process::{Command, Stdio},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

const START: &str = "# --- AhaTools start ---";
const END: &str = "# --- AhaTools end ---";
const SYSTEM: &str = "/private/etc/hosts";
static APPLYING: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct HostScheme {
    pub id: String,
    pub name: String,
    pub content: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub scheme_id: Option<String>,
    pub line: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct Issue {
    pub code: String,
    pub message: String,
    pub blocking: bool,
    pub location: Location,
    pub related: Vec<Location>,
}

#[derive(Debug, Serialize)]
pub struct Validation {
    pub issues: Vec<Issue>,
    pub counts: HashMap<String, usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schemes: Vec<HostScheme>,
    pub current: String,
    pub original: Option<String>,
    pub revision: String,
    pub managed: bool,
    pub matches_saved: bool,
    pub marker_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub snapshot: Option<Snapshot>,
    pub system_written: bool,
    pub profiles_saved: bool,
    pub dns_flushed: bool,
    pub cancelled: bool,
    pub error: Option<String>,
}

/// Reject ambiguous blocks instead of guessing which system text belongs to us.
fn marker_range(text: &str) -> Result<Option<Range<usize>>, String> {
    let mut start = None;
    let mut found = None;
    let mut offset = 0;
    for raw in text.split_inclusive('\n') {
        let line = raw.trim_end_matches('\n').trim_end_matches('\r');
        if line == START {
            if start.is_some() || found.is_some() {
                return Err("AhaTools 标记段重复或嵌套，请先手动检查系统 hosts".into());
            }
            start = Some(offset);
        } else if line == END {
            let begin = start.take().ok_or("AhaTools 结束标记缺少对应的开始标记")?;
            found = Some(begin..offset + raw.len());
        }
        offset += raw.len();
    }
    if start.is_some() {
        return Err("AhaTools 开始标记缺少对应的结束标记".into());
    }
    Ok(found)
}

fn merge(current: &str, schemes: &[HostScheme]) -> Result<String, String> {
    let range = marker_range(current)?;
    let newline = if current.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let body = schemes
        .iter()
        .filter(|s| s.enabled && !s.content.trim().is_empty())
        .map(|s| {
            s.content
                .replace("\r\n", "\n")
                .trim_end_matches('\n')
                .to_owned()
        })
        .collect::<Vec<_>>()
        .join("\n\n")
        .replace('\n', newline);
    let block = if body.is_empty() {
        String::new()
    } else {
        format!("{START}{newline}{body}{newline}{END}{newline}")
    };
    match range {
        Some(r) => Ok(format!(
            "{}{}{}",
            &current[..r.start],
            block,
            &current[r.end..]
        )),
        None if block.is_empty() => Ok(current.to_owned()),
        None => {
            let separator = if current.is_empty() || current.ends_with('\n') {
                ""
            } else {
                newline
            };
            Ok(format!("{current}{separator}{block}"))
        }
    }
}

fn host_key(host: &str) -> Result<String, String> {
    let host = host.trim_end_matches('.');
    if host.is_empty()
        || host.split('.').any(|label| label.is_empty())
        || !host
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err("主机名不合法：请填域名或内部主机名，不要带网址、端口或通配符".into());
    }
    Ok(host.to_lowercase())
}

fn parse_line(line: &str) -> Result<Option<(IpAddr, Vec<String>)>, String> {
    if line.trim() == START || line.trim() == END {
        return Err("方案内不能包含 AhaTools 保留标记".into());
    }
    if line.chars().any(|c| c.is_control() && c != '\t') {
        return Err("行内包含不支持的控制字符".into());
    }
    let fields: Vec<_> = line
        .split('#')
        .next()
        .unwrap_or("")
        .split_ascii_whitespace()
        .collect();
    if fields.is_empty() {
        return Ok(None);
    }
    let ip = fields[0].parse::<IpAddr>().map_err(|_| "IP 地址不合法")?;
    if fields.len() < 2 {
        return Err("IP 后至少需要一个主机名".into());
    }
    let hosts = fields[1..]
        .iter()
        .map(|h| host_key(h))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some((ip, hosts)))
}

fn validate(schemes: &[HostScheme], current: &str) -> Validation {
    let mut issues = vec![];
    let mut counts = HashMap::new();
    let mut mappings: HashMap<(String, bool), Vec<(IpAddr, Location)>> = HashMap::new();
    let range = match marker_range(current) {
        Ok(r) => r,
        Err(message) => {
            issues.push(Issue {
                code: "markers".into(),
                message,
                blocking: true,
                location: Location {
                    scheme_id: None,
                    line: 0,
                },
                related: vec![],
            });
            None
        }
    };
    let mut offset = 0;
    for (i, raw) in current.split_inclusive('\n').enumerate() {
        if !range.as_ref().is_some_and(|r| r.contains(&offset)) {
            if let Ok(Some((ip, hosts))) =
                parse_line(raw.trim_end_matches('\n').trim_end_matches('\r'))
            {
                for host in hosts {
                    mappings.entry((host, ip.is_ipv6())).or_default().push((
                        ip,
                        Location {
                            scheme_id: None,
                            line: i + 1,
                        },
                    ));
                }
            }
        }
        offset += raw.len();
    }
    let mut ids = HashSet::new();
    for scheme in schemes {
        let location = |line| Location {
            scheme_id: Some(scheme.id.clone()),
            line,
        };
        if scheme.id.is_empty()
            || !ids.insert(&scheme.id)
            || scheme.name.trim().is_empty()
            || scheme.name.chars().any(char::is_control)
        {
            issues.push(Issue {
                code: "metadata".into(),
                message: "方案需要有效的唯一 ID 和非空名称".into(),
                blocking: true,
                location: location(0),
                related: vec![],
            });
        }
        let mut count = 0;
        for (i, raw) in scheme.content.split('\n').enumerate() {
            let parsed = match parse_line(raw.trim_end_matches('\r')) {
                Ok(Some(p)) => p,
                Ok(None) => continue,
                Err(message) => {
                    issues.push(Issue {
                        code: "syntax".into(),
                        message,
                        blocking: scheme.enabled,
                        location: location(i + 1),
                        related: vec![],
                    });
                    continue;
                }
            };
            count += 1;
            if !scheme.enabled {
                continue;
            }
            let (ip, hosts) = parsed;
            for host in hosts {
                let previous = mappings.entry((host.clone(), ip.is_ipv6())).or_default();
                let related: Vec<_> = previous
                    .iter()
                    .filter(|(old, _)| *old != ip)
                    .map(|(_, loc)| loc.clone())
                    .collect();
                if !related.is_empty() {
                    issues.push(Issue {
                        code: "conflict".into(),
                        message: format!(
                            "{host} 存在不同的 {} 地址",
                            if ip.is_ipv6() { "IPv6" } else { "IPv4" }
                        ),
                        blocking: true,
                        location: location(i + 1),
                        related,
                    });
                }
                previous.push((ip, location(i + 1)));
            }
        }
        counts.insert(scheme.id.clone(), count);
    }
    Validation { issues, counts }
}

fn optional_read(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("无法读取 {}：{e}", path.display())),
    }
}

fn profiles(bytes: Option<&[u8]>) -> Result<Vec<HostScheme>, String> {
    bytes
        .map(|b| {
            serde_json::from_slice(b).map_err(|e| format!("hosts.json 无法解析，原文件已保留：{e}"))
        })
        .unwrap_or_else(|| Ok(vec![]))
}

fn revision(current: &str, saved: Option<&[u8]>) -> String {
    let mut hash = Sha256::new();
    hash.update((current.len() as u64).to_be_bytes());
    hash.update(current.as_bytes());
    hash.update([u8::from(saved.is_some())]);
    hash.update(saved.unwrap_or_default());
    format!("{:x}", hash.finalize())
}

fn atomic_save(dir: &Path, schemes: &[HostScheme]) -> Result<(), String> {
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(schemes).map_err(|e| e.to_string())?;
    tmp.write_all(&bytes)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    tmp.persist(dir.join("hosts.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_backup(dir: &Path, current: &str) -> Result<(), String> {
    if optional_read(&dir.join("hosts.original"))?.is_some() {
        return Ok(());
    }
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    tmp.write_all(current.as_bytes())
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    match tmp.persist_noclobber(dir.join("hosts.original")) {
        Ok(_) => Ok(()),
        Err(e) if e.error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(format!("无法备份系统 hosts，未执行修改：{e}")),
    }
}

#[derive(Debug)]
enum NativeOutcome {
    Applied { dns_flushed: bool },
    Cancelled,
    Stale,
}

trait System {
    fn read(&self) -> Result<String, String>;
    fn apply(&self, expected: &str, candidate: &str) -> Result<NativeOutcome, String>;
}

struct NativeSystem;

// The shell code is compiled into AhaTools. Only private, randomly named data files
// cross the privilege boundary; no profile name/content is interpolated as code.
const WRITE_SCRIPT: &str = r#"set -u
target=/private/etc/hosts
expected=$1
candidate=$2
if [ ! -f "$target" ] || [ -L "$target" ]; then exit 74; fi
/usr/bin/cmp -s "$expected" "$target" || exit 73
if ! /usr/bin/cmp -s "$candidate" "$target"; then
    stage=$(/usr/bin/mktemp /private/etc/.ahatools-hosts.XXXXXXXX) || exit 74
    trap '/bin/rm -f "$stage"' EXIT
    /bin/cp -p "$target" "$stage" || exit 74
    /bin/cat "$candidate" > "$stage" || exit 74
    /usr/bin/cmp -s "$expected" "$target" || exit 73
    /bin/mv -f "$stage" "$target" || exit 74
fi
dns_ok=1
/usr/bin/dscacheutil -flushcache >/dev/null 2>&1 || dns_ok=0
/usr/bin/killall -HUP mDNSResponder >/dev/null 2>&1 || dns_ok=0
if [ "$dns_ok" -eq 1 ]; then
    /usr/bin/printf AHATOOLS_OK
else
    /usr/bin/printf AHATOOLS_DNS_WARN
fi
"#;

const APPLESCRIPT: &str = r#"on run argv
    try
        return do shell script (item 1 of argv) with administrator privileges
    on error messageText number errorNumber
        if errorNumber is -128 then return "AHATOOLS_CANCELLED"
        if errorNumber is 73 then return "AHATOOLS_STALE"
        error messageText number errorNumber
    end try
end run
"#;

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

impl System for NativeSystem {
    fn read(&self) -> Result<String, String> {
        let metadata =
            fs::symlink_metadata(SYSTEM).map_err(|e| format!("无法读取系统 hosts：{e}"))?;
        if !metadata.is_file() {
            return Err("系统 hosts 不是普通文件，未执行修改".into());
        }
        fs::read_to_string(SYSTEM)
            .map_err(|e| format!("无法读取系统 hosts（需要 UTF-8 文本）：{e}"))
    }

    fn apply(&self, expected: &str, candidate: &str) -> Result<NativeOutcome, String> {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::Builder::new()
            .prefix("ahatools-hosts-")
            .permissions(fs::Permissions::from_mode(0o700))
            .tempdir()
            .map_err(|e| e.to_string())?;
        let expected_path = dir.path().join("expected");
        let candidate_path = dir.path().join("candidate");
        fs::write(&expected_path, expected)
            .and_then(|_| fs::write(&candidate_path, candidate))
            .map_err(|e| format!("无法准备 hosts 暂存文件：{e}"))?;
        let command = format!(
            "/bin/sh -c {} -- {} {}",
            shell_quote(WRITE_SCRIPT),
            shell_quote(&expected_path.to_string_lossy()),
            shell_quote(&candidate_path.to_string_lossy())
        );
        let mut child = Command::new("/usr/bin/osascript")
            .arg("-")
            .arg(command)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("无法打开系统授权：{e}"))?;
        child
            .stdin
            .take()
            .ok_or("无法传入授权脚本")?
            .write_all(APPLESCRIPT.as_bytes())
            .map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "系统 hosts 操作失败：{}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        match String::from_utf8_lossy(&output.stdout).trim() {
            "AHATOOLS_OK" => Ok(NativeOutcome::Applied { dns_flushed: true }),
            "AHATOOLS_DNS_WARN" => Ok(NativeOutcome::Applied { dns_flushed: false }),
            "AHATOOLS_CANCELLED" => Ok(NativeOutcome::Cancelled),
            "AHATOOLS_STALE" => Ok(NativeOutcome::Stale),
            _ => Err("无法确认系统授权的结果，请重新读取当前 hosts".into()),
        }
    }
}

fn load(dir: &Path, system: &dyn System) -> Result<Snapshot, String> {
    let saved = optional_read(&dir.join("hosts.json"))?;
    let schemes = profiles(saved.as_deref())?;
    let current = system.read()?;
    let original = optional_read(&dir.join("hosts.original"))?
        .map(String::from_utf8)
        .transpose()
        .map_err(|_| "hosts.original 不是 UTF-8 文本")?;
    let markers = marker_range(&current);
    Ok(Snapshot {
        revision: revision(&current, saved.as_deref()),
        managed: matches!(&markers, Ok(Some(_))),
        matches_saved: merge(&current, &schemes).is_ok_and(|s| s == current),
        marker_error: markers.err(),
        schemes,
        current,
        original,
    })
}

fn operate(
    dir: &Path,
    system: &dyn System,
    gate: &Mutex<()>,
    requested: Option<Vec<HostScheme>>,
    expected_revision: &str,
) -> Result<Operation, String> {
    let _guard = gate
        .try_lock()
        .map_err(|_| "正在应用 hosts，请等待当前操作完成")?;
    let before = load(dir, system)?;
    if before.revision != expected_revision {
        return Err("系统 hosts 或方案文件已被外部修改，请重新读取并检查后再应用".into());
    }
    let saved_before = optional_read(&dir.join("hosts.json"))?;
    if revision(&before.current, saved_before.as_deref()) != expected_revision {
        return Err("方案文件已被外部修改，请重新读取后再应用".into());
    }
    // Restore uses the saved list, never silently saving an unrelated edit buffer.
    let restoring = requested.is_none();
    let schemes = requested.unwrap_or_else(|| {
        before
            .schemes
            .iter()
            .cloned()
            .map(|mut s| {
                s.enabled = false;
                s
            })
            .collect()
    });
    if !restoring {
        let validation = validate(&schemes, &before.current);
        if let Some(issue) = validation.issues.iter().find(|i| i.blocking) {
            return Err(format!(
                "无法应用：{}（第 {} 行）",
                issue.message, issue.location.line
            ));
        }
    }
    let candidate = merge(&before.current, &schemes)?;
    ensure_backup(dir, &before.current)?;
    let outcome = system.apply(&before.current, &candidate);
    let mut result = Operation {
        snapshot: None,
        system_written: false,
        profiles_saved: false,
        dns_flushed: false,
        cancelled: false,
        error: None,
    };
    let actual = system.read();
    match outcome {
        Ok(NativeOutcome::Cancelled) => result.cancelled = true,
        Ok(NativeOutcome::Stale) => {
            result.error =
                Some("授权期间系统 hosts 已被外部修改，未覆盖外部内容；请检查后重新应用".into())
        }
        Ok(NativeOutcome::Applied { dns_flushed })
            if actual.as_ref().is_ok_and(|s| *s == candidate) =>
        {
            result.system_written = true;
            result.dns_flushed = dns_flushed;
            let save = optional_read(&dir.join("hosts.json")).and_then(|now| {
                if now != saved_before {
                    return Err("方案文件在授权期间被外部修改，未覆盖原文件".into());
                }
                atomic_save(dir, &schemes)
            });
            match save {
                Ok(()) => {
                    result.profiles_saved = true;
                    if !dns_flushed {
                        result.error = Some("已写入，DNS 刷新失败；可再次应用以重试刷新".into());
                    }
                }
                Err(e) => {
                    result.error = Some(format!(
                        "系统已写入，方案保存失败：{e}{}",
                        if dns_flushed {
                            ""
                        } else {
                            "；DNS 刷新也未成功"
                        }
                    ))
                }
            }
        }
        Ok(NativeOutcome::Applied { .. }) => {
            result.error = Some("写入后无法核验系统内容，方案未保存；请重新读取当前 hosts".into())
        }
        Err(e) => {
            result.system_written = actual
                .as_ref()
                .is_ok_and(|s| *s == candidate && *s != before.current);
            result.error = Some(if result.system_written {
                format!("系统已写入，方案未保存，DNS 刷新状态未知：{e}")
            } else {
                e
            });
        }
    }
    match load(dir, system) {
        Ok(snapshot) => result.snapshot = Some(snapshot),
        Err(e) => {
            result.error = Some(format!(
                "{}；无法重新读取状态：{e}",
                result.error.as_deref().unwrap_or("操作结束")
            ))
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn hosts_load(app: AppHandle) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load(&crate::config::data_dir(&app), &NativeSystem)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn hosts_validate(schemes: Vec<HostScheme>) -> Result<Validation, String> {
    tauri::async_runtime::spawn_blocking(move || {
        NativeSystem.read().map(|s| validate(&schemes, &s))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn hosts_apply(
    app: AppHandle,
    schemes: Vec<HostScheme>,
    revision: String,
) -> Result<Operation, String> {
    tauri::async_runtime::spawn_blocking(move || {
        operate(
            &crate::config::data_dir(&app),
            &NativeSystem,
            &APPLYING,
            Some(schemes),
            &revision,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn hosts_restore(app: AppHandle, revision: String) -> Result<Operation, String> {
    tauri::async_runtime::spawn_blocking(move || {
        operate(
            &crate::config::data_dir(&app),
            &NativeSystem,
            &APPLYING,
            None,
            &revision,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests;
