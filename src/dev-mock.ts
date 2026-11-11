// Fake backend for previewing the UI in a plain browser (http://localhost:1420 while
// `tauri dev` runs). Only loaded in dev when the page isn't inside Tauri.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { Config, Manifest, RgbaImage, SearchItem, TranslateProfile, TranslateMode, TranslateDirection } from "./sdk";
import { EMPTY_SYSTEM, type BatteryInfo, type Reading, type SystemSnapshot } from "./sysmon";
import { generatePixels } from "../plugins/qrcode/qr";
import { imagePng } from "../plugins/qrcode/image";
import launcher from "../plugins/launcher/plugin.json";
import hotkeys from "../plugins/hotkeys/plugin.json";
import screenshot from "../plugins/screenshot/plugin.json";
import settings from "../plugins/settings/plugin.json";
import webapps from "../plugins/webapps/plugin.json";
import qrcode from "../plugins/qrcode/plugin.json";
import system from "../plugins/system/plugin.json";
import superpanel from "../plugins/superpanel/plugin.json";
import processes from "../plugins/processes/plugin.json";
import network from "../plugins/network/plugin.json";
import json from "../plugins/json/plugin.json";
import clipboardPlugin from "../plugins/clipboard/plugin.json";

import compress from "../plugins/compress/plugin.json";
import type { CompressionBatch, CompressionItem, ExportAction, ExportResult } from "../plugins/compress/model";
import hosts from "../plugins/hosts/plugin.json";
import { hostsMockInvoke, setHostsPinned } from "./hosts-mock";
import translate from "../plugins/translate/plugin.json";
import { isWord } from "../plugins/translate/core";

import imageTools from "../plugins/images/plugin.json";

const manifests: Manifest[] = [launcher, hotkeys, screenshot, webapps, qrcode, compress, imageTools, translate, hosts, system, processes, network, json, clipboardPlugin, superpanel, settings].map((m) => ({ searchProvider: false, ...m }));

type QrScenario = "url" | "text" | "empty" | "no-code" | "error";
const params = new URLSearchParams(location.search);
const compressionBatches: CompressionBatch[] = [];
const compressionCopies: string[][] = [];
const compressionExports: { batchId: string; action: string; itemIds: string[] }[] = [];
const compressionQueue: CompressionBatch[] = [];
let compressionWorking = false;
let compressionScenario = params.get("compressMock") ?? "empty";
const compressionFixtures = ["/预览/banner-home.png", "/预览/avatar@2x.png", "/预览/photo-0921.jpg", "/预览/最小 tiny.webp", "/预览/icon.svg", "/预览/broken.png"];
const mockImage = (path: string) => /\.(png|jpe?g|webp)$/i.test(path);
const expandMockPaths = (paths: string[]) => [...new Set(paths.flatMap((p) => p.endsWith("/图片") ? compressionFixtures.filter(mockImage) : [p]))];

function compressionStart(batchId: string, paths: string[], quality: number, toWebp: boolean): CompressionBatch {
  const existing = compressionBatches.find((b) => b.batchId === batchId);
  if (existing) return structuredClone(existing);
  if (compressionScenario === "error") throw new Error("无法创建压缩缓存：磁盘空间不足");
  const batch: CompressionBatch = {
    batchId, createdAt: Date.now(), quality, toWebp,
    items: expandMockPaths(paths).map((path, index): CompressionItem => ({
      itemId: String(index), path, name: path.split("/").pop() ?? "图片", before: mockImage(path) ? 2480000 + index * 100000 : 0, after: null,
      status: "waiting", version: 0, message: "等待中", outputName: null, canOverwrite: false,
    })),
  };
  compressionBatches.push(batch); compressionQueue.push(batch);
  setTimeout(() => void drainCompression(), 0);
  return structuredClone(batch);
}
async function drainCompression() {
  if (compressionWorking) return;
  compressionWorking = true;
  while (compressionQueue.length) {
    const batch = compressionQueue.shift()!;
    const names = new Set<string>();
    for (const item of batch.items) {
      item.status = "running"; item.message = "正在压缩…"; item.version++;
      await emit("compress-progress", { batchId: batch.batchId, ...item });
      await new Promise((r) => setTimeout(r, compressionScenario === "slow" ? 1200 : 100));
      item.status = !mockImage(item.path) || item.name.includes("animated") ? "skipped" : item.name.includes("broken") ? "failed" : item.name.includes("tiny") ? "unchanged" : "compressed";
      item.message = item.status === "skipped" ? "不支持此格式，已跳过" : item.status === "failed" ? "图片文件已损坏" : item.status === "unchanged" ? "已是最小，保留原图；拍摄信息未移除" : "已压缩，拍摄信息已移除";
      if (item.status === "compressed" || item.status === "unchanged") {
        item.after = item.status === "unchanged" ? item.before : Math.round(item.before * batch.quality / 250);
        const ext = item.status === "compressed" && batch.toWebp ? "webp" : item.name.split(".").pop()!;
        const stem = item.name.replace(/\.[^.]+$/, "");
        let name = `${stem}.${ext}`;
        for (let n = 2; names.has(name); n++) name = `${stem}.${n}.${ext}`;
        names.add(name); item.outputName = name;
        item.canOverwrite = item.status === "compressed" && (!batch.toWebp || /\.webp$/i.test(item.name));
      }
      item.version++;
      await emit("compress-progress", { batchId: batch.batchId, ...item });
    }
  }
  compressionWorking = false;
}
let scenario = (params.get("qrMock") ?? "url") as QrScenario;
let clipboardPixels: RgbaImage | undefined;
let clipboardText = "";
let clipboardFiles: string[] = [];
let clipboardReadDelay = 0;
let clipboardReads = 0;
let pinWrites = 0;
let nextImage = 1;
const images = new Map<number, RgbaImage>();
const savedImages: { path: string; bytes: number[] }[] = [];
const listeners = new Map<number, string>();
const cloneImage = (image: RgbaImage): RgbaImage => ({ ...image, rgba: image.rgba.slice() });
const fixtureImage = () => scenario === "no-code"
  ? { width: 200, height: 200, rgba: new Uint8ClampedArray(200 * 200 * 4).fill(255) }
  : generatePixels(scenario === "text" ? "你好，AhaTools！\n二维码测试" : "https://github.com/PYPARA/Aha-tools", "M");

// Preview-only controls for repeatable browser checks; not included in production.
Object.assign(window, {
  __AHATOOLS_COMPRESS_MOCK__: {
    drop(paths = compressionFixtures) { return emit("tauri://drag-drop", { paths, position: { x: 100, y: 100 } }); },
    get batches() { return structuredClone(compressionBatches); },
    get copied() { return compressionCopies; },
    get exports() { return compressionExports; },
    setScenario(value: string) { compressionScenario = value; },
    get listenerCount() { return [...listeners.values()].filter((e) => e === "compress-progress").length; },
  },
  __AHATOOLS_QR_MOCK__: {
    setClipboard(value: QrScenario) { scenario = value; clipboardPixels = undefined; clipboardFiles = []; },
    setFiles(paths: string[]) { clipboardFiles = paths; },
    setReadDelay(milliseconds: number) { clipboardReadDelay = milliseconds; },
    get text() { return clipboardText; },
    get activeImages() { return images.size; },
    get clipboardReads() { return clipboardReads; },
    get saved() { return savedImages; },
    get pinned() { return usage.pinned.map((item) => item.title); },
    get pinWrites() { return pinWrites; },
    drop(paths: string[]) { return emit("tauri://drag-drop", { paths, position: { x: 100, y: 100 } }); },
    showPanel() { return showMockPanel(); },
  },
  __AHATOOLS_PANEL_MOCK__: {
    get config() { return config; },
    get large() { return panelLarge; },
    hide() { hideMockPanel(); },
    show() { return showMockPanel(); },
    reopen(hiddenForMs = 0) {
      hideMockPanel();
      panelHiddenAt = performance.now() - hiddenForMs;
      return showMockPanel();
    },
    openFeature(plugin: string, feature: string, input?: string) {
      return showMockPanel({ plugin, feature, input });
    },
    /** Another app copies: text, a list of file paths, or "image". */
    copy(value: string | string[]) {
      if (Array.isArray(value)) { clipboardFiles = value; clipboardText = value.map((p) => p.split("/").pop()).join("\n"); }
      else if (value === "image") { clipboardPixels = fixtureImage(); clipboardFiles = []; scenario = "url"; }
      else { clipboardText = value; clipboardFiles = []; clipboardPixels = undefined; }
      mockCopy = { changeCount: ++copyCount, at: performance.now(), kind: Array.isArray(value) ? "files" : value === "image" ? "image" : "text" };
    },
  },
});

