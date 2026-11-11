import { describe, expect, test } from "bun:test";
import { filterListeners, ms, replyTime, summarize } from "../plugins/network/model";
import { findError, locate, transform } from "../plugins/json/model";

describe("ping", () => {
  const lines = [
    "PING github.com (140.82.112.3): 56 data bytes",
    "64 bytes from 140.82.112.3: icmp_seq=0 ttl=52 time=38.104 ms",
    "Request timeout for icmp_seq 1",
    "64 bytes from 140.82.112.3: icmp_seq=2 ttl=52 time=42.000 ms",
  ];
  test("回复时间与途中统计", () => {
    expect(replyTime(lines[1])).toBeCloseTo(38.104);
    expect(replyTime("64 bytes from ::1: icmp_seq=0 hlim=64 time<1 ms")).toBe(1);
    expect(replyTime(lines[2])).toBeNull();
    const s = summarize(lines);
    expect([s.sent, s.received, s.loss]).toEqual([3, 2, 33.3]);
    expect(s.avg).toBeCloseTo(40.052);
  });
  test("结束后用 ping 自己的统计", () => {
    const s = summarize([...lines, "--- github.com ping statistics ---", "10 packets transmitted, 9 packets received, 10.0% packet loss",
      "round-trip min/avg/max/stddev = 29.461/38.204/46.913/6.012 ms"]);
    expect(s).toEqual({ sent: 10, received: 9, loss: 10, min: 29.461, avg: 38.204, max: 46.913 });
    expect(ms(null)).toBe("—");
    expect(ms(3.14159)).toBe("3.14 ms");
    expect(ms(38.204)).toBe("38.2 ms");
  });
});

describe("端口筛选", () => {
  const rows = [
    { port: 3000, address: "*", pid: 50200, process: "node", user: "me" },
    { port: 30001, address: "127.0.0.1", pid: 7, process: "Docker", user: "me" },
    { port: 5432, address: "127.0.0.1", pid: 812, process: "postgres", user: "me" },
  ];
  test("端口、进程名和 PID", () => {
    expect(filterListeners(rows, ":3000").map((r) => r.port)).toEqual([3000, 30001]);
    expect(filterListeners(rows, "POST").map((r) => r.port)).toEqual([5432]);
    expect(filterListeners(rows, "812").map((r) => r.port)).toEqual([5432]);
    expect(filterListeners(rows, "")).toHaveLength(3);
  });
});

describe("JSON 工具", () => {
  test("格式化、压缩、排序键", () => {
    const text = '{"b":1,"a":[true,null,"x"]}';
    expect(transform(text, "format", { indent: 2, sort: false }).output).toBe('{\n  "b": 1,\n  "a": [\n    true,\n    null,\n    "x"\n  ]\n}');
    expect(transform(text, "minify", { indent: 2, sort: true }).output).toBe('{"a":[true,null,"x"],"b":1}');
    expect(transform(text, "format", { indent: 4, sort: false }).output).toContain('\n    "b": 1');
  });
  test("转义和去转义", () => {
    const escaped = transform('{"a": "你好"}', "escape", { indent: 2, sort: false }).output;
    expect(escaped).toBe('"{\\"a\\": \\"你好\\"}"');
    expect(transform(escaped, "unescape", { indent: 2, sort: false }).output).toBe('{\n  "a": "你好"\n}');
    expect(transform("line\\nnext", "unescape", { indent: 2, sort: false }).output).toBe("line\nnext");
    expect(transform('"bad \\q"', "unescape", { indent: 2, sort: false }).error).toBeDefined();
  });
  test("出错位置用行列和中文说明", () => {
    const cases: [string, number, number, string][] = [
      ['{\n  "a": 1\n  "b": 2\n}', 3, 3, "缺少逗号"],
      ['[{"a": 1} {"b": 2}]', 1, 11, "缺少逗号"],
      ["{'a': 1}", 1, 2, "双引号"],
      ['{"a": 1,}', 1, 9, "多了逗号"],
      ['[1, 2', 1, 6, "内容不完整"],
      ['{"a": 01}', 1, 8, "逗号或 }"],
      ["// note\n{}", 1, 1, "注释"],
      ['{"a": "x\ny"}', 1, 9, "换行"],
      ["{} []", 1, 4, "多余内容"],
    ];
    for (const [text, line, column, words] of cases) {
      const error = findError(text)!;
      expect(error, text).not.toBeNull();
      expect([error.line, error.column], text).toEqual([line, column]);
      expect(error.message, text).toContain(words);
    }
    expect(findError('{"ok": [1, -2.5e3, "\\u4f60"], "n": null}')).toBeNull();
    expect(findError("   ")?.message).toBe("没有内容");
    expect(locate("一\n二三", 3)).toEqual({ line: 2, column: 2 });
  });
});
