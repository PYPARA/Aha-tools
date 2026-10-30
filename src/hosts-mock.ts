// Browser-only fixtures. The native parser and privilege boundary are tested in Rust.
import type { HostLocation, HostScheme, HostsOperation, HostsSnapshot, HostsValidation } from "./hosts";

const START = "# --- AhaTools start ---";
const END = "# --- AhaTools end ---";
const base = "##\n# Host Database\n##\n127.0.0.1 localhost\n255.255.255.255 broadcasthost\n::1 localhost\n";
let scenario = new URLSearchParams(location.search).get("hostsMock") ?? "default";
let schemes: HostScheme[] = [];
let current = base;
let original: string | null = null;
let version = 0;
let calls = 0;
let pinned = false;
let validationDelay = 0;
const clone = <T>(value: T): T => structuredClone(value);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function merge(text: string, profiles: HostScheme[]) {
  const content = profiles.filter((s) => s.enabled && s.content.trim()).map((s) => s.content.trimEnd()).join("\n\n");
  const block = content ? `${START}\n${content}\n${END}\n` : "";
  const start = text.indexOf(START);
  if (start < 0) return text + (block && !text.endsWith("\n") ? "\n" : "") + block;
  const end = text.indexOf(END, start) + END.length;
  return text.slice(0, start) + block + text.slice(end + (text[end] === "\n" ? 1 : 0));
}

function reset(next: string) {
  scenario = next; calls = 0; ++version; original = null; current = base;
  schemes = next === "empty" ? [] : [
    { id: "dev", name: "开发环境", enabled: true, content: "# 开发环境\n127.0.0.1   api.local.test\n127.0.0.1   web.local.test\n192.168.1.20   gitlab.company.lan\n192.168.1.21   nexus.company.lan\n# 临时：联调\n10.0.3.15   pay-sandbox.company.lan" },
    { id: "test", name: "测试环境", enabled: false, content: "10.0.2.10 api.local.test\n10.0.2.11 test.company.lan" },
    { id: "ads", name: "屏蔽广告", enabled: false, content: "0.0.0.0 ads.example.test\n::1 ads.example.test" },
  ];
  if (next === "invalid") schemes[1].content = "不是合法 hosts 条目";
  if (next === "conflict") schemes[1].enabled = true;
  if (next === "system-conflict") current += "10.1.0.1 api.local.test\n";
  if (next !== "empty") { original = current; current = merge(current, schemes); }
  if (next === "markers") current += `${START}\n`;
}
reset(scenario);

function snapshot(): HostsSnapshot {
  const markerError = scenario === "markers" ? "AhaTools 开始标记缺少对应的结束标记" : null;
  return clone({ schemes, current, original, revision: String(version), managed: current.includes(START),
    matchesSaved: !markerError && merge(current, schemes) === current, markerError });
}

function ipKey(value: string) {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split(".").every((part) => Number(part) <= 255 && String(Number(part)) === part)) return value;
  if (value.includes(":")) { try { return new URL(`http://[${value}]/`).hostname; } catch { /* invalid IPv6 */ } }
  return null;
}