const apps = [
  { title: "微信", subtitle: "WeChat · /Applications/WeChat.app", kind: "app", path: "/Applications/WeChat.app" },
  { title: "企业微信", subtitle: "WeCom · /Applications/WeCom.app", kind: "app", path: "/Applications/WeCom.app" },
  { title: "天气", subtitle: "Weather · /System/Applications/Weather.app", kind: "app", path: "/System/Applications/Weather.app" },
  { title: "web-projects", subtitle: "~/Projects/web", kind: "saved", icon: "folder", path: "~/Projects/web" },
];

let saved = [
  { name: "Projects", path: "~/Projects", kind: "folder" },
  { name: "hosts", path: "/etc/hosts", kind: "file" },
  { name: "设计稿", path: "~/Documents/Design", kind: "folder" },
  { name: "GitHub", path: "https://github.com", kind: "link" },
];

let exclusive = true;

const feature = (plugin: string, code: string, title: string, subtitle: string): SearchItem => ({
  title, subtitle, score: 0, plugin, kind: "feature", action: { type: "feature", feature: code },
});
const app = (title: string, path: string): SearchItem => ({
  title, subtitle: path, score: 0, plugin: "launcher", kind: "app", action: { type: "openPath", path },
});
const usage = {
  recent: [
    app("微信", "/Applications/WeChat.app"),
    feature("screenshot", "take", "截图", "截图"),
    app("访达", "/System/Library/CoreServices/Finder.app"),
    feature("qrcode", "generate", "生成二维码", "二维码"),
    feature("qrcode", "scan", "识别二维码", "二维码"),
    feature("hotkeys", "probe", "检测热键占用", "热键检测"),
    feature("launcher", "manage", "管理收藏的路径", "快捷启动"),
    feature("webapps", "manage", "管理网页应用", "网页应用"),
    app("Cursor", "/Applications/Cursor.app"),
    app("系统设置", "/System/Applications/System Settings.app"),
    app("备忘录", "/System/Applications/Notes.app"),
  ],
  pinned: [app("Ghostty", "/Applications/Ghostty.app"), app("微信", "/Applications/WeChat.app"), feature("screenshot", "take", "截图", "截图"),
    feature("qrcode", "generate", "生成二维码", "二维码"), feature("qrcode", "scan", "识别二维码", "二维码"),
    feature("hotkeys", "probe", "检测热键占用", "热键检测"), feature("launcher", "manage", "管理收藏的路径", "快捷启动"),
    feature("webapps", "manage", "管理网页应用", "网页应用"), feature("images", "save", "保存图片为 PNG", "图片工具")],
};
try { usage.pinned = JSON.parse(localStorage.getItem("ahatools.mock.pinned") ?? "null") ?? usage.pinned; } catch { /* Preview data can be reset by clearing localStorage. */ }
if (params.get("pinsMock") === "many") {
  usage.pinned = Array.from({ length: 35 }, (_, i): SearchItem => ({
    title: `项目 ${i + 1}`, subtitle: `/预览/项目 ${i + 1}`, score: 0, plugin: "launcher", kind: "saved", icon: "folder",
    action: { type: "openPath", path: `/预览/项目 ${i + 1}` },
  }));
}
if (params.get("pinsMock") === "only") usage.recent = [];

function homeItem(item: SearchItem): SearchItem {
  if (item.action.type !== "feature") return { ...item, score: 0 };
  const action = item.action;
  const manifest = manifests.find((m) => m.id === item.plugin);
  return {
    ...item, score: 0,
    title: manifest?.features.find((f) => f.code === action.feature)?.explain ?? item.title,
    subtitle: manifest?.name ?? item.subtitle.split(" · ")[0],
    action: { type: "feature", feature: action.feature },
  };
}

const sameItem = (a: SearchItem, b: SearchItem) => a.plugin === b.plugin && JSON.stringify(a.action) === JSON.stringify(b.action);

