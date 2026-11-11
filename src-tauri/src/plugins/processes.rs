//! 进程管理: every process with its CPU and memory, grouped by app, and quitting them.
//!
//! The list comes from `ps` (CPU is its recent average, like the `%CPU` column of
//! `top`); memory is the physical footprint Activity Monitor shows where the process
//! is ours to inspect, otherwise its resident size.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::sysmon::{self, MemoryInfo};

/// The system can't run without these; quitting them logs out or hangs the Mac.
const PROTECTED: [&str; 8] = [
    "kernel_task", "launchd", "WindowServer", "loginwindow", "logind", "opendirectoryd", "securityd", "coreservicesd",
];

#[derive(Clone, Debug, PartialEq)]
struct Proc {
    pid: i32,
    uid: u32,
    /// Percent of one core; above 100 for multi-threaded work.
    cpu: f64,
    rss: u64,
    path: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRow {
    pub pid: i32,
    pub name: String,
    pub path: String,
    pub cpu: f64,
    /// Bytes.
    pub memory: u64,
    /// Owned by the signed-in user, so it can be quit without a password.
    pub mine: bool,
    pub protected: bool,
}

/// An app with its helper processes, or a lone process outside any app.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppGroup {
    /// The .app path, or "pid:<n>" for a lone process.
    pub id: String,
    pub name: String,
    /// The .app, for its icon.
    pub bundle: Option<String>,
    pub cpu: f64,
    pub memory: u64,
    pub mine: bool,
    pub protected: bool,
    /// Busiest first.
    pub processes: Vec<ProcessRow>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Busiest first.
    pub groups: Vec<AppGroup>,
    pub count: usize,
    pub cores: usize,
    pub memory: Option<MemoryInfo>,
}

/// Lines of `ps -Axo pid=,ppid=,uid=,pcpu=,rss=,comm=`; the path may contain spaces.
fn parse_ps(text: &str) -> Vec<Proc> {
    text.lines()
        .filter_map(|line| {
            let mut rest = line.trim_start();
            let mut fields = [""; 5];
            for field in &mut fields {
                let end = rest.find(char::is_whitespace)?;
                *field = &rest[..end];
                rest = rest[end..].trim_start();
            }
            let path = rest.trim_end();
            if path.is_empty() {
                return None;
            }
            Some(Proc {
                pid: fields[0].parse().ok()?,
                uid: fields[2].parse().ok()?,
                cpu: fields[3].parse::<f64>().ok().filter(|c| c.is_finite() && *c >= 0.0)?,
                rss: fields[4].parse::<u64>().ok()?.saturating_mul(1024),
                path: path.into(),
            })
        })
        .collect()
}

/// The outermost .app containing `path`: helpers deep inside Chrome belong to Chrome.
fn bundle_of(path: &str) -> Option<&str> {
    path.find(".app/").map(|i| &path[..i + 4])
}

fn file_name(path: &str) -> &str {
    path.trim_end_matches('/').rsplit('/').next().unwrap_or(path)
}

struct Me {
    uid: u32,
    pid: i32,
    bundle: Option<String>,
}

impl Me {
    fn current() -> Self {
        let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        Me { uid: unsafe { libc::getuid() }, pid: std::process::id() as i32, bundle: bundle_of(&exe).map(str::to_string) }
    }

    fn protects(&self, p: &Proc) -> bool {
        p.pid <= 1
            || p.pid == self.pid
            || PROTECTED.contains(&file_name(&p.path))
            || self.bundle.is_some() && bundle_of(&p.path) == self.bundle.as_deref()
    }
}

fn group(procs: Vec<Proc>, me: &Me, app_name: impl Fn(&str) -> String, footprint: impl Fn(i32) -> Option<u64>) -> Vec<AppGroup> {
    let mut groups: HashMap<String, AppGroup> = HashMap::new();
    for p in procs {
        let row = ProcessRow {
            pid: p.pid,
            name: file_name(&p.path).into(),
            cpu: p.cpu,
            memory: footprint(p.pid).unwrap_or(p.rss),
            mine: p.uid == me.uid,
            protected: me.protects(&p),
            path: p.path.clone(),
        };
        let bundle = bundle_of(&p.path).map(str::to_string);
        let id = bundle.clone().unwrap_or_else(|| format!("pid:{}", p.pid));
        let entry = groups.entry(id.clone()).or_insert_with(|| AppGroup {
            name: bundle.as_deref().map_or_else(|| row.name.clone(), &app_name),
            id,
            bundle,
            cpu: 0.0,
            memory: 0,
            mine: true,
            protected: false,
            processes: vec![],
        });
        entry.cpu += row.cpu;
        entry.memory += row.memory;
        entry.mine &= row.mine;
        entry.protected |= row.protected;
        entry.processes.push(row);
    }
    let busiest = |a: &f64, b: &f64, ma: u64, mb: u64| b.total_cmp(a).then(mb.cmp(&ma));
    let mut groups: Vec<AppGroup> = groups.into_values().collect();
    for g in &mut groups {
        g.processes.sort_by(|a, b| busiest(&a.cpu, &b.cpu, a.memory, b.memory).then(a.pid.cmp(&b.pid)));
    }
    groups.sort_by(|a, b| busiest(&a.cpu, &b.cpu, a.memory, b.memory).then_with(|| a.name.cmp(&b.name)));
    groups
}