function validate(profiles: HostScheme[]): HostsValidation {
  const result: HostsValidation = { issues: [], counts: {} };
  const seen = new Map<string, { ip: string; location: HostLocation }[]>();
  const parse = (text: string, scheme: HostScheme | null) => {
    let inBlock = false;
    let count = 0;
    text.split("\n").forEach((raw, index) => {
      const line = raw.replace(/\r$/, "");
      if (!scheme && line === START) { inBlock = true; return; }
      if (!scheme && line === END) { inBlock = false; return; }
      if (!scheme && inBlock) return;
      const location: HostLocation = { schemeId: scheme?.id ?? null, line: index + 1 };
      const fields = line.split("#")[0].trim().split(/\s+/).filter(Boolean);
      const ip = ipKey(fields[0] ?? "");
      let error = line.trim() === START || line.trim() === END ? "方案内不能包含 AhaTools 保留标记" :
        /[\x00-\x08\x0b-\x1f]/.test(line) ? "行内包含不支持的控制字符" : "";
      if (!error && fields.length === 0) return;
      if (!error) error = !ip ? "IP 地址不合法" : fields.length < 2 ? "IP 后至少需要一个主机名" :
        fields.slice(1).some((host) => !/^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*\.?$/u.test(host)) ? "主机名不合法：请填域名或内部主机名，不要带网址、端口或通配符" : "";
      if (error) {
        if (scheme) result.issues.push({ code: "syntax", message: error, blocking: scheme.enabled, location, related: [] });
        return;
      }
      ++count;
      if (scheme && !scheme.enabled) return;
      for (const host of fields.slice(1)) {
        const key = `${host.toLowerCase().replace(/\.$/, "")}/${ip!.includes(":") ? 6 : 4}`;
        const previous = seen.get(key) ?? [];
        const related = previous.filter((item) => item.ip !== ip).map((item) => item.location);
        if (scheme && related.length) result.issues.push({ code: "conflict", message: `${host} 存在不同的 ${ip!.includes(":") ? "IPv6" : "IPv4"} 地址`,
          blocking: true, location, related });
        seen.set(key, [...previous, { ip: ip!, location }]);
      }
    });
    return count;
  };
  parse(current, null);
  for (const profile of profiles) {
    if (!profile.name.trim()) result.issues.push({ code: "metadata", message: "方案需要非空名称", blocking: true,
      location: { schemeId: profile.id, line: 0 }, related: [] });
    result.counts[profile.id] = parse(profile.content, profile);
  }
  if (scenario === "markers") result.issues.push({ code: "markers", message: "AhaTools 开始标记缺少对应的结束标记", blocking: true,
    location: { schemeId: null, line: 0 }, related: [] });
  return result;
}

Object.assign(window, { __AHATOOLS_HOSTS_MOCK__: {
  reset,
  setScenario(value: string) { scenario = value; },
  get state() { return { snapshot: snapshot(), calls, pinned }; },
  changeSystem(text: string) { current = text; ++version; },
  validationDelay(ms: number) { validationDelay = ms; },
} });

export function setHostsPinned(value: boolean) { pinned = value; }

export async function hostsMockInvoke(command: string, args: Record<string, unknown>) {
  if (command === "hosts_load") {
    if (scenario === "error") throw new Error("hosts.json 无法解析，原文件已保留：预览损坏数据");
    return snapshot();
  }
  if (command === "hosts_validate") {
    const result = validate(args.schemes as HostScheme[]);
    await wait(validationDelay);
    return result;
  }
  if (String(args.revision) !== String(version)) throw new Error("系统 hosts 或方案文件已被外部修改，请重新读取并检查后再应用");
  const restoring = command === "hosts_restore";
  const next = restoring ? schemes.map((s) => ({ ...s, enabled: false })) : clone(args.schemes as HostScheme[]);
  if (!restoring && validate(next).issues.some((issue) => issue.blocking)) throw new Error("无法应用：有未处理的错误");
  ++calls;
  await wait(scenario === "slow" ? 1200 : 150);
  const result: HostsOperation = { snapshot: null, systemWritten: false, profilesSaved: false, dnsFlushed: false, cancelled: false, error: null };
  if (scenario === "cancel") result.cancelled = true;
  else if (scenario === "external") {
    current += "# 其他工具添加的内容\n10.2.0.1 external.company.lan\n"; ++version;
    result.error = "授权期间系统 hosts 已被外部修改，未覆盖外部内容；请检查后重新应用";
  } else if (scenario === "write-error") result.error = "系统 hosts 操作失败：没有写入权限";
  else {
    original ??= current;
    current = merge(current, next); ++version;
    result.systemWritten = true;
    result.dnsFlushed = scenario !== "dns-error";
    result.profilesSaved = scenario !== "save-error";
    if (result.profilesSaved) schemes = next;
    if (!result.profilesSaved) result.error = "系统已写入，方案保存失败：没有写入权限";
    else if (!result.dnsFlushed) result.error = "已写入，DNS 刷新失败；可再次应用以重试刷新";
  }
  result.snapshot = snapshot();
  return result;
}
