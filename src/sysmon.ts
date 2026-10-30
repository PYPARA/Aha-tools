// Mirrors sysmon.rs. Units on the wire are bytes, percent, and Unix milliseconds.
export type Reading<T> =
  | { state: "sampling" }
  | { state: "unavailable" }
  | { state: "available"; data: T; sampledAt: number };

export type Pressure = "normal" | "warning" | "critical" | "unknown";
export type BatteryState = "charging" | "discharging" | "charged" | "notCharging";
export type BatteryInfo =
  | { status: "absent" }
  | { status: "present"; percent: number; state: BatteryState; remainingMinutes: number | null };

export interface SystemSnapshot {
  sequence: number;
  cpu: {
    usage: Reading<number>;
    history: { timestamp: number; percent: number }[];
    busiest: Reading<{ name: string; percent: number }>;
  };
  memory: Reading<{ usedBytes: number; totalBytes: number; pressure: Pressure }>;
  battery: Reading<BatteryInfo>;
  disk: Reading<{ availableBytes: number; totalBytes: number }>;
}

export const EMPTY_SYSTEM: SystemSnapshot = {
  sequence: 0,
  cpu: { usage: { state: "sampling" }, history: [], busiest: { state: "sampling" } },
  memory: { state: "sampling" }, battery: { state: "sampling" }, disk: { state: "sampling" },
};

export const readingLabel = (value: Reading<unknown>) => value.state === "sampling" ? "正在采样" : "暂不可用";

export const pressureLabel: Record<Pressure, string> = {
  normal: "压力正常", warning: "压力偏高", critical: "压力严重", unknown: "压力未知",
};

export function capacity(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1024 ? `${(gb / 1024).toFixed(1).replace(/\.0$/, "")} TB` : `${gb.toFixed(gb < 100 ? 1 : 0).replace(/\.0$/, "")} GB`;
}

export function batteryLabel(battery: Extract<BatteryInfo, { status: "present" }>): string {
  const labels: Record<BatteryState, string> = { charging: "充电中", discharging: "使用电池", charged: "已充满", notCharging: "已接电 · 未充电" };
  const minutes = battery.remainingMinutes;
  if (minutes === null || !["charging", "discharging"].includes(battery.state)) return labels[battery.state];
  const duration = minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`;
  return battery.state === "charging" ? `充电中 · 约 ${duration}充满` : `使用电池 · 约剩 ${duration}`;
}
