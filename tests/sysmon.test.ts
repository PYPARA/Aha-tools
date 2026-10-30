import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SystemMonitor from "../src/SystemMonitor";
import { batteryLabel, EMPTY_SYSTEM, type SystemSnapshot } from "../src/sysmon";

const render = (snapshot: SystemSnapshot) => renderToStaticMarkup(createElement(SystemMonitor, { snapshot }));

test("等待首次 CPU 采样时不显示虚假的零，单项失败不影响其他指标", () => {
  const pending = render(EMPTY_SYSTEM);
  expect(pending).toContain("正在采样");
  expect(pending).not.toContain("0%");
  const partial: SystemSnapshot = {
    ...EMPTY_SYSTEM,
    cpu: { ...EMPTY_SYSTEM.cpu, busiest: { state: "unavailable" } },
    memory: { state: "available", sampledAt: 1000, data: { usedBytes: 11.2 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, pressure: "unknown" } },
    battery: { state: "available", sampledAt: 1000, data: { status: "absent" } },
    disk: { state: "unavailable" },
  };
  const html = render(partial);
  for (const text of ["暂不可用", "11.2 GB", "16 GB", "压力未知", "无内置电池"]) expect(html).toContain(text);
  expect(html).toContain('aria-label="内存使用率"');
  expect(html).not.toContain('aria-label="电池电量"');
});

test("电池时间区分充满和剩余，接电未充电和未知时间不显示倒计时", () => {
  const base = { status: "present" as const, percent: 80, state: "charging" as const, remainingMinutes: 25 };
  expect(batteryLabel(base)).toContain("25 分钟充满");
  expect(batteryLabel({ ...base, state: "discharging", remainingMinutes: 125 })).toContain("约剩 2 小时 5 分钟");
  expect(batteryLabel({ ...base, state: "charged", remainingMinutes: 0 })).toBe("已充满");
  expect(batteryLabel({ ...base, state: "notCharging" })).toBe("已接电 · 未充电");
  expect(batteryLabel({ ...base, remainingMinutes: null })).toBe("充电中");
});

test("最忙进程保留超过 100% 的读数并转义名称，压力和低电量带语义状态", () => {
  const snapshot: SystemSnapshot = {
    ...EMPTY_SYSTEM,
    cpu: { usage: { state: "available", data: 23, sampledAt: 1000 }, history: [], busiest: { state: "available", sampledAt: 1000, data: { name: '<Helper "Renderer">', percent: 234.5 } } },
    memory: { state: "available", sampledAt: 1000, data: { usedBytes: 15 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, pressure: "critical" } },
    battery: { state: "available", sampledAt: 1000, data: { status: "present", percent: 12, state: "discharging", remainingMinutes: null } },
  };
  const html = render(snapshot);
  expect(html).toContain("235%");
  expect(html).not.toContain('<Helper "Renderer">');
  expect(html).toContain("压力严重");
  expect(html).toContain("tone-bad");
  expect(html).toContain("tone-warn");
  expect(html).toContain('aria-valuenow="12"');
});