/// The physical footprint Activity Monitor calls 内存; None for processes we can't inspect.
fn footprint(pid: i32) -> Option<u64> {
    let mut info: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
    let status = unsafe { libc::proc_pid_rusage(pid, libc::RUSAGE_INFO_V2, (&mut info as *mut libc::rusage_info_v2).cast()) };
    (status == 0 && info.ri_phys_footprint > 0).then_some(info.ri_phys_footprint)
}

/// Localized app names, read once per app: the list refreshes every two seconds.
fn app_name(bundle: &str) -> String {
    static NAMES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
    let mut names = NAMES.lock().unwrap();
    names
        .get_or_insert_with(HashMap::new)
        .entry(bundle.to_string())
        .or_insert_with(|| {
            super::launcher::localized_name(Path::new(bundle))
                .unwrap_or_else(|| file_name(bundle).trim_end_matches(".app").to_string())
        })
        .clone()
}

fn read_ps() -> Result<Vec<Proc>, String> {
    let text = sysmon::command_output("/bin/ps", &["-Axo", "pid=,ppid=,uid=,pcpu=,rss=,comm="])
        .map_err(|e| format!("无法读取进程列表：{e}"))?;
    Ok(parse_ps(&text))
}

#[tauri::command]
pub async fn processes_snapshot() -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let procs = read_ps()?;
        let count = procs.len();
        Ok(Snapshot {
            groups: group(procs, &Me::current(), app_name, footprint),
            count,
            cores: std::thread::available_parallelism().map_or(1, |n| n.get()),
            memory: sysmon::memory_now().ok(),
        })
    })
    .await
    .map_err(|_| "读取进程失败".to_string())?
}

/// A process the page showed: the path guards against its pid being reused since.
#[derive(Deserialize, Clone, Debug)]
pub struct Target {
    pub pid: i32,
    pub path: String,
}

/// Which of `targets` may be signalled now. Gone ones are skipped; any that may not be
/// quit stops the whole request with the reason.
fn checked(targets: &[Target], live: &[Proc], me: &Me) -> Result<Vec<Proc>, String> {
    let mut out = vec![];
    for t in targets {
        let Some(p) = live.iter().find(|p| p.pid == t.pid && p.path == t.path) else { continue };
        if me.protects(p) {
            return Err(format!("「{}」是系统必需的进程，不能结束", file_name(&p.path)));
        }
        if p.uid != me.uid {
            return Err(format!("「{}」属于系统或其他用户，AhaTools 无权结束它", file_name(&p.path)));
        }
        out.push(p.clone());
    }
    Ok(out)
}

fn signal(pid: i32, sig: libc::c_int) -> Result<(), String> {
    if unsafe { libc::kill(pid, sig) } == 0 {
        return Ok(());
    }
    match std::io::Error::last_os_error().raw_os_error() {
        Some(libc::ESRCH) => Ok(()),
        Some(libc::EPERM) => Err("没有权限结束这个进程".into()),
        _ => Err(format!("无法结束进程：{}", std::io::Error::last_os_error())),
    }
}

