import { describe, expect, test } from "bun:test";
import { batchAge, batchReducer, canExport, emptyState, formatBytes, parsePaths, summary, type CompressionBatch, type CompressionItem } from "../plugins/compress/model";

const item = (values: Partial<CompressionItem> = {}): CompressionItem => ({
  itemId: "0", path: "/图片/a.png", name: "a.png", before: 1000, after: null,
  status: "waiting", version: 0, message: "等待中", outputName: null, canOverwrite: false, ...values,
});
const batch = (id = "first", values: Partial<CompressionItem> = {}): CompressionBatch => ({ batchId: id, createdAt: 1, quality: 80, toWebp: false, items: [item(values)] });

describe("压缩状态合并", () => {
  test("完成事件先于启动响应时，初始快照不会覆盖结果", () => {
    let state = batchReducer(emptyState, { type: "progress", progress: { batchId: "first", ...item({ status: "compressed", version: 2, after: 200 }) } });
    state = batchReducer(state, { type: "snapshots", batches: [batch()] });
    expect(state.batches[0].items[0].status).toBe("compressed");
    expect(state.batches[0].items[0].after).toBe(200);
    expect(state.pending).toEqual({});
  });
  test("重新进入页面或乱序事件均保留最新版本", () => {
    let state = batchReducer(emptyState, { type: "snapshots", batches: [batch("first", { status: "compressed", version: 2, after: 300 })] });
    state = batchReducer(state, { type: "progress", progress: { batchId: "first", ...item({ status: "running", version: 1 }) } });
    state = batchReducer(state, { type: "snapshots", batches: [batch()] });
    expect(state.batches[0].items[0].after).toBe(300);
    expect(state.batches).toHaveLength(1);
  });
  test("新批次不修改旧批次；多个文件独立合并", () => {
    const first = batch();
    let state = batchReducer(emptyState, { type: "snapshots", batches: [first, { ...batch("second"), createdAt: 2, items: [item(), item({ itemId: "1" })] }] });
    state = batchReducer(state, { type: "progress", progress: { batchId: "second", ...item({ itemId: "1", version: 2, status: "failed" }) } });
    expect(state.batches[0]).toEqual(first);
    expect(state.batches[1].items.map((i) => i.status)).toEqual(["waiting", "failed"]);
    expect(first.items[0].status).toBe("waiting");
  });
});

describe("压缩结果与输入", () => {
  test("统计只计算有效输出，跳过及错误不虚增节省", () => {
    const mixed = { ...batch(), items: [item({ status: "compressed", after: 250 }), item({ itemId: "1", status: "unchanged", after: 1000 }), item({ itemId: "2", status: "failed" }), item({ itemId: "3", status: "skipped" })] };
    expect(summary(mixed)).toEqual({ finished: 4, failed: 1, skipped: 1, saved: 750, percent: 38, done: true });
    expect(mixed.items.map(canExport)).toEqual([true, true, false, false]);
    expect(summary(batch()).done).toBe(false);
  });
  test("路径 JSON 保留空格引号与中文，拒绝文字和非字符串", () => {
    const paths = ["/图片/a ' b.png", "/图片/第二张.webp"];
    expect(parsePaths(JSON.stringify(paths))).toEqual(paths);
    expect(parsePaths()).toEqual([]);
    for (const value of ["hello", "{}", "[]", '["a",2]', '[""]']) expect(() => parsePaths(value)).toThrow("文件列表无效");
  });
  test("批次时间和体积文案", () => {
    expect(batchAge(100_000, 100_001)).toBe("刚刚");
    expect(batchAge(0, 120_000)).toBe("2 分钟前");
    expect(batchAge(0, 3_600_000)).toBe("1 小时前");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});
