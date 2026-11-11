// Mirrors src-tauri/src/plugins/processes.rs. Memory in bytes, CPU in percent of one core.
import type { Pressure } from "../../src/sysmon";

export interface ProcessRow {
  pid: number;
  name: string;
  path: string;
  cpu: number;
  memory: number;
  mine: boolean;
  protected: boolean;
}
export interface AppGroup {
  /** The .app path, or "pid:<n>" for a lone process. */
  id: string;
  name: string;
  bundle: string | null;
  cpu: number;
  memory: number;
  mine: boolean;
  protected: boolean;
  processes: ProcessRow[];
}
export interface ProcessSnapshot {
  groups: AppGroup[];
  count: number;
  cores: number;
  memory: { usedBytes: number; totalBytes: number; pressure: Pressure } | null;
}
export type SortKey = "cpu" | "memory";
export type View = "apps" | "all";

export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const formatCpu = (cpu: number) => `${cpu >= 100 ? Math.round(cpu) : cpu.toFixed(1)}%`;

/** Rows worth a second look when the Mac feels slow. */
export function heavy(cpu: number, memory: number): "" | "warn" | "bad" {
  if (cpu >= 80) return "bad";
  if (cpu >= 30 || memory >= 2 * 1024 ** 3) return "warn";
  return "";
}

/** All processes against the whole machine, 0–100. */
export function totalCpu(snapshot: ProcessSnapshot) {
  const sum = snapshot.groups.reduce((total, g) => total + g.cpu, 0);
  return Math.min(100, sum / Math.max(1, snapshot.cores));
}

function matches(group: AppGroup, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return group.name.toLowerCase().includes(q) || group.processes.some((p) =>
    p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || String(p.pid) === q);
}

/** What the list shows: apps with their helpers, or every process on its own row. */
export function visibleGroups(snapshot: ProcessSnapshot | null, view: View, sort: SortKey, query: string): AppGroup[] {
  if (!snapshot) return [];
  const groups = view === "apps" ? snapshot.groups : snapshot.groups.flatMap((g) => g.processes.map((p) => ({
    id: `pid:${p.pid}`, name: p.name, bundle: g.bundle, cpu: p.cpu, memory: p.memory, mine: p.mine, protected: p.protected, processes: [p],
  })));
  return groups.filter((g) => matches(g, query))
    .sort((a, b) => (b[sort] - a[sort]) || (sort === "cpu" ? b.memory - a.memory : b.cpu - a.cpu) || a.name.localeCompare(b.name));
}

/** Why a row can't be quit, or "" when it can. */
export function lockReason(row: { mine: boolean; protected: boolean }) {
  if (row.protected) return "系统必需的进程，不能结束";
  if (!row.mine) return "属于系统或其他用户，AhaTools 无权结束";
  return "";
}
