import { batteryLabel, capacity, pressureLabel, readingLabel, type SystemSnapshot } from "./sysmon";

function Meter({ value, label, tone = "accent" }: { value: number; label: string; tone?: string }) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <span className={`monitor-bar tone-${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <span style={{ width: `${percent}%` }} />
    </span>
  );
}

function CpuGraph({ history }: { history: SystemSnapshot["cpu"]["history"] }) {
  const latest = history[history.length - 1]?.timestamp ?? 0;
  const points = history.map(({ timestamp, percent }) => `${(268 - (latest - timestamp) / 59_000 * 268).toFixed(1)},${(26 - percent / 100 * 24).toFixed(1)}`);
  const first = points[0]?.split(",")[0] ?? "268";
  return (
    <svg className="cpu-graph" viewBox="0 0 268 28" role="img" aria-label="最近 60 秒 CPU 使用率曲线">
      {points.length > 1 && <>
        <polygon points={`${first},28 ${points.join(" ")} 268,28`} fill="var(--accent)" opacity=".1" />
        <polyline points={points.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
      </>}
    </svg>
  );
}

/** `openProcesses`: the 最忙进程 line opens 进程管理. */
export default function SystemMonitor({ snapshot, openProcesses }: { snapshot: SystemSnapshot; openProcesses?: () => void }) {
  const { cpu, memory, battery, disk } = snapshot;
  const mem = memory.state === "available" ? memory.data : null;
  const batt = battery.state === "available" ? battery.data : null;
  const storage = disk.state === "available" ? disk.data : null;
  const busiest = cpu.busiest.state === "available" ? `${cpu.busiest.data.name} ${Math.round(cpu.busiest.data.percent)}%` : readingLabel(cpu.busiest);
  const memoryTone = mem?.pressure === "critical" ? "bad" : mem?.pressure === "warning" ? "warn" : "accent";

  return (
    <section className="system-monitor" aria-label="系统监控">
      <div className="monitor-metric">
        <div className="monitor-line"><span className="monitor-label">CPU</span><span className={cpu.usage.state === "available" ? "monitor-number" : "monitor-note"}>
          {cpu.usage.state === "available" ? `${Math.round(cpu.usage.data)}%` : readingLabel(cpu.usage)}
        </span></div>
        <button type="button" className="monitor-process monitor-note" title={`最忙进程：${busiest} · 点按打开进程管理`}
          onClick={openProcesses}>最忙进程：{busiest}</button>
        <CpuGraph history={cpu.history} />
      </div>
      <div className="monitor-metric">
        <div className="monitor-line">
          <span className="monitor-label">内存</span>
          {mem ? <>
            <span className="monitor-number">{capacity(mem.usedBytes)}</span>
            <span className="monitor-note">/ {capacity(mem.totalBytes)}</span>
            <span className={`monitor-note monitor-end tone-${memoryTone}`}>{pressureLabel[mem.pressure]}</span>
          </> : <span className="monitor-note">{readingLabel(memory)}</span>}
        </div>
        {mem && <>
          <Meter label="内存使用率" value={mem.usedBytes / mem.totalBytes * 100} tone={memoryTone} />
        </>}
      </div>
      <div className="monitor-metric">
        <div className="monitor-line">
          <span className="monitor-label">电池</span>
          {batt?.status === "present" ? <span className="monitor-number">{batt.percent}%</span> : <span className="monitor-note">{batt?.status === "absent" ? "无内置电池" : readingLabel(battery)}</span>}
        </div>
        {batt?.status === "present" && <>
          <Meter label="电池电量" value={batt.percent} tone={batt.state === "discharging" && batt.percent <= 20 ? "warn" : "ok"} />
          <span className="monitor-note">{batteryLabel(batt)}</span>
        </>}
      </div>
      <div className="monitor-metric">
        <div className="monitor-line">
          <span className="monitor-label">磁盘</span>
          {storage ? <><span className="monitor-number">{capacity(storage.availableBytes)}</span><span className="monitor-note">可用 / {capacity(storage.totalBytes)}</span></> : <span className="monitor-note">{readingLabel(disk)}</span>}
        </div>
      </div>
    </section>
  );
}