let config: Config = {
  hotkeys: [
    { accelerator: "Alt+Shift+Space", action: { type: "superPanel" }, enabled: true },
    { accelerator: "Alt+Space", action: { type: "togglePanel" }, enabled: true },
    { accelerator: "Shift+Super+KeyA", action: { type: "screenshot" }, enabled: true },
    { accelerator: "Control+Space", action: { type: "forward", app: "utools" }, enabled: false },
  ],
  superPanel: {
    longPressRight: false,
    pinned: [feature("screenshot", "take", "截图", "截图"), feature("qrcode", "generate", "生成二维码", "二维码"), feature("system", "colorpicker", "取色", "系统动作"), feature("system", "ocr", "截图识字", "系统动作"),
      { title: "DeepSeek", subtitle: "网页应用", score: 0, plugin: "webapps", kind: "feature", icon: "https://chat.deepseek.com", action: { type: "openWeb", id: "deepseek" } } as SearchItem,
      feature("system", "desktop", "显示桌面", "系统动作"), feature("system", "lock", "锁屏", "系统动作")],
    actions: [
      { id: "vscode", name: "用 VS Code 打开", command: "code {path}", when: ["file", "folder", "image"], enabled: false },
      { id: "claude-code", name: "用 Claude Code 打开", command: "/usr/bin/osascript -e 'on run argv' -e 'tell application \"Terminal\" to do script (\"cd \" & quoted form of (item 1 of argv) & \" && claude\")' -e 'end run' {dir}", when: ["folder"], enabled: false },
    ],
  },
  menubar: ["netspeed"],
  exclusiveHotkeys: true,
  pinyin: true,
  appearance: "system",
  panelReopen: "resume",
  clipboardAutoPaste: 5,
  webSearch: "https://www.google.com/search?q={q}",
  publicIpUrl: "https://api.ipify.org",
  clipboardHistory: { enabled: params.get("clipMock") !== "off", maxItems: 500, maxDays: 30, excludedApps: ["com.1password.1password", "com.apple.Passwords"] },
  disabledMatches: [] as string[],
  translate: {
    profiles: params.get("translateMock") && params.get("translateMock") !== "empty" ? [
      { id: "work", name: "工作配置", protocol: "openai-chat", baseUrl: "https://gateway.example/v1", model: "custom-chat",
        ...(params.get("translateMock") === "extra-body" ? { extraBody: { thinking: { type: "disabled" } } } : {}) },
      { id: "backup", name: "备用配置", protocol: "openai-responses", baseUrl: "https://backup.example/api", model: "custom-response" },
      { id: "messages", name: "Messages 配置", protocol: "anthropic-messages", baseUrl: "http://localhost:9876/v1", model: "custom-messages" },
    ] : [],
    activeProfileId: params.get("translateMock") && params.get("translateMock") !== "empty" ? "work" : null,
    direction: "auto",
  },
  webApps: [{ id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com", keywords: ["ds"] }],
  screenshot: { target: "wechat", systemMode: "region" },
  relayApps: [
    { id: "wechat", name: "微信", bundleId: "com.tencent.xinWeChat", accelerator: "Control+Super+Digit1", screenshot: true, ready: false },
    { id: "qq", name: "QQ", bundleId: "com.tencent.qq", accelerator: "Control+Super+Digit2", screenshot: true, ready: false },
    { id: "dingtalk", name: "钉钉", bundleId: "com.alibaba.DingTalkMac", accelerator: "Control+Super+Digit3", screenshot: true, ready: false },
    { id: "utools", name: "uTools", bundleId: "org.yuanli.utools", accelerator: "Control+Super+Digit0", screenshot: false, ready: false },
  ],
};

// ?selectMock=many supplies long profile / model lists for the shared picker checks.
if (params.get("selectMock") === "many") {
  config.translate.profiles.push(...Array.from({ length: 24 }, (_, index) => ({
    id: `preview-${index + 1}`, name: `预览配置 ${String(index + 1).padStart(2, "0")}`,
    protocol: "openai-chat" as const, baseUrl: "https://gateway.example/v1", model: `preview-model-${index + 1}`,
  })));
  config.translate.activeProfileId ??= "preview-1";
}

if (params.get("pins") === "12") config.superPanel.pinned.push(...["微信", "访达", "备忘录", "系统设置", "Ghostty"].map((name, i) => app(name, `/Applications/mock-${i}.app`)));
let superScenario = params.get("superMock") ?? "home";
let superRequest = 1;
let superConsumed = false;
let pendingRequest: Record<string, unknown> | null = null;
let requestId = 0;
const executed: string[] = [];
let ocrId = 1;
function makeOcr(id: string, phase = params.get("ocrMock") ?? "success") {
  return { id, phase, text: phase === "success" ? "AhaTools 让常用工具触手可及。\nBuild something useful.\n\n截图识字全程在本机完成。" : "", copied: phase === "success", message: ({ success: "已复制识别文字", loading: "正在本机识别…", empty: "没有识别到文字，请选择清晰的文字区域", cancelled: "已取消截图，剪贴板内容保留", error: "无法截取屏幕，请允许 AhaTools 使用屏幕录制权限" } as Record<string, string>)[phase] ?? "请选择要识别的区域" };
}
let ocrJob = makeOcr("1");
function navigate(plugin: string, feature: string, input?: string, viewOnly = false) {
  pendingRequest = { id: ++requestId, plugin, feature, input, viewOnly };
  void emit("open-feature", pendingRequest);
}
function navigateQuery(query: string) {
  pendingRequest = { id: ++requestId, plugin: "", feature: "", query };
  void emit("panel-query", pendingRequest);
}
const clipNow = Math.floor(Date.now() / 1000);
let clipEntries = [
  { id: "c1", kind: "text", text: "https://github.com/tauri-apps/tauri/releases", paths: [], image: null, app: "Safari", at: clipNow - 40, pinned: false, truncated: false },
  { id: "c2", kind: "image", text: "", paths: [], image: { file: "c2.png", width: 1280, height: 720 }, app: "截图", at: clipNow - 600, pinned: false, truncated: false },
  { id: "c3", kind: "text", text: "ssh deploy@10.0.3.21 -p 2222", paths: [], image: null, app: "终端", at: clipNow - 3600 * 5, pinned: true, truncated: false },
  { id: "c4", kind: "files", text: "", paths: ["/Users/me/Documents/设计稿/首页.png", "/Users/me/Documents/设计稿/设置.png"], image: null, app: "访达", at: clipNow - 86400, pinned: false, truncated: false },
  { id: "c5", kind: "text", text: Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行：AhaTools 会记下复制过的长文本，列表只显示开头，右侧预览完整内容。`).join("\n"), paths: [], image: null, app: "备忘录", at: clipNow - 86400 * 3, pinned: false, truncated: false },
];
/** A small generated picture for the clipboard image preview. */
function qrMockImageUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#3A5A8C"/><circle cx="90" cy="90" r="46" fill="#93B1E3"/><rect x="160" y="54" width="120" height="72" rx="10" fill="#EDEAE2"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
const mockAddresses = [
  { interface: "en0", label: "Wi-Fi", ip: "192.168.1.23", v6: false },
  { interface: "en0", label: "Wi-Fi", ip: "2408:8207:6c40:1d0::a1", v6: true },
  { interface: "utun4", label: "VPN", ip: "198.18.0.1", v6: false },
];
const pings = new Map<string, ReturnType<typeof setTimeout>>();
function finishPing(id: string, host: string, sent: number, received: number) {
  pings.delete(id);
  void emit("network-ping", { id, line: `--- ${host} ping statistics ---` });
  void emit("network-ping", { id, line: `${sent} packets transmitted, ${received} packets received, ${(100 - received / sent * 100).toFixed(1)}% packet loss` });
  void emit("network-ping", { id, line: "round-trip min/avg/max/stddev = 29.461/38.204/46.913/6.012 ms" });
  void emit("network-ping-done", { id, ok: received > 0 });
}
/** A rough copy of detect.rs for the preview: which kinds of text this is. */
function mockKinds(text: string): string[] {
  const t = text.trim();
  const kinds: string[] = [];
  if (/^[[{]/.test(t)) { try { const v = JSON.parse(t); if (v && typeof v === "object") kinds.push("json"); } catch { /* not JSON */ } }
  if (/\s/.test(t)) return kinds;
  if (/^https?:\/\/[^/\s]+/.test(t)) kinds.push("url");
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(t) || /^[0-9a-f:]+:[0-9a-f:]*$/i.test(t)) kinds.push("ip");
  else if (/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(t) && !/\.(md|json|txt|js|ts|png|jpg|pdf|zip|html|css)$/i.test(t)) kinds.push("domain");
  if (/^:?\d{2,5}$/.test(t) && Number(t.replace(":", "")) <= 65535) kinds.push("port");
  if (/^(\/|~\/)/.test(t)) kinds.push("path");
  return kinds;
}
const quitPids: number[] = [];
/** 进程管理: a few apps with helpers, a system process and a lone CLI tool. */
function mockProcesses(scenario: string) {
  const GB = 1024 ** 3, MB = 1024 ** 2;
  const busy = scenario === "busy";
  const row = (pid: number, name: string, path: string, cpu: number, memory: number, mine = true, isProtected = false) => ({ pid, name, path, cpu, memory, mine, protected: isProtected });
  const app = (bundle: string, name: string, rows: ReturnType<typeof row>[]) => ({ id: bundle, name, bundle, cpu: rows.reduce((s, r) => s + r.cpu, 0), memory: rows.reduce((s, r) => s + r.memory, 0), mine: rows.every((r) => r.mine), protected: rows.some((r) => r.protected), processes: rows });
  const alone = (r: ReturnType<typeof row>) => ({ id: `pid:${r.pid}`, name: r.name, bundle: null, cpu: r.cpu, memory: r.memory, mine: r.mine, protected: r.protected, processes: [r] });
  const chrome = "/Applications/Google Chrome.app";
  const groups = scenario === "empty" ? [] : [
    app(chrome, "Google Chrome", [
      row(30978, "Google Chrome Helper (Renderer)", `${chrome}/Contents/Frameworks/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)`, busy ? 186.4 : 21.2, 820 * MB),
      row(1364, "Google Chrome", `${chrome}/Contents/MacOS/Google Chrome`, busy ? 14.8 : 4.1, 410 * MB),
      row(3817, "Google Chrome Helper (GPU)", `${chrome}/Contents/Frameworks/Google Chrome Helper (GPU).app/Contents/MacOS/Google Chrome Helper (GPU)`, 2.3, 300 * MB),
    ]),
    alone(row(650, "WindowServer", "/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer", 32.5, 118 * MB, false, true)),
    app("/Applications/WeChat.app", "微信", [row(2201, "WeChat", "/Applications/WeChat.app/Contents/MacOS/WeChat", 6.1, 1.4 * GB)]),
    app("/Applications/Visual Studio Code.app", "Visual Studio Code", [
      row(4100, "Code Helper (Plugin)", "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)", 3.1, 1.2 * GB),
      row(4000, "Electron", "/Applications/Visual Studio Code.app/Contents/MacOS/Electron", 0.7, 700 * MB),
    ]),
    alone(row(4242, "node", "/opt/homebrew/bin/node", 2.2, 240 * MB)),
    alone(row(970, "mds_stores", "/System/Library/Frameworks/CoreServices.framework/Support/mds_stores", 1.7, 420 * MB, false)),
  ];
  const live = groups.map((g) => ({ ...g, processes: g.processes.filter((p) => !quitPids.includes(p.pid)) })).filter((g) => g.processes.length);
  return { groups: live, count: 412 - quitPids.length, cores: 10, memory: { usedBytes: 12.4 * GB, totalBytes: 16 * GB, pressure: busy ? "warning" : "normal" } };
}
function superState() {
  const paths = superScenario === "folder" ? ["/Users/me/Documents/设计稿"] : superScenario === "image" ? ["/Users/me/Documents/二维码.png"] : superScenario === "multi" ? ["/Users/me/Documents/图.png", "/Users/me/Documents/备注.txt"] : superScenario === "file" ? ["/Users/me/Documents/说明.txt"] : [];
  const text = superScenario === "url" ? "https://example.com" : superScenario === "text" ? "Tauri lets you build smaller, faster, and more secure desktop applications with a web frontend." : undefined;
  const context = { kind: paths.length ? "files" : text ? "text" : "none", appName: paths.length ? "访达" : "Safari", paths, text, notice: superScenario === "permission" ? "无法读取访达。请在系统设置 → 隐私与安全性 → 自动化中允许 AhaTools 控制访达" : undefined };
  const row = (id: string, group: string, title: string, subtitle: string, plugin = "", feature = "", icon = "", item?: SearchItem) => ({ id, group, title, subtitle, plugin, feature, icon, item });
  const featureItem = (plugin: string, code: string, title: string): SearchItem => ({ title, subtitle: "", score: 0, plugin, kind: "feature", action: { type: "feature", feature: code } });
  const images = superScenario === "folder" ? 13 : paths.filter((p) => /\.(png|jpe?g|webp)$/i.test(p)).length;
  const kinds = paths.map((p) => /\.(png|jpe?g|webp)$/i.test(p) ? "image" : /\.[^/]+$/.test(p) ? "file" : "folder");
  const custom = config.superPanel.actions.filter((x) => x.enabled && (text ? x.when.includes("text") : paths.length > 0 && kinds.every((k) => x.when.includes(k) || (k === "image" && x.when.includes("file")))))
    .map((x) => row(`custom:${x.id}`, "custom", x.name, "", "", "", "command"));
  const actions = paths.length ? [
    ...(images ? [row("match:0", "match", "压缩图片", `${images} 张`, "compress", "compress", "", featureItem("compress", "compress", "压缩图片"))] : []),
    ...(superScenario === "image" ? [row("match:1", "match", "识别二维码", "", "qrcode", "scan", "", featureItem("qrcode", "scan", "识别二维码"))] : []),
    row("copy", "files", "复制路径", paths.length > 1 ? `${paths.length} 项` : "", "", "", "copy"),
    row("copy-name", "files", "复制文件名", paths.length > 1 ? `${paths.length} 项` : "", "", "", "copy"), row("terminal", "files", "在终端中打开", "", "", "", "terminal"),
    ...(superScenario === "folder" ? [row("new", "files", "新建空白文件", "未命名.txt", "", "", "newfile")] : []), row("save", "files", "收藏到快捷启动", "", "", "", "star"), ...custom,
  ] : text ? [
    ...(Array.from(text).length >= 2 ? [row("match:0", "match", "翻译", "点按后翻译", "translate", "translate", "", featureItem("translate", "translate", "翻译"))] : []),
    row("match:1", "match", "生成二维码", "", "qrcode", "generate", "", featureItem("qrcode", "generate", "生成二维码")),
    ...config.webApps.map((w) => row(`ask:${w.id}`, "match", `问 ${w.name}`, "复制后打开", "webapps", "", "", { title: w.name, subtitle: w.url, score: 0, plugin: "webapps", kind: "feature", icon: w.url, action: { type: "openWeb", id: w.id } } as SearchItem)),
    ...(superScenario === "url" ? [row("url", "match", "在浏览器中打开", "", "", "", "globe")] : []),
    row("search", "text", "在搜索面板中打开", "", "", "", "search"), row("copy", "text", "复制为纯文本", "", "", "", "copy"), ...custom,
  ] : [];
  const pinned = config.superPanel.pinned.map((item, i) => row(`pin:${i}`, "pin", item.title, item.subtitle, item.plugin, item.action.type === "feature" ? item.action.feature : "", "", item));
  return { requestId: superRequest, context, actions, pinned };
}
Object.assign(window, { __AHATOOLS_SUPER_MOCK__: {
  setScenario(value: string) { superScenario = value; superConsumed = false; superRequest++; return emit("superpanel-shown", superState()); },
  get executed() { return executed; }, get pending() { return pendingRequest; }, get text() { return clipboardText; },
  openFeature(plugin: string, feature: string, input?: string, viewOnly = false) { navigate(plugin, feature, input, viewOnly); },
  openQuery(query: string) { navigateQuery(query); },
  setOcr(phase: string) { ocrJob = makeOcr(String(++ocrId), phase); navigate("system", "ocr", ocrJob.id, true); return emit("system-ocr-updated", ocrJob); },
} });
if (params.get("page") === "settings") pendingRequest = { id: ++requestId, plugin: "settings", feature: "general", input: "superpanel" };
if (params.has("ocrMock")) pendingRequest = { id: ++requestId, plugin: "system", feature: "ocr", input: "1", viewOnly: true };
// ?open=<plugin>/<feature>[&input=…]: open a feature page directly (README screenshots, quick checks).
if (params.get("open")) { const [plugin, feature] = params.get("open")!.split("/"); pendingRequest = { id: ++requestId, plugin, feature, input: params.get("input") ?? undefined }; }
type SystemScenario = "normal" | "pressure" | "low-battery" | "no-battery" | "partial-error" | "sampling" | "charged" | "not-charging" | "no-estimate";
let systemScenario = (params.get("sysmonMock") ?? "normal") as SystemScenario;
let systemSequence = 0;
let menuVisible = true;
const menuResizeRequests: number[] = [];
let mockAutostart = false;
const systemActions: string[] = [];

function systemSnapshot(): SystemSnapshot {
  const sequence = ++systemSequence;
  if (systemScenario === "sampling") return { ...EMPTY_SYSTEM, sequence };
  const sampledAt = Date.now();
  const available = <T,>(data: T): Reading<T> => ({ state: "available", data, sampledAt });
  const battery: BatteryInfo = systemScenario === "no-battery" ? { status: "absent" } : {
    status: "present", percent: systemScenario === "low-battery" ? 12 : systemScenario === "charged" ? 100 : 86,
    state: systemScenario === "low-battery" ? "discharging" : systemScenario === "charged" ? "charged" : systemScenario === "not-charging" ? "notCharging" : "charging",
    remainingMinutes: systemScenario === "low-battery" ? 35 : ["no-estimate", "not-charging", "charged"].includes(systemScenario) ? null : 25,
  };
  return {
    sequence,
    cpu: {
      usage: available(23),
      history: Array.from({ length: 60 }, (_, i) => ({ timestamp: sampledAt - (59 - i) * 1000, percent: 23 + Math.sin(i / 4) * 14 })),
      busiest: systemScenario === "partial-error" ? { state: "unavailable" } : available({ name: "Visual Studio Code Helper (Renderer)", percent: 112 }),
    },
    memory: available({ usedBytes: (systemScenario === "pressure" ? 15.2 : 11.2) * 1024 ** 3, totalBytes: 16 * 1024 ** 3, pressure: systemScenario === "pressure" ? "critical" : systemScenario === "partial-error" ? "unknown" : "normal" }),
    battery: systemScenario === "partial-error" ? { state: "unavailable" } : available(battery),
    disk: systemScenario === "partial-error" ? { state: "unavailable" } : available({ availableBytes: 212 * 1024 ** 3, totalBytes: 494 * 1024 ** 3 }),
  };
}

Object.assign(window, {
  __AHATOOLS_SYSMON_MOCK__: {
    async scenario(value: SystemScenario) { systemScenario = value; if (menuVisible) await emit("sysmon", systemSnapshot()); },
    async show() { menuVisible = true; await emit("menu-shown"); },
    async hide() { menuVisible = false; await emit("menu-hidden"); },
    get visible() { return menuVisible; },
    get contentHeight() { return menuResizeRequests[menuResizeRequests.length - 1] ?? null; },
    get resizes() { return [...menuResizeRequests]; },
    get actions() { return systemActions; },
    get config() { return structuredClone(config); },
    get listeners() { return [...listeners.values()]; },
  },
});
if (params.get("view") === "menu") {
  const timer = window.setInterval(() => { if (menuVisible) void emit("sysmon", systemSnapshot()); }, 1000);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
}

mockWindows(params.get("view") === "menu" ? "menu" : params.get("view") === "super" ? "super" : "panel");
let panelVisible = true;
let panelLarge = false;
let panelHiddenAt: number | null = null;
function hideMockPanel() {
  if (panelVisible) { panelVisible = false; panelHiddenAt = performance.now(); }
}
let copyCount = 0;
let mockCopy: { changeCount: number; at: number; kind: "text" | "image" | "files" } | null = null;
async function showMockPanel(target?: { plugin: string; feature: string; input?: string }) {
  const age = mockCopy ? performance.now() - mockCopy.at : Infinity;
  const clipboard = !target && mockCopy && age <= config.clipboardAutoPaste * 1000 ? { changeCount: mockCopy.changeCount, ageMs: Math.round(age), kind: mockCopy.kind } : null;
  const reset = !panelVisible && !target && (config.panelReopen === "search"
    || (config.panelReopen === "afterFiveMinutes" && panelHiddenAt !== null && performance.now() - panelHiddenAt > 300_000));
  panelVisible = true;
  panelHiddenAt = null;
  if (reset) panelLarge = false;
  await emit("panel-shown", { reset, clipboard });
  if (target) await emit("open-feature", target);
}

const translationKeys = new Set(params.get("translateMock") === "missing-key" ? [] : ["work", "backup", "messages"]);
if (params.get("selectMock") === "many") config.translate.profiles.forEach((profile) => translationKeys.add(profile.id));
const translationJobs = new Map<string, ReturnType<typeof setTimeout>>();
const translationCalls: { id: string; profileId: string; text: string; mode: string; direction: string }[] = [];
let translationStops = 0;
let panelPinned = false;
Object.assign(window, { __AHATOOLS_TRANSLATE_MOCK__: {
  get calls() { return translationCalls; }, get jobs() { return translationJobs.size; },
  get stops() { return translationStops; },
  get listeners() { return Array.from(listeners.values()).filter((name) => name.startsWith("translate-")).length; }, get pinned() { return panelPinned; },
  setScenario(value: string) { params.set("translateMock", value); },
  get config() { return structuredClone(config.translate); },
  keyPresent(id: string) { return translationKeys.has(id); },
} });

mockIPC((cmd, args) => {
  const a = (args ?? {}) as Record<string, unknown>;
  if (cmd.startsWith("hosts_")) return hostsMockInvoke(cmd, a);
  switch (cmd) {
    // The installed event API unlistens with eventId; mockIPC's built-in event
    // helper still expects id. Keep listener cleanup accurate in StrictMode.
    case "plugin:event|listen":
      listeners.set(Number(a.handler), String(a.event));
      return Number(a.handler);
    case "plugin:event|unlisten":
      listeners.delete(Number(a.eventId));
      return null;
    case "plugin:event|emit": {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, value: unknown) => void } }).__TAURI_INTERNALS__;
      for (const [id, event] of listeners) {
        if (event === a.event) internals.runCallback(id, { event, id, payload: a.payload });
      }
      return null;
    }
    case "set_panel_pinned": panelPinned = Boolean(a.pinned); setHostsPinned(panelPinned); return null;
    case "translate_select":
      if (a.profileId) config.translate.activeProfileId = String(a.profileId);
      if (a.direction) config.translate.direction = a.direction as TranslateDirection;
      queueMicrotask(() => void emit("config-changed", config)); return config;
    case "translate_has_key":
      if (params.get("translateMock") === "key-error") throw new Error("无法读取本地密钥文件，请检查 AhaTools 数据目录的权限");
      return translationKeys.has(String(a.profileId));
    case "translate_save_profile": {
      if (params.get("translateMock") === "save-error") throw new Error("配置保存失败，原配置已保留");
      const profile = a.profile as TranslateProfile;
      const old = config.translate.profiles.find((p) => p.id === profile.id);
      if ((!old || old.baseUrl !== profile.baseUrl || old.protocol !== profile.protocol) && !a.key) throw new Error("请重新填写 API Key");
      config.translate.profiles = old ? config.translate.profiles.map((p) => p.id === profile.id ? profile : p) : [...config.translate.profiles, profile];
      if (a.key) translationKeys.add(profile.id);
      config.translate.activeProfileId ??= profile.id;
      queueMicrotask(() => void emit("config-changed", config));
      return config;
    }
    case "translate_delete_profile": {
      const id = String(a.profileId);
      config.translate.profiles = config.translate.profiles.filter((p) => p.id !== id); translationKeys.delete(id);
      if (config.translate.activeProfileId === id) config.translate.activeProfileId = config.translate.profiles[0]?.id ?? null;
      queueMicrotask(() => void emit("config-changed", config)); return config;
    }
    case "translate_list_models":
      if (params.get("translateMock") === "model-slow") return new Promise((resolve) => setTimeout(() => resolve([{ id:"stale-model", name:"过期模型" }]), 600));
      if (params.get("translateMock") === "model-error") throw new Error("HTTP 404：此服务不提供模型列表");
      if (params.get("selectMock") === "many") return Array.from({ length: 80 }, (_, index) => ({ id: `preview-model-${String(index + 1).padStart(2, "0")}`, name: `预览模型 ${index + 1}` }));
      return [{ id: "custom-model-a", name: "自定义模型 A" }, { id: "custom-model-b", name: "自定义模型 B" }];
    case "translate_test_connection":
      if (params.get("translateMock") === "test-slow") return new Promise((resolve) => setTimeout(() => resolve({ firstTokenMs:999 }), 600));
      if (params.get("translateMock") === "error") throw new Error("HTTP 401：密钥无效");
      return { firstTokenMs: 420 };
    case "translate_stop": {
      const id = String(a.id); const timer = translationJobs.get(id);
      if (timer) { clearTimeout(timer); translationJobs.delete(id); translationStops++; void emit("translate-done", { id, reason: "stopped", word: false }); }
      return null;
    }
    case "translate_start": {
      const id = String(a.id); const text = String(a.text);
      const profileId = String(a.profileId);
      if (!translationKeys.has(profileId)) throw new Error("请先设置这套配置的 API Key");
      const mode = a.mode as TranslateMode; const direction = a.direction as TranslateDirection;
      translationCalls.push({ id, profileId, text, mode, direction });
      const word = isWord(text, mode, direction);
      // Same line format the native prompt asks for, so senses render while streaming.
      const output = word ? params.get("translateMock") === "invalid-word" ? "机缘巧合；意外的美好发现" : [
        "/ˌserənˈdɪpəti/", "名词|机缘巧合；意外发现美好事物的运气|指没有刻意寻找时，偶然发现有价值的事物。",
        "> Finding that café was pure serendipity.|找到那家咖啡馆纯属机缘巧合。", "> Many discoveries happen by serendipity.|许多发现都源于偶然。", "= chance, fortune, luck",
      ].join("\n") : mode === "polish" ? "Tauri helps you build small, fast desktop applications with a web frontend." : mode === "explain" ? "这段文字介绍了 Tauri：它使用 Rust 处理核心逻辑，并用系统自带的网页视图呈现界面。" : direction === "zh-en" || direction === "auto" && /\p{Script=Han}/u.test(text) ? "AhaTools makes everyday work easier. It is a lightweight toolbox for macOS." : "Tauri 让你用网页前端构建更小、更快的桌面应用。核心使用 Rust，界面运行在系统自带的网页视图中，让应用保持轻量。";
      const chars = Array.from(output); let n = 0;
      const tick = () => {
        if (params.get("translateMock") === "error" && n >= 8) { translationJobs.delete(id); void emit("translate-error", { id, message: "HTTP 503：服务暂时不可用" }); return; }
        if (n >= chars.length) { translationJobs.delete(id); void emit("translate-done", { id, reason:"completed", word }); return; }
        void emit("translate-chunk", { id, delta: chars.slice(n, n += 8).join("") });
        translationJobs.set(id, setTimeout(tick, params.get("translateMock") === "slow" ? 250 : 20));
      };
      translationJobs.set(id, setTimeout(tick, 60)); return null;
    }
    case "list_plugins":
      return manifests;
    case "clipboard_history_list":
      return params.get("clipMock") === "empty" || params.get("clipMock") === "off" ? [] : clipEntries.map((e) => e.text.length > 400 ? { ...e, text: e.text.slice(0, 400), truncated: true } : e);
    case "clipboard_history_get": return clipEntries.find((e) => e.id === a.id) ?? null;
    case "clipboard_history_image": return clipEntries.some((e) => e.id === a.id && e.kind === "image") ? qrMockImageUrl() : null;
    case "clipboard_history_use": {
      const entry = clipEntries.find((e) => e.id === a.id);
      if (!entry) throw new Error("这条记录已删除");
      clipboardText = entry.kind === "text" ? entry.text : entry.paths.join("\n");
      clipEntries = [{ ...entry, at: Math.floor(Date.now() / 1000) }, ...clipEntries.filter((e) => e !== entry)];
      executed.push(`clipboard:${a.paste ? "paste" : "copy"}:${entry.id}`);
      return a.paste ? "已粘贴" : "已复制";
    }
    case "clipboard_history_pin": clipEntries = clipEntries.map((e) => e.id === a.id ? { ...e, pinned: Boolean(a.pinned) } : e); return null;
    case "clipboard_history_delete": clipEntries = clipEntries.filter((e) => e.id !== a.id); return null;
    case "clipboard_history_clear": clipEntries = clipEntries.filter((e) => e.pinned && !a.pinnedToo); return null;
    case "network_local":
      if (params.get("netMock") === "offline") return { addresses: [], gateway: null, gatewayInterface: null };
      return { addresses: mockAddresses, gateway: "192.168.1.1", gatewayInterface: "en0" };
    case "network_public_ip":
      if (params.get("netMock") === "error") throw new Error("查询公网 IP 失败：连接超时（预览错误）");
      return new Promise((resolve) => setTimeout(() => resolve("203.0.113.42"), 400));
    case "network_ping_start": {
      const id = String(a.id); const host = String(a.host).trim().replace(/^https?:\/\//, "").split(/[/:]/)[0];
      if (!/^[\w.-]+$/.test(host) || host.startsWith("-")) throw new Error("请输入域名或 IP 地址，例如 github.com 或 1.1.1.1");
      const lossy = params.get("netMock") === "lossy";
      const lines = [`PING ${host} (140.82.112.3): 56 data bytes`, ...Array.from({ length: 10 }, (_, i) => lossy && i % 3 === 1
        ? `Request timeout for icmp_seq ${i}` : `64 bytes from 140.82.112.3: icmp_seq=${i} ttl=52 time=${(38 + Math.sin(i) * 9).toFixed(3)} ms`)];
      let n = 0;
      const tick = () => {
        if (!pings.has(id)) return;
        if (n < lines.length) { void emit("network-ping", { id, line: lines[n++] }); pings.set(id, setTimeout(tick, 120)); return; }
        finishPing(id, host, lines.length - 1, lossy ? 7 : 10);
      };
      pings.set(id, setTimeout(tick, 80));
      return host;
    }
    case "network_ping_stop": {
      const id = String(a.id);
      if (pings.has(id)) { clearTimeout(pings.get(id)); finishPing(id, "github.com", 3, 3); }
      return null;
    }
    case "network_dns": {
      const host = String(a.host).trim();
      if (!/^[\w.-]+$/.test(host)) throw new Error("请输入域名或 IP 地址，例如 github.com 或 1.1.1.1");
      return new Promise((resolve) => setTimeout(() => resolve({
        host, server: a.server ?? null, system: params.get("netMock") === "hosts" ? ["127.0.0.1"] : ["140.82.112.3"],
        hostsFile: params.get("netMock") === "hosts" ? [`127.0.0.1 ${host}`] : [],
        records: [{ kind: "A", values: ["140.82.112.3"] }, { kind: "AAAA", values: [] }, { kind: "CNAME", values: [] },
          { kind: "MX", values: ["1 aspmx.l.google.com.", "5 alt1.aspmx.l.google.com."] }, { kind: "TXT", values: ['"v=spf1 include:_spf.google.com ~all"'] }],
      }), 300));
    }
    case "network_ports":
      return params.get("netMock") === "empty" ? [] : [
        { port: 1420, address: "127.0.0.1", pid: 50123, process: "node", user: "me" },
        { port: 3000, address: "*", pid: 50200, process: "node", user: "me" },
        { port: 5432, address: "127.0.0.1", pid: 812, process: "postgres", user: "me" },
        { port: 7890, address: "127.0.0.1", pid: 940, process: "verge-mihomo", user: "me" },
        { port: 14013, address: "127.0.0.1", pid: 1366, process: "WeChat", user: "me" },
      ].filter((r) => !quitPids.includes(r.pid));
    case "processes_snapshot": {
      const scenario = params.get("procMock") ?? "normal";
      if (scenario === "error") throw new Error("无法读取进程列表：ps 不可用（预览错误）");
      return mockProcesses(scenario);
    }
    case "processes_quit": {
      if (params.get("procMock") === "kill-denied") throw new Error("「Google Chrome Helper」属于系统或其他用户，AhaTools 无权结束它");
      const pids = new Set((a.targets as { pid: number }[]).map((t) => t.pid));
      quitPids.push(...pids);
      return a.force ? `已强制结束 ${pids.size} 个进程` : "已请求退出，应用可能会先询问是否保存";
    }
    case "search_files": {
      if (config.disabledMatches.includes("compress/compress")) return [];
      const paths = expandMockPaths(a.paths as string[]);
      const count = paths.filter(mockImage).length;
      return count ? [{ ...feature("compress", "compress", `压缩图片 · ${count} 张`, `图片压缩 · ${count} 张图片`), action: { type: "feature", feature: "compress", input: JSON.stringify(paths) } }] : [];
    }
    case "compress_start":
      return compressionStart(String(a.batchId), a.paths as string[], Number(a.quality), Boolean(a.toWebp));
    case "compress_reprocess": {
      const old = compressionBatches.find((b) => b.batchId === a.sourceBatchId);
      if (!old) throw new Error("原批次不存在");
      return compressionStart(String(a.batchId), old.items.map((i) => i.path), Number(a.quality), Boolean(a.toWebp));
    }
    case "compress_list_batches":
      if ((compressionScenario === "mixed" || compressionScenario === "slow") && !compressionBatches.length) compressionStart("preview", compressionFixtures, 80, false);
      return structuredClone(compressionBatches);
    case "compress_export": {
      const batchId = String(a.batchId), action = a.action as ExportAction, itemIds = a.itemIds as string[];
      compressionExports.push({ batchId, action, itemIds });
      const batch = compressionBatches.find((b) => b.batchId === batchId)!;
      const items = batch.items.filter((i) => itemIds.includes(i.itemId));
      if (action === "copy" && params.get("compressExport") !== "error") compressionCopies.push(items.map((i) => `/缓存/${batchId}/${i.outputName}`));
      return items.map((i): ExportResult => ({ itemId: i.itemId, path: params.get("compressExport") === "error" ? null : `/预览/${i.outputName}`, error: params.get("compressExport") === "error" ? "没有写入权限" : null }));
    }
    case "plugin:dialog|open":
      if (params.get("compressOpen") === "error") throw new Error("无法打开文件选择框");
      return params.get("compressOpen") === "cancel" ? null : compressionFixtures;
    case "plugin:dialog|message":
      return params.get("compressConfirm") === "cancel" ? "取消" : "覆盖原图";
    case "search": {
      const original = String(a.query ?? "").trim();
      const q = original.toLowerCase();
      const content = a.content as { type: "image" | "files" | "text"; paths?: string[]; text?: string } | undefined;
      if (content?.type === "text") {
        const kinds = mockKinds(content.text ?? "");
        return manifests.flatMap((m) => m.features.filter((f) => f.match && !config.disabledMatches.includes(`${m.id}/${f.code}`)
          && (f.match.types?.some((t) => kinds.includes(t)) || (f.match.text && Array.from(content.text ?? "").length >= (f.match.minLength ?? 1)))
          && (!q || [f.explain, m.name, ...f.cmds].some((name) => name.toLowerCase().includes(q))))
          .map((f) => ({ ...feature(m.id, f.code, f.explain, m.name), score: f.match?.types?.some((t) => kinds.includes(t)) ? 1000 : 0, action: { type: "feature" as const, feature: f.code, input: content.text } })))
          .sort((x, y) => y.score - x.score);
      }
      const compressionPaths = content?.type === "files" ? expandMockPaths(content.paths ?? []) : [];
      const compressionCount = compressionPaths.filter(mockImage).length;
      if (content) return manifests.flatMap((m) => m.features.filter((f) => {
        if (!f.match || config.disabledMatches.includes(`${m.id}/${f.code}`)) return false;
        const accepted = m.id === "compress" ? compressionCount > 0 : content.type === "image" ? f.match.image : content.paths?.length && content.paths.length <= (f.match.maxFiles ?? Infinity) && content.paths.every((path) =>
          f.match?.files?.some((ext) => ext === "*" || path.split(".").pop()?.toLowerCase() === ext));
        return accepted && (!q || [f.explain, m.name, ...f.cmds].some((name) => name.toLowerCase().includes(q)));
      }).map((f) => m.id === "compress"
        ? { ...feature(m.id, f.code, `${f.explain} · ${compressionCount} 张`, `${m.name} · ${compressionCount} 张图片`), action: { type: "feature", feature: f.code, input: JSON.stringify(compressionPaths) } }
        : feature(m.id, f.code, f.explain, m.name)));
      if (!q) return [];
      const prefix = original.match(/^(\S+)\s+([\s\S]+)$/);
      const features = manifests.flatMap((m) => m.features.flatMap((f) => {
        const prefixed = prefix && f.cmds.some((c) => c.toLowerCase() === prefix[1].toLowerCase());
        const named = f.cmds.some((c) => c.toLowerCase().includes(q));
        const off = config.disabledMatches.includes(`${m.id}/${f.code}`);
        const typed = !named && !off && f.match?.types?.some((t) => mockKinds(original).includes(t));
        const auto = !named && (typed || f.match?.text && Array.from(original).length >= Math.max(1, f.match.minLength ?? 1) && !off);
        if (!prefixed && !named && !auto) return [];
        const input = prefixed ? prefix[2].trim() : auto ? original : undefined;
        const line = input?.split("\n")[0] ?? "";
        const summary = Array.from(line).slice(0, 24).join("") + (Array.from(line).length > 24 || input?.includes("\n") ? "…" : "");
        return [{
          title: !prefixed && auto && f.matchTitle ? f.matchTitle.replace("{input}", summary) : f.explain,
          subtitle: input ? `${m.name} · 「${summary}」` : `${m.name} · 插件功能`,
          score: prefixed ? 10_000 : named ? 100 : typed ? 5_000 : -1,
          plugin: m.id, kind: "feature", action: { type: "feature", feature: f.code, ...(input === undefined ? {} : { input }) },
        }];
      }));
      const webHits = config.webApps
        .filter((w) => w.keywords.includes(q) || (w.name + w.url).toLowerCase().includes(q))
        .map((w) => ({
          title: w.name,
          subtitle: `${new URL(w.url).host} · 网页应用`,
          score: 200,
          plugin: "webapps",
          kind: "feature",
          icon: w.url,
          action: { type: "openWeb", id: w.id },
        }));
      const hits = apps
        .filter((x) => (x.title + x.subtitle).toLowerCase().includes(q))
        .map((x) => ({ ...x, score: 50, plugin: "launcher", action: { type: "openPath", path: x.path } }));
      // 网络工具 answers 「ip」 right in the list.
      const answers = ["ip", "内网ip", "本机ip", "局域网ip"].includes(q.replace(/\s/g, "")) ? mockAddresses.filter((a) => !a.v6).map((a, i) => ({
        title: a.ip, subtitle: `内网 IP · ${a.label} (${a.interface})`, score: 5_100 - i, plugin: "network", kind: "feature", action: { type: "copy", text: a.ip },
      })) : [];
      return [...answers, ...webHits, ...features, ...hits].sort((x, y) => y.score - x.score);
    }
    case "netspeed_snapshot": {
      const history = Array.from({ length: 60 }, (_, i) => [
        (1.5 + Math.sin(i / 5) + Math.random()) * 1024 * 1024,
        (60 + Math.random() * 80) * 1024,
      ]);
      const [down, up] = history[59];
      return { up, down, history, rxTotal: 12.4 * 1024 ** 3, txTotal: 1.8 * 1024 ** 3, iface: "en0", ifaceLabel: "Wi-Fi" };
    }
    case "sysmon_snapshot":
      return systemSnapshot();
    case "menu_resize":
      menuResizeRequests.push(Number(a.height));
      return null;
    case "menu_hide":
      menuVisible = false;
      queueMicrotask(() => void emit("menu-hidden"));
      return null;
    case "menu_open_panel":
    case "menu_open_feature":
    case "quit_app":
      systemActions.push(cmd);
      menuVisible = false;
      queueMicrotask(() => void emit("menu-hidden"));
      return null;
    case "plugin:autostart|is_enabled":
      return mockAutostart;
    case "plugin:autostart|enable":
    case "plugin:autostart|disable":
      mockAutostart = cmd.endsWith("|enable");
      return null;
    case "panel_pending": return pendingRequest;
    case "panel_ack": if (pendingRequest?.id === a.id) pendingRequest = null; return null;
    case "superpanel_state": return superState();
    case "superpanel_open": superConsumed = false; superRequest++; void emit("superpanel-shown", superState()); return null;
    case "superpanel_hide": superConsumed = true; return null;
    case "superpanel_pin_status": return config.superPanel.pinned.map((i) => i.action.type === "openPath" ? !i.action.path.includes("missing") : i.action.type === "openWeb" ? config.webApps.some((w) => w.id === (i.action as {id:string}).id) : manifests.some((m) => m.id === i.plugin));
    case "superpanel_validate_command": {
      const command = String(a.command);
      if (!command.trim()) throw new Error("请输入命令");
      if (/[\"']\{(?:path|text|dir|name)\}|\{(?:path|text|dir|name)\}[\"']/.test(command)) throw new Error("占位符要单独放在参数位置，不要加引号。例如：code {path}");
      return null;
    }
    case "superpanel_remove_pin": config.superPanel.pinned.splice(Number(a.index), 1); void emit("config-changed", config); return null;
    case "superpanel_pin_first": { const [item] = config.superPanel.pinned.splice(Number(a.index), 1); if (item) config.superPanel.pinned.unshift(item); void emit("config-changed", config); return null; }
    case "superpanel_toggle_pin": {
      const item = a.item as SearchItem; const key = (i: SearchItem) => `${i.plugin}/${JSON.stringify(i.action.type === "feature" ? { type: "feature", feature: i.action.feature } : i.action)}`;
      const at = config.superPanel.pinned.findIndex((p) => key(p) === key(item));
      if (at >= 0) config.superPanel.pinned.splice(at, 1);
      else if (config.superPanel.pinned.length >= 12) throw new Error("我的面板最多放 12 个功能，请先移除一个");
      else config.superPanel.pinned.push({ ...item, score: 0, action: item.action.type === "feature" ? { type: "feature", feature: item.action.feature } : item.action });
      void emit("config-changed", config); return at < 0;
    }
    case "superpanel_resize": (window as unknown as { __superHeight?: number }).__superHeight = Number(a.height); return null;
    case "superpanel_run": {
      if (Number(a.requestId) !== superRequest || superConsumed) throw new Error("上下文已更新，请重新呼出");
      if (params.get("superError") === "run") throw new Error("无法执行动作（预览错误）");
      superConsumed = true; const id = String(a.actionId); executed.push(id);
      const s = superState();
      if (id === "settings") navigate("settings", "general", "superpanel");
      else if (id === "search-panel" || id === "search") navigateQuery(id === "search" ? s.context.text ?? "" : "");
      else if (id === "copy") clipboardText = s.context.text ?? s.context.paths.join("\n");
      else if (id === "copy-name") clipboardText = s.context.paths.map((p) => p.replace(/\/$/, "").split("/").pop()).join("\n");
      else if (id === "pin-hint") { navigateQuery(""); setTimeout(() => void emit("panel-flash", "右键任意结果，选「固定到超级面板」"), 300); }
      else if (id.startsWith("plugin-settings:")) navigate("settings", "general", `plugins/${id.split(":")[1]}`);
      else if (id.startsWith("match:")) { const e = s.actions.find((x) => x.id === id); if (e?.item?.action.type === "feature") navigate(e.plugin, e.feature, s.context.kind === "files" ? JSON.stringify({ paths: s.context.paths }) : s.context.text); }
      return null;
    }
    case "system_ocr_get": return a.jobId && a.jobId !== ocrJob.id ? null : ocrJob;
    case "system_run": {
      if (a.feature !== "ocr") { executed.push(String(a.feature)); return null; }
      const id = String(++ocrId); ocrJob = makeOcr(id, "loading");
      setTimeout(() => { navigate("system", "ocr", id, true); void emit("system-ocr-updated", ocrJob); }, 100);
      setTimeout(() => { ocrJob = makeOcr(id); if (ocrJob.copied) clipboardText = ocrJob.text; void emit("system-ocr-updated", ocrJob); }, 500);
      return id;
    }
    case "config_get":
      return config;
    case "config_set":
      config = a.config as typeof config;
      queueMicrotask(() => void emit("config-changed", config));
      return [];
    case "plugin:clipboard-manager|read_image": {
      clipboardReads++;
      if (!clipboardPixels && scenario === "empty") throw new Error("剪贴板里没有图片");
      if (!clipboardPixels && scenario === "error") throw new Error("暂时无法读取剪贴板（预览错误）");
      const rid = nextImage++;
      images.set(rid, cloneImage(clipboardPixels ?? fixtureImage()));
      return clipboardReadDelay ? new Promise((resolve) => setTimeout(() => resolve(rid), clipboardReadDelay)) : rid;
    }
    case "clipboard_files":
      return [...clipboardFiles];
    case "plugin:image|new": {
      const rid = nextImage++;
      images.set(rid, { width: Number(a.width), height: Number(a.height), rgba: new Uint8ClampedArray(a.rgba as ArrayLike<number>) });
      return rid;
    }
    case "plugin:image|size": {
      const image = images.get(Number(a.rid));
      if (!image) throw new Error("图片资源已释放");
      return { width: image.width, height: image.height };
    }
    case "plugin:image|rgba": {
      const image = images.get(Number(a.rid));
      if (!image) throw new Error("图片资源已释放");
      return image.rgba.buffer.slice(0);
    }
    case "plugin:resources|close":
      images.delete(Number(a.rid));
      return null;
    case "plugin:clipboard-manager|write_image": {
      const image = images.get(Number(a.image));
      if (!image) throw new Error("图片资源不存在");
      clipboardPixels = cloneImage(image);
      clipboardFiles = [];
      return null;
    }
    case "clipboard_mark_own": mockCopy = null; return null;
    case "reveal_path": executed.push(`reveal:${String(a.path)}`); return null;
    case "plugin:clipboard-manager|write_text":
      clipboardText = String(a.text);
      clipboardPixels = undefined;
      clipboardFiles = [];
      scenario = "empty";
      return null;
    case "plugin:clipboard-manager|read_text":
      return clipboardText;
    case "plugin:dialog|save":
      return params.get("qrSave") === "cancel" ? null : `/预览/${(a.options as { defaultPath?: string })?.defaultPath ?? "二维码.png"}`;
    case "qr_save_png":
      if (params.get("qrSave") === "error") throw new Error("无法保存 PNG 图片：没有写入权限");
      savedImages.push({ path: String(a.path), bytes: a.bytes as number[] });
      return null;
    case "qr_read_image":
      if (String(a.path).includes("missing")) throw new Error("无法读取图片：文件不存在");
      return imagePng(fixtureImage()).then((b) => b.arrayBuffer());
    case "relay_status":
      return [
        { id: "wechat", installed: true, running: true },
        { id: "qq", installed: true, running: false },
        { id: "dingtalk", installed: true, running: false },
        { id: "utools", installed: true, running: true },
      ];
    case "usage_home":
      return structuredClone(usage);
    case "usage_reorder_pinned": return (async () => {
      pinWrites++;
      const delay = Number(params.get("pinDelay") ?? 0);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (params.get("pinSave") === "error") throw new Error("无法写入 usage.json（预览错误）");
      const item = homeItem(a.item as SearchItem);
      const before = a.before ? homeItem(a.before as SearchItem) : null;
      const from = usage.pinned.findIndex((entry) => sameItem(entry, item));
      if (from < 0) throw new Error("这个功能已取消固定");
      const [moved] = usage.pinned.splice(from, 1);
      const to = before ? usage.pinned.findIndex((entry) => sameItem(entry, before)) : usage.pinned.length;
      usage.pinned.splice(to < 0 ? usage.pinned.length : to, 0, moved);
      localStorage.setItem("ahatools.mock.pinned", JSON.stringify(usage.pinned));
      return structuredClone(usage);
    })();
    case "usage_toggle_pin": {
      const item = homeItem(a.item as SearchItem);
      const had = usage.pinned.some((x) => sameItem(x, item));
      usage.pinned = had ? usage.pinned.filter((x) => !sameItem(x, item)) : [...usage.pinned, item];
      localStorage.setItem("ahatools.mock.pinned", JSON.stringify(usage.pinned));
      return !had;
    }
    case "usage_record": {
      const item = homeItem(a.item as SearchItem);
      usage.recent = [item, ...usage.recent.filter((x) => !sameItem(x, item))].slice(0, 21);
      return null;
    }
    case "app_icon":
      return null;
    case "webapp_icon":
      // A stand-in for the real site icon the backend downloads.
      return {
        src: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#4D6BFE"/><circle cx="20" cy="20" r="9" fill="#fff"/></svg>'),
        fill: true,
      };
    case "config_dir":
      return "/Users/me/Library/Application Support/com.ahatools.app";
    case "plugin:app|version":
      return "0.1.0";
    case "webapp_open":
    case "hotkey_set_recording":
    case "relay_press_later":
    case "screenshot_take":
      return null;
    case "hide_panel":
      hideMockPanel();
      return null;
    case "set_panel_large":
      panelLarge = Boolean(a.large);
      return null;
    case "hotkey_bindings":
      return config.hotkeys;
    case "launcher_saved":
      return saved;
    case "launcher_add":
      saved = [
        ...saved.filter((e) => e.path !== a.path),
        { name: String(a.name ?? a.path), path: String(a.path), kind: String(a.path).includes("://") ? "link" : "folder" },
      ];
      return saved;
    case "launcher_remove":
      saved = saved.filter((e) => e.path !== a.path);
      return saved;
    case "hotkey_status":
      return { enabled: exclusive, exclusive, trusted: true };
    case "hotkey_set_exclusive":
      exclusive = Boolean(a.enabled);
      return { enabled: exclusive, exclusive, trusted: true };
    case "hotkey_probe":
      return [
        { label: "⌥ Space", accelerator: "Alt+Space", purpose: "launcher", status: "self", owner: "AhaTools" },
        { label: "⌘ Space", accelerator: "Super+Space", purpose: "launcher", status: "system", owner: "Spotlight" },
        { label: "⌃ Space", accelerator: "Control+Space", purpose: "launcher", status: "system", owner: "切换输入法" },
        { label: "⌘⇧ 4", accelerator: "Super+Shift+4", purpose: "screenshot", status: "system", owner: "系统截屏：区域存文件" },
        { label: "⌃⌘ A", accelerator: "Control+Super+KeyA", purpose: "screenshot", status: "occupied", owner: "可能是：微信 / QQ 截图默认键，或 uTools" },
        { label: "⌃⌥ A", accelerator: "Control+Alt+KeyA", purpose: "screenshot", status: "free", owner: null },
      ];
    default:
      return null;
  }
});