/// Quits apps the way ⌘Q does (they may ask to save), other processes with SIGTERM;
/// `force` kills everything at once.
#[tauri::command]
pub async fn processes_quit(app: AppHandle, targets: Vec<Target>, force: bool) -> Result<String, String> {
    let live = tauri::async_runtime::spawn_blocking(read_ps).await.map_err(|_| "读取进程失败".to_string())??;
    let procs = checked(&targets, &live, &Me::current())?;
    if procs.is_empty() {
        return Ok("进程已经结束".into());
    }
    if force {
        for p in &procs {
            signal(p.pid, libc::SIGKILL)?;
        }
        return Ok(format!("已强制结束 {} 个进程", procs.len()));
    }
    // Regular apps quit through AppKit, on the main thread; their helpers follow.
    let pids: Vec<i32> = procs.iter().map(|p| p.pid).collect();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let asked = pids
            .iter()
            .filter(|&&pid| {
                objc2_app_kit::NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
                    .is_some_and(|running| running.terminate())
            })
            .count();
        let _ = tx.send(asked);
    })
    .map_err(|e| e.to_string())?;
    let asked = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap_or(0);
    if asked > 0 {
        return Ok("已请求退出，应用可能会先询问是否保存".into());
    }
    for p in &procs {
        signal(p.pid, libc::SIGTERM)?;
    }
    Ok(format!("已请求结束 {} 个进程", procs.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PS: &str = "    1     0     0   0.0  12000 /sbin/launchd
  650     1    88  62.5 117744 /System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer
37617 37173   501 117.3 716144 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)
37173     1   501   4.0  82880 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
 4242     1   501   1.5  20000 /opt/homebrew/bin/node
 5000     1   501   0.0   1000 /Applications/中文 应用.app/Contents/MacOS/中文 应用
 bad line
";

    fn me() -> Me {
        Me { uid: 501, pid: 999_999, bundle: Some("/Applications/AhaTools.app".into()) }
    }

    #[test]
    fn ps_lines_keep_paths_with_spaces_and_cpu_above_one_core() {
        let procs = parse_ps(PS);
        assert_eq!(procs.len(), 6);
        let helper = procs.iter().find(|p| p.pid == 37617).unwrap();
        assert_eq!(helper.cpu, 117.3);
        assert_eq!(helper.rss, 716_144 * 1024);
        assert!(helper.path.ends_with("Google Chrome Helper (Renderer)"));
        assert_eq!(procs[5].path, "/Applications/中文 应用.app/Contents/MacOS/中文 应用");
    }

    #[test]
    fn helpers_group_under_their_outermost_app_busiest_first() {
        let groups = group(parse_ps(PS), &me(), |b| file_name(b).trim_end_matches(".app").into(), |pid| (pid == 37173).then_some(500));
        let names: Vec<_> = groups.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, ["Google Chrome", "WindowServer", "node", "launchd", "中文 应用"]);
        let chrome = &groups[0];
        assert_eq!(chrome.bundle.as_deref(), Some("/Applications/Google Chrome.app"));
        assert_eq!(chrome.processes.len(), 2);
        assert!((chrome.cpu - 121.3).abs() < 1e-9);
        // Footprint where readable, resident size otherwise.
        assert_eq!(chrome.memory, 716_144 * 1024 + 500);
        assert!(chrome.mine && !chrome.protected);
        let server = &groups[1];
        assert!(server.protected && !server.mine);
        assert_eq!(server.id, "pid:650");
        assert!(groups.iter().find(|g| g.name == "launchd").unwrap().protected);
    }

    #[test]
    fn quitting_skips_gone_and_reused_pids_and_refuses_system_or_other_users() {
        let live = parse_ps(PS);
        let me = me();
        let node = Target { pid: 4242, path: "/opt/homebrew/bin/node".into() };
        assert_eq!(checked(&[node.clone()], &live, &me).unwrap().len(), 1);
        // Same pid, different program: the old process is gone.
        let reused = Target { pid: 4242, path: "/usr/bin/other".into() };
        assert!(checked(&[reused], &live, &me).unwrap().is_empty());
        let server = Target { pid: 650, path: live[1].path.clone() };
        assert!(checked(&[node.clone(), server], &live, &me).unwrap_err().contains("系统必需"));
        let mut other = live.clone();
        other[4].uid = 0;
        assert!(checked(&[node], &other, &me).unwrap_err().contains("其他用户"));
        let mut own = live.clone();
        own[4].path = "/Applications/AhaTools.app/Contents/MacOS/ahatools".into();
        let own_target = Target { pid: 4242, path: own[4].path.clone() };
        assert!(checked(&[own_target], &own, &me).is_err());
    }

    #[test]
    #[ignore = "reads the real process list"]
    fn native_snapshot_reads_this_mac() {
        let procs = read_ps().unwrap();
        assert!(procs.len() > 20);
        let me = Me::current();
        assert!(footprint(me.pid).is_some());
        let groups = group(procs, &me, app_name, footprint);
        assert!(groups.iter().any(|g| g.protected));
    }
}
