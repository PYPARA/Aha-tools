import { describe, expect, test } from "bun:test";
import { title, visibleEntries, when, type Entry } from "../plugins/clipboard/model";

const entry = (id: string, kind: Entry["kind"], at: number, extra: Partial<Entry> = {}): Entry =>
  ({ id, kind, text: "", paths: [], image: null, app: null, at, pinned: false, truncated: false, ...extra });
const entries = [
  entry("a", "text", 100, { text: "hello world", app: "Safari" }),
  entry("b", "image", 300, { image: { file: "b.png", width: 1280, height: 720 } }),
  entry("c", "files", 200, { paths: ["/Users/me/图片/a.png", "/Users/me/图片/b.png"] }),
  entry("d", "text", 50, { text: "固定的命令", pinned: true }),
];

describe("剪贴板历史", () => {
  test("固定的在前，其余按时间倒序；按类型和文字筛选", () => {
    expect(visibleEntries(entries, "all", "").map((e) => e.id)).toEqual(["d", "b", "c", "a"]);
    expect(visibleEntries(entries, "text", "").map((e) => e.id)).toEqual(["d", "a"]);
    expect(visibleEntries(entries, "all", "safari").map((e) => e.id)).toEqual(["a"]);
    expect(visibleEntries(entries, "all", "图片").map((e) => e.id)).toEqual(["c"]);
  });
  test("列表标题", () => {
    expect(title(entries[1])).toBe("图片 · 1280 × 720");
    expect(title(entries[2])).toBe("a.png 等 2 个文件");
    expect(title(entry("x", "text", 0, { text: "  多行\n文字 " }))).toBe("多行 文字");
  });
  test("时间", () => {
    const now = new Date(2026, 10, 11, 15, 0).getTime() / 1000;
    expect(when(now - 10, now)).toBe("刚刚");
    expect(when(now - 600, now)).toBe("10 分钟前");
    expect(when(now - 3 * 3600, now)).toBe("12:00");
    expect(when(now - 20 * 3600, now)).toBe("昨天 19:00");
    expect(when(now - 9 * 86400, now)).toBe("11月2日");
  });
});
