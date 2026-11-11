import { describe, expect, test } from "bun:test";
import { formatBytes, formatCpu, heavy, lockReason, totalCpu, visibleGroups, type AppGroup, type ProcessSnapshot } from "../plugins/processes/model";

const row = (pid: number, name: string, cpu: number, memory: number, mine = true) => ({ pid, name, path: `/x/${name}`, cpu, memory, mine, protected: false });
const group = (id: string, name: string, rows: ReturnType<typeof row>[]): AppGroup => ({
  id, name, bundle: id.startsWith("pid:") ? null : id, cpu: rows.reduce((s, r) => s + r.cpu, 0), memory: rows.reduce((s, r) => s + r.memory, 0),
  mine: rows.every((r) => r.mine), protected: false, processes: rows,
});
const snapshot: ProcessSnapshot = {
  groups: [
    group("/A.app", "Alpha", [row(1, "Alpha Helper", 50, 100), row(2, "Alpha", 10, 900)]),
    group("pid:3", "node", [row(3, "node", 30, 2000)]),
    group("/B.app", "微信", [row(4, "WeChat", 5, 5000)]),
  ],
  count: 4, cores: 4, memory: null,
};

describe("进程管理", () => {
  test("按应用排序，按 CPU 或内存", () => {
    expect(visibleGroups(snapshot, "apps", "cpu", "").map((g) => g.name)).toEqual(["Alpha", "node", "微信"]);
    expect(visibleGroups(snapshot, "apps", "memory", "").map((g) => g.name)).toEqual(["微信", "node", "Alpha"]);
    expect(visibleGroups(null, "apps", "cpu", "")).toEqual([]);
  });
  test("全部进程把子进程摊开，各自一行并保留应用图标", () => {
    const all = visibleGroups(snapshot, "all", "cpu", "");
    expect(all.map((g) => g.name)).toEqual(["Alpha Helper", "node", "Alpha", "WeChat"]);
    expect(all[0].bundle).toBe("/A.app");
    expect(all[0].processes).toHaveLength(1);
  });
  test("筛选匹配应用名、进程名、路径或 PID", () => {
    expect(visibleGroups(snapshot, "apps", "cpu", "helper").map((g) => g.name)).toEqual(["Alpha"]);
    expect(visibleGroups(snapshot, "apps", "cpu", "微信").map((g) => g.name)).toEqual(["微信"]);
    expect(visibleGroups(snapshot, "apps", "cpu", " 3 ").map((g) => g.name)).toEqual(["node"]);
    expect(visibleGroups(snapshot, "apps", "cpu", "/x/wechat").map((g) => g.name)).toEqual(["微信"]);
    expect(visibleGroups(snapshot, "apps", "cpu", "zzz")).toEqual([]);
  });
  test("数值格式与高占用提示", () => {
    expect(formatBytes(512)).toBe("1 KB");
    expect(formatBytes(820 * 1024 ** 2)).toBe("820 MB");
    expect(formatBytes(3.14 * 1024 ** 3)).toBe("3.1 GB");
    expect(formatCpu(6.14)).toBe("6.1%");
    expect(formatCpu(186.4)).toBe("186%");
    expect(heavy(90, 0)).toBe("bad");
    expect(heavy(31, 0)).toBe("warn");
    expect(heavy(1, 3 * 1024 ** 3)).toBe("warn");
    expect(heavy(1, 1)).toBe("");
    expect(totalCpu(snapshot)).toBeCloseTo(23.75);
    expect(totalCpu({ ...snapshot, cores: 0 })).toBe(95);
  });
  test("系统进程和其他用户的进程说明原因", () => {
    expect(lockReason({ mine: true, protected: true })).toContain("系统必需");
    expect(lockReason({ mine: false, protected: false })).toContain("其他用户");
    expect(lockReason({ mine: true, protected: false })).toBe("");
  });
});
