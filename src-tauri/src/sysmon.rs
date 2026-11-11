//! On-demand macOS telemetry. One worker sleeps on a condvar when nothing needs data.
//! Window visibility is owned by Rust; a hidden webview cannot leave sampling enabled.

use std::collections::VecDeque;
use std::process::Command;
use std::sync::{Condvar, Mutex, Once, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::config::MenubarItem;

const INTERVAL: Duration = Duration::from_secs(1);
const MAX_GAP_MS: u64 = 3_000;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Reading<T> {
    #[default]
    Sampling,
    Available {
        data: T,
        #[serde(rename = "sampledAt")]
        sampled_at: u64,
    },
    Unavailable,
}

impl<T> Reading<T> {
    fn from_result(result: Result<T, String>, now: u64) -> Self {
        match result {
            Ok(data) => Self::Available {
                data,
                sampled_at: now,
            },
            Err(_) => Self::Unavailable,
        }
    }

    pub fn data(&self) -> Option<&T> {
        match self {
            Self::Available { data, .. } => Some(data),
            _ => None,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct CpuPoint {
    pub timestamp: u64,
    pub percent: f64,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct CpuSnapshot {
    pub usage: Reading<f64>,
    pub history: Vec<CpuPoint>,
    pub busiest: Reading<ProcessInfo>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProcessInfo {
    pub name: String,
    pub percent: f64,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Pressure {
    Normal,
    Warning,
    Critical,
    Unknown,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub used_bytes: u64,
    pub total_bytes: u64,
    pub pressure: Pressure,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BatteryState {
    Charging,
    Discharging,
    Charged,
    NotCharging,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum BatteryInfo {
    Absent,
    Present {
        percent: u8,
        state: BatteryState,
        #[serde(rename = "remainingMinutes")]
        remaining_minutes: Option<u32>,
    },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub available_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct SystemSnapshot {
    /// Monotonically increasing even when two updates share the same wall clock time.
    pub sequence: u64,
    pub cpu: CpuSnapshot,
    pub memory: Reading<MemoryInfo>,
    pub battery: Reading<BatteryInfo>,
    pub disk: Reading<DiskInfo>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Demand {
    cpu: bool,
    memory: bool,
    details: bool,
}

impl Demand {
    fn active(self) -> bool {
        self.cpu || self.memory || self.details
    }
}

#[derive(Default)]
struct Control {
    shown: bool,
    items: Vec<MenubarItem>,
    generation: u64,
    cpu_epoch: u64,
    snapshot: SystemSnapshot,
}

impl Control {
    fn demand(&self) -> Demand {
        Demand {
            cpu: self.shown || self.items.contains(&MenubarItem::Cpu),
            memory: self.shown || self.items.contains(&MenubarItem::Memory),
            details: self.shown,
        }
    }

    fn update(&mut self, shown: bool, items: Vec<MenubarItem>) -> bool {
        if self.shown == shown && self.items == items {
            return false;
        }
        let before = self.demand();
        self.shown = shown;
        self.items = items;
        let after = self.demand();
        self.generation += 1;
        self.snapshot.sequence += 1;
        if before.cpu != after.cpu {
            self.cpu_epoch += 1;
            self.snapshot.cpu.usage = Reading::Sampling;
            self.snapshot.cpu.history.clear();
        }
        if before.memory != after.memory {
            self.snapshot.memory = Reading::Sampling;
        }
        if before.details != after.details {
            self.snapshot.cpu.busiest = Reading::Sampling;
            self.snapshot.battery = Reading::Sampling;
            self.snapshot.disk = Reading::Sampling;
        }
        true
    }

    fn commit(&mut self, generation: u64, mut snapshot: SystemSnapshot) -> bool {
        if self.generation != generation {
            return false;
        }
        snapshot.sequence = self.snapshot.sequence + 1;
        self.snapshot = snapshot;
        self.shown
    }
}

#[derive(Default)]
struct Runtime {
    state: Mutex<Control>,
    changed: Condvar,
}
static RUNTIME: OnceLock<Runtime> = OnceLock::new();
static STARTED: Once = Once::new();
fn runtime() -> &'static Runtime {
    RUNTIME.get_or_init(Runtime::default)
}

pub fn configure(items: &[MenubarItem]) {
    let r = runtime();
    let mut state = r.state.lock().unwrap();
    let shown = state.shown;
    if state.update(shown, items.to_vec()) {
        r.changed.notify_one();
    }
}

pub fn set_menu_visible(shown: bool) {
    let r = runtime();
    let mut state = r.state.lock().unwrap();
    let items = state.items.clone();
    if state.update(shown, items) {
        r.changed.notify_one();
    }
}

#[tauri::command]
pub fn sysmon_snapshot() -> SystemSnapshot {
    runtime().state.lock().unwrap().snapshot.clone()
}

pub fn start(app: AppHandle, items: &[MenubarItem]) {
    configure(items);
    STARTED.call_once(move || {
        std::thread::spawn(move || {
            let r = runtime();
            let mut sampler = Sampler::default();
            let mut epoch = u64::MAX;
            loop {
                let mut state = r.state.lock().unwrap();
                while !state.demand().active() {
                    state = r.changed.wait(state).unwrap();
                }
                let (demand, generation) = (state.demand(), state.generation);
                if epoch != state.cpu_epoch {
                    sampler.cpu = CpuTracker::default();
                    epoch = state.cpu_epoch;
                }
                let snapshot = state.snapshot.clone();
                drop(state);

                let started = Instant::now();
                let next = sampler.sample(&mut NativeCollector, demand, timestamp(), snapshot);
                let mut state = r.state.lock().unwrap();
                // Hold the control lock through emit: a hide/reopen cannot publish an old sample.
                if state.commit(generation, next) {
                    let _ = app.emit_to(crate::popover::LABEL, "sysmon", &state.snapshot);
                }
                if state.generation != generation {
                    continue;
                }
                let _ = r
                    .changed
                    .wait_timeout_while(state, INTERVAL.saturating_sub(started.elapsed()), |s| {
                        s.generation == generation
                    })
                    .unwrap();
            }
        });
    });
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

type CpuTicks = Vec<[u32; 4]>;

trait Collector {
    fn cpu(&mut self) -> Result<CpuTicks, String>;
    fn memory(&mut self) -> Result<MemoryInfo, String>;
    fn busiest(&mut self) -> Result<ProcessInfo, String>;
    fn battery(&mut self) -> Result<BatteryInfo, String>;
    fn disk(&mut self) -> Result<DiskInfo, String>;
}

#[derive(Default)]
struct CpuTracker {
    previous: Option<(u64, CpuTicks)>,
    history: VecDeque<CpuPoint>,
}

impl CpuTracker {
    fn push(&mut self, now: u64, ticks: CpuTicks) -> Option<f64> {
        let previous = self.previous.replace((now, ticks));
        let (previous_time, old) = previous?;
        let current = &self.previous.as_ref().unwrap().1;
        if now <= previous_time
            || now - previous_time > MAX_GAP_MS
            || old.len() != current.len()
            || old.is_empty()
        {
            self.history.clear();
            return None;
        }
        let (mut busy, mut total) = (0u64, 0u64);
        for (a, b) in old.iter().zip(current) {
            for i in 0..4 {
                // Mach counters are 32-bit; they legitimately wrap on long uptimes.
                let delta = b[i].wrapping_sub(a[i]) as u64;
                total += delta;
                if i != libc::CPU_STATE_IDLE as usize {
                    busy += delta;
                }
            }
        }
        if total == 0 {
            return None;
        }
        let percent = (100.0 * busy as f64 / total as f64).clamp(0.0, 100.0);
        self.history.push_back(CpuPoint {
            timestamp: now,
            percent,
        });
        while self.history.len() > 60
            || self
                .history
                .front()
                .is_some_and(|p| now - p.timestamp > 59_000)
        {
            self.history.pop_front();
        }
        Some(percent)
    }
}

#[derive(Default)]
struct Sampler {
    cpu: CpuTracker,
}

impl Sampler {
    fn sample(
        &mut self,
        collector: &mut impl Collector,
        demand: Demand,
        now: u64,
        mut out: SystemSnapshot,
    ) -> SystemSnapshot {
        if demand.cpu {
            out.cpu.usage = match collector.cpu() {
                Ok(ticks) => self
                    .cpu
                    .push(now, ticks)
                    .map(|data| Reading::Available {
                        data,
                        sampled_at: now,
                    })
                    .unwrap_or_default(),
                Err(_) => {
                    self.cpu = CpuTracker::default();
                    Reading::Unavailable
                }
            };
            out.cpu.history = self.cpu.history.iter().cloned().collect();
        }
        if demand.memory {
            out.memory = Reading::from_result(collector.memory(), now);
        }
        if demand.details {
            out.cpu.busiest = Reading::from_result(collector.busiest(), now);
            out.battery = Reading::from_result(collector.battery(), now);
            out.disk = Reading::from_result(collector.disk(), now);
        }
        out
    }
}

struct NativeCollector;

/// Memory in use right now, for pages other than the menu popover (进程管理).
pub fn memory_now() -> Result<MemoryInfo, String> {
    NativeCollector.memory()
}

unsafe extern "C" {
    // Not exposed by libc, but part of libSystem's public Mach ABI.
    fn mach_port_deallocate(
        task: libc::mach_port_t,
        name: libc::mach_port_t,
    ) -> libc::kern_return_t;
}

// These libc bindings are deprecated only in favor of the optional mach2 crate.
#[allow(deprecated)]
impl Collector for NativeCollector {
    fn cpu(&mut self) -> Result<CpuTicks, String> {
        unsafe {
            let host = libc::mach_host_self();
            let (mut count, mut len) = (0, 0);
            let mut info = std::ptr::null_mut();
            let result = libc::host_processor_info(
                host,
                libc::PROCESSOR_CPU_LOAD_INFO,
                &mut count,
                &mut info,
                &mut len,
            );
            mach_port_deallocate(libc::mach_task_self(), host);
            if result != libc::KERN_SUCCESS {
                return Err(format!("host_processor_info: {result}"));
            }
            let valid = !info.is_null() && count > 0 && len as usize >= count as usize * 4;
            let ticks = if valid {
                std::slice::from_raw_parts(info as *const u32, count as usize * 4)
                    .chunks_exact(4)
                    .map(|c| [c[0], c[1], c[2], c[3]])
                    .collect()
            } else {
                vec![]
            };
            if !info.is_null() {
                libc::vm_deallocate(
                    libc::mach_task_self(),
                    info as libc::vm_address_t,
                    len as usize * std::mem::size_of::<libc::integer_t>(),
                );
            }
            if valid {
                Ok(ticks)
            } else {
                Err("无效的 CPU 计数".into())
            }
        }
    }

    fn memory(&mut self) -> Result<MemoryInfo, String> {
        unsafe {
            let mut stats: libc::vm_statistics64 = std::mem::zeroed();
            let mut len = libc::HOST_VM_INFO64_COUNT;
            let host = libc::mach_host_self();
            let result = libc::host_statistics64(
                host,
                libc::HOST_VM_INFO64,
                (&mut stats as *mut libc::vm_statistics64).cast(),
                &mut len,
            );
            mach_port_deallocate(libc::mach_task_self(), host);
            if result != libc::KERN_SUCCESS {
                return Err(format!("host_statistics64: {result}"));
            }
            let total = sysctl_value::<u64>(c"hw.memsize")?;
            let page_size = libc::sysconf(libc::_SC_PAGESIZE);
            if total == 0 || page_size <= 0 {
                return Err("无效的内存容量".into());
            }
            let used = memory_bytes(
                stats.active_count,
                stats.wire_count,
                stats.compressor_page_count,
                page_size as u64,
            )
            .min(total);
            let pressure =
                pressure_level(sysctl_value::<i32>(c"kern.memorystatus_vm_pressure_level").ok());
            Ok(MemoryInfo {
                used_bytes: used,
                total_bytes: total,
                pressure,
            })
        }
    }

    fn busiest(&mut self) -> Result<ProcessInfo, String> {
        parse_process(&command_output("/bin/ps", &["-Ao", "pcpu,comm", "-r"])?)
    }
    fn battery(&mut self) -> Result<BatteryInfo, String> {
        parse_battery(&command_output("/usr/bin/pmset", &["-g", "batt"])?)
    }
    fn disk(&mut self) -> Result<DiskInfo, String> {
        unsafe {
            let mut stats: libc::statfs = std::mem::zeroed();
            if libc::statfs(c"/".as_ptr(), &mut stats) != 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let total_bytes = stats.f_blocks.saturating_mul(stats.f_bsize as u64);
            if total_bytes == 0 {
                return Err("无效的磁盘容量".into());
            }
            Ok(DiskInfo {
                available_bytes: stats
                    .f_bavail
                    .saturating_mul(stats.f_bsize as u64)
                    .min(total_bytes),
                total_bytes,
            })
        }
    }
}

fn memory_bytes(active: u32, wired: u32, compressed: u32, page_size: u64) -> u64 {
    (active as u64 + wired as u64 + compressed as u64).saturating_mul(page_size)
}

fn pressure_level(value: Option<i32>) -> Pressure {
    // The sysctl converts internal XNU levels to dispatch masks (1, 2, 4).
    // bsd/kern/kern_memorystatus_notify.c: sysctl_memorystatus_vm_pressure_level.
    match value {
        Some(1) => Pressure::Normal,
        Some(2) => Pressure::Warning,
        Some(4) => Pressure::Critical,
        _ => Pressure::Unknown,
    }
}

fn sysctl_value<T: Default>(name: &std::ffi::CStr) -> Result<T, String> {
    let mut value = T::default();
    let mut len = std::mem::size_of::<T>();
    let result = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            (&mut value as *mut T).cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if result == 0 && len == std::mem::size_of::<T>() {
        Ok(value)
    } else {
        Err(std::io::Error::last_os_error().to_string())
    }
}

pub(crate) fn command_output(program: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(program)
        .args(args)
        .env("LC_ALL", "C")
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn parse_process(text: &str) -> Result<ProcessInfo, String> {
    for line in text.lines() {
        let line = line.trim();
        let Some((first, rest)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        let Ok(percent) = first.parse::<f64>() else {
            continue;
        };
        let path = rest.trim();
        if path.is_empty() || !percent.is_finite() || percent < 0.0 {
            continue;
        }
        let name = path.rsplit('/').next().unwrap_or(path).to_string();
        return Ok(ProcessInfo { name, percent });
    }
    Err("无法读取最忙进程".into())
}

fn parse_battery(text: &str) -> Result<BatteryInfo, String> {
    let Some(line) = text.lines().find(|l| l.contains('%')) else {
        return if text.contains("Now drawing from") && !text.contains("InternalBattery") {
            Ok(BatteryInfo::Absent)
        } else {
            Err("无法读取电池".into())
        };
    };
    let (prefix, rest) = line.split_once('%').unwrap();
    let percent = prefix
        .split_whitespace()
        .last()
        .and_then(|v| v.parse::<u8>().ok())
        .filter(|p| *p <= 100)
        .ok_or("无效的电量")?;
    let state = if rest.contains("discharging") {
        BatteryState::Discharging
    } else if rest.contains("not charging") {
        BatteryState::NotCharging
    } else if rest.contains("charged") {
        BatteryState::Charged
    } else if rest.contains("charging") {
        BatteryState::Charging
    } else if rest.contains("AC attached") {
        BatteryState::NotCharging
    } else {
        return Err("未知的电池状态".into());
    };
    let remaining_minutes = if matches!(state, BatteryState::Charging | BatteryState::Discharging) {
        rest.split_whitespace().find_map(|word| {
            let (h, m) = word.split_once(':')?;
            let (h, m) = (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?);
            (m < 60)
                .then(|| h.checked_mul(60)?.checked_add(m))
                .flatten()
        })
    } else {
        None
    };
    Ok(BatteryInfo::Present {
        percent,
        state,
        remaining_minutes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_delta_wrap_and_resume() {
        let mut cpu = CpuTracker::default();
        assert_eq!(cpu.push(1000, vec![[u32::MAX - 4, 0, 100, 0]]), None);
        assert_eq!(cpu.push(2000, vec![[5, 0, 130, 0]]), Some(25.0));
        assert_eq!(cpu.push(3000, vec![[5, 0, 130, 0]]), None);
        assert_eq!(cpu.push(20_000, vec![[100, 0, 200, 0]]), None);
        assert!(cpu.history.is_empty());
        assert_eq!(cpu.push(21_000, vec![[110, 0, 210, 0]]), Some(50.0));
        assert_eq!(cpu.push(22_000, vec![[0; 4]; 2]), None);
        assert!(cpu.history.is_empty());
    }

    #[test]
    fn cpu_history_is_limited_to_sixty_seconds() {
        let mut cpu = CpuTracker::default();
        for i in 0..100 {
            cpu.push(i * 1000, vec![[i as u32, 0, i as u32, 0]]);
        }
        assert_eq!(cpu.history.len(), 60);
        assert_eq!(cpu.history.front().unwrap().timestamp, 40_000);
    }

    #[test]
    fn memory_pages_and_unknown_pressure() {
        assert_eq!(memory_bytes(10, 20, 30, 16384), 60 * 16384);
        assert_eq!(memory_bytes(10, 20, 30, 4096), 60 * 4096);
        assert_eq!(pressure_level(Some(1)), Pressure::Normal);
        assert_eq!(pressure_level(Some(2)), Pressure::Warning);
        assert_eq!(pressure_level(Some(3)), Pressure::Unknown);
        assert_eq!(pressure_level(Some(4)), Pressure::Critical);
        assert_eq!(pressure_level(None), Pressure::Unknown);
        assert_eq!(pressure_level(Some(8)), Pressure::Unknown);
    }

    #[test]
    fn battery_states_and_missing_estimates() {
        for (status, state, remaining) in [
            ("charging; 0:25 remaining", BatteryState::Charging, Some(25)),
            (
                "discharging; 4:05 remaining",
                BatteryState::Discharging,
                Some(245),
            ),
            ("charged; 0:00 remaining", BatteryState::Charged, None),
            ("AC attached; not charging", BatteryState::NotCharging, None),
            ("charging; (no estimate)", BatteryState::Charging, None),
            (
                "discharging; (no estimate)",
                BatteryState::Discharging,
                None,
            ),
            ("charging; 0:99 remaining", BatteryState::Charging, None),
        ] {
            assert_eq!(parse_battery(&format!("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; {status} present: true")).unwrap(),
                BatteryInfo::Present { percent: 80, state, remaining_minutes: remaining });
        }
        assert_eq!(
            parse_battery("Now drawing from 'AC Power'\n").unwrap(),
            BatteryInfo::Absent
        );
        assert!(parse_battery("garbage").is_err());
        assert!(parse_battery("InternalBattery 120%; charging").is_err());
    }

    #[test]
    fn process_paths_with_spaces_and_multicore_values() {
        let result = parse_process("%CPU COMM\n 234.5 /Applications/Visual Studio Code.app/Contents/MacOS/Code Helper\n 12.0 other").unwrap();
        assert_eq!(result.name, "Code Helper");
        assert_eq!(result.percent, 234.5);
        assert!(parse_process("%CPU COMM\nNaN invalid\n").is_err());
    }

    #[derive(Default)]
    struct FakeCollector {
        calls: Vec<&'static str>,
    }
    impl Collector for FakeCollector {
        fn cpu(&mut self) -> Result<CpuTicks, String> {
            self.calls.push("cpu");
            Ok(vec![[0; 4]])
        }
        fn memory(&mut self) -> Result<MemoryInfo, String> {
            self.calls.push("memory");
            Err("denied".into())
        }
        fn busiest(&mut self) -> Result<ProcessInfo, String> {
            self.calls.push("process");
            Err("denied".into())
        }
        fn battery(&mut self) -> Result<BatteryInfo, String> {
            self.calls.push("battery");
            Ok(BatteryInfo::Absent)
        }
        fn disk(&mut self) -> Result<DiskInfo, String> {
            self.calls.push("disk");
            Err("denied".into())
        }
    }

    #[test]
    fn demand_stops_unselected_collectors_and_keeps_failures_independent() {
        let mut control = Control::default();
        let mut collector = FakeCollector::default();
        let mut sampler = Sampler::default();
        assert!(!control.demand().active());
        control.update(true, vec![]);
        let snapshot = sampler.sample(
            &mut collector,
            control.demand(),
            1000,
            SystemSnapshot::default(),
        );
        assert_eq!(
            collector.calls,
            ["cpu", "memory", "process", "battery", "disk"]
        );
        assert!(matches!(snapshot.memory, Reading::Unavailable));
        assert!(matches!(
            snapshot.battery,
            Reading::Available {
                data: BatteryInfo::Absent,
                ..
            }
        ));
        for (items, expected) in [
            (vec![MenubarItem::Cpu], vec!["cpu"]),
            (vec![MenubarItem::Memory], vec!["memory"]),
            (vec![], vec![]),
        ] {
            control.update(false, items);
            collector.calls.clear();
            sampler.sample(
                &mut collector,
                control.demand(),
                2000,
                SystemSnapshot::default(),
            );
            assert_eq!(collector.calls, expected);
        }
    }

    #[test]
    fn snapshot_wire_names_match_the_frontend_contract() {
        let mut collector = FakeCollector::default();
        let snapshot = Sampler::default().sample(
            &mut collector,
            Demand {
                cpu: true,
                memory: true,
                details: true,
            },
            1234,
            SystemSnapshot::default(),
        );
        let json = serde_json::to_value(snapshot).unwrap();
        assert_eq!(json["cpu"]["usage"]["state"], "sampling");
        assert_eq!(json["memory"]["state"], "unavailable");
        assert_eq!(json["battery"]["state"], "available");
        assert_eq!(json["battery"]["sampledAt"], 1234);
        assert_eq!(json["battery"]["data"]["status"], "absent");
        let battery = Reading::Available {
            data: BatteryInfo::Present {
                percent: 80,
                state: BatteryState::NotCharging,
                remaining_minutes: None,
            },
            sampled_at: 1234,
        };
        let json = serde_json::to_value(battery).unwrap();
        assert_eq!(json["data"]["state"], "notCharging");
        assert!(json["data"]["remainingMinutes"].is_null());
    }

    #[test]
    fn hide_reopen_drops_inflight_result_and_resets_cpu_only_when_stopped() {
        let mut state = Control::default();
        state.update(true, vec![MenubarItem::Cpu]);
        let (generation, epoch) = (state.generation, state.cpu_epoch);
        assert!(!state.update(true, vec![MenubarItem::Cpu]));
        state.update(false, vec![MenubarItem::Cpu]);
        assert_eq!(epoch, state.cpu_epoch);
        assert!(!state.commit(generation, SystemSnapshot::default()));
        state.update(true, vec![MenubarItem::Cpu]);
        assert!(!state.commit(generation, SystemSnapshot::default()));
        assert!(state.commit(state.generation, SystemSnapshot::default()));
        state.update(false, vec![]);
        assert_ne!(epoch, state.cpu_epoch);
        assert!(state.snapshot.cpu.history.is_empty());
        assert!(!state.demand().active());
    }

    /// Read-only smoke check, run outside an automation sandbox to inspect macOS sources.
    #[test]
    #[ignore]
    fn native_preview() {
        let mut collector = NativeCollector;
        let mut cpu = CpuTracker::default();
        assert_eq!(
            cpu.push(timestamp(), collector.cpu().expect("CPU counters")),
            None
        );
        std::thread::sleep(INTERVAL);
        let percent = cpu
            .push(timestamp(), collector.cpu().expect("CPU counters"))
            .expect("CPU delta");
        assert!((0.0..=100.0).contains(&percent));
        let memory = collector.memory().expect("memory");
        assert!(memory.used_bytes <= memory.total_bytes && memory.total_bytes > 0);
        let process = collector.busiest().expect("process list");
        let battery = collector.battery().expect("battery");
        let disk = collector.disk().expect("disk");
        assert!(disk.available_bytes <= disk.total_bytes && disk.total_bytes > 0);
        println!(
            "CPU: {percent:.1}%\nmemory: {memory:?}\nbusiest: {process:?}\nbattery: {battery:?}\ndisk: {disk:?}"
        );
    }
}
