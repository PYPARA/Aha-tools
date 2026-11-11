// JSON 工具: pure functions, no host APIs, so they run in tests and in a worker alike.

export type JsonMode = "format" | "minify" | "escape" | "unescape";
export interface JsonError { message: string; offset: number; line: number; column: number }

export function locate(text: string, offset: number) {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length, column: Array.from(before[before.length - 1]).length + 1 };
}

/**
 * Where and why `text` isn't JSON, in Chinese; null when it is. WebKit's own JSON.parse
 * errors carry no position, so this walks the text once the way a parser would.
 */
export function findError(text: string): JsonError | null {
  let i = 0;
  const fail = (message: string): never => { throw Object.assign(new Error(message), { at: i }); };
  const ws = () => { while (i < text.length && " \t\n\r".includes(text[i])) i++; };
  const unexpected = (what: string) => {
    const c = text[i];
    if (c === undefined) fail(`内容不完整，缺少${what}`);
    if (c === "'") fail("字符串和键名需要用双引号");
    if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) fail("JSON 不支持注释");
    // The next item started without a comma: the usual cause is the line above.
    if (what.startsWith("逗号") && (c === '"' || c === "{" || c === "[")) fail("缺少逗号：上一项后面需要逗号");
    fail(`这里应是${what}，却是「${c}」`);
  };
  const string = () => {
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') { i++; return; }
      if (c === "\\") {
        const e = text[i + 1];
        if (e === "u") { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail("\\u 后面需要 4 位十六进制数"); i += 6; continue; }
        if (e === undefined || !'"\\/bfnrt'.includes(e)) fail(`无效的转义 \\${e ?? ""}`);
        i += 2;
        continue;
      }
      if (c < " ") fail("字符串里有未转义的换行或控制字符");
      i++;
    }
    fail("字符串缺少结束的引号");
  };
  const number = () => {
    const re = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) fail("数字格式不对");
    i = re.lastIndex;
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{") object();
    else if (c === "[") array();
    else if (c === '"') string();
    else if (c === "-" || (c >= "0" && c <= "9")) number();
    else if (text.startsWith("true", i)) i += 4;
    else if (text.startsWith("false", i)) i += 5;
    else if (text.startsWith("null", i)) i += 4;
    else unexpected("一个值");
  };
  const object = () => {
    i++; ws();
    if (text[i] === "}") { i++; return; }
    for (;;) {
      ws();
      if (text[i] !== '"') unexpected("带双引号的键名");
      string(); ws();
      if (text[i] !== ":") unexpected("冒号");
      i++; value(); ws();
      if (text[i] === ",") { i++; ws(); if (text[i] === "}") fail("最后一项后面多了逗号"); continue; }
      if (text[i] === "}") { i++; return; }
      unexpected("逗号或 }");
    }
  };
  const array = () => {
    i++; ws();
    if (text[i] === "]") { i++; return; }
    for (;;) {
      value(); ws();
      if (text[i] === ",") { i++; ws(); if (text[i] === "]") fail("最后一项后面多了逗号"); continue; }
      if (text[i] === "]") { i++; return; }
      unexpected("逗号或 ]");
    }
  };
  try {
    if (!text.trim()) return { message: "没有内容", offset: 0, line: 1, column: 1 };
    value(); ws();
    if (i < text.length) fail("JSON 结束后还有多余内容");
    return null;
  } catch (e) {
    const offset = (e as { at?: number }).at ?? 0;
    return { message: (e as Error).message, offset, ...locate(text, offset) };
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}

export interface Transformed { output: string; value?: unknown; error?: JsonError }

/** The result for the chosen mode; `value` is the parsed document for the tree view. */
export function transform(text: string, mode: JsonMode, options: { indent: number; sort: boolean }): Transformed {
  if (mode === "escape") return { output: JSON.stringify(text.trim()) };
  if (mode === "unescape") {
    const t = text.trim();
    let raw: string;
    try {
      const parsed: unknown = JSON.parse(t.startsWith('"') ? t : `"${t}"`);
      if (typeof parsed !== "string") throw new Error();
      raw = parsed;
    } catch {
      return { output: "", error: { message: "不是带转义的 JSON 字符串，例如 \"{\\\"a\\\":1}\"", offset: 0, line: 1, column: 1 } };
    }
    // An escaped JSON document is shown formatted.
    if (!findError(raw)) return { output: JSON.stringify(JSON.parse(raw), null, options.indent), value: JSON.parse(raw) };
    return { output: raw };
  }
  const error = findError(text);
  if (error) return { output: "", error };
  const parsed: unknown = JSON.parse(text);
  const value = options.sort ? sortKeys(parsed) : parsed;
  return { output: mode === "minify" ? JSON.stringify(value) : JSON.stringify(value, null, options.indent), value };
}

export function byteSize(text: string) {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
