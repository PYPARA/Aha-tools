// Fake backend for previewing the UI in a plain browser (http://localhost:1420 while
// `tauri dev` runs). Only loaded in dev when the page isn't inside Tauri.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { Manifest, RgbaImage, SearchItem } from "./sdk";
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

const manifests: Manifest[] = [launcher, hotkeys, screenshot, webapps, qrcode, system, superpanel, settings].map((m) => ({ searchProvider: false, ...m }));

type QrScenario = "url" | "text" | "empty" | "no-code" | "error";
const params = new URLSearchParams(location.search);
let scenario = (params.get("qrMock") ?? "url") as QrScenario;
let clipboardPixels: RgbaImage | undefined;
let clipboardText = "";
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
  __AHATOOLS_QR_MOCK__: {
    setClipboard(value: QrScenario) { scenario = value; clipboardPixels = undefined; },
    get text() { return clipboardText; },
    get activeImages() { return images.size; },
    get saved() { return savedImages; },
    drop(paths: string[]) { return emit("tauri://drag-drop", { paths, position: { x: 100, y: 100 } }); },
    showPanel() { return emit("panel-shown"); },
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
    feature("hotkeys", "probe", "检测热键占用", "热键检测"),
    app("Cursor", "/Applications/Cursor.app"),
    feature("launcher", "manage", "管理收藏的路径", "快捷启动"),
    app("系统设置", "/System/Applications/System Settings.app"),
    app("备忘录", "/System/Applications/Notes.app"),
  ],
  pinned: [app("Ghostty", "/Applications/Ghostty.app"), app("微信", "/Applications/WeChat.app"), feature("screenshot", "take", "截图", "截图")],
};

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

let config = {
  hotkeys: [
    { accelerator: "Alt+Shift+Space", action: { type: "superPanel" }, enabled: true },
    { accelerator: "Alt+Space", action: { type: "togglePanel" }, enabled: true },
    { accelerator: "Shift+Super+KeyA", action: { type: "screenshot" }, enabled: true },
    { accelerator: "Control+Space", action: { type: "forward", app: "utools" }, enabled: false },
  ],
  superPanel: {
    longPressRight: false,
    pinned: [feature("screenshot", "take", "截图", "截图"), feature("qrcode", "generate", "二维码", "二维码"), feature("system", "colorpicker", "取色", "系统动作"), feature("system", "ocr", "截图识字", "系统动作"),
      { title: "DeepSeek", subtitle: "网页应用", score: 0, plugin: "webapps", kind: "feature", icon: "https://chat.deepseek.com", action: { type: "openWeb", id: "deepseek" } } as SearchItem,
      feature("system", "desktop", "显示桌面", "系统动作"), feature("system", "lock", "锁屏", "系统动作")],
    actions: [
      { id: "vscode", name: "用 VS Code 打开", command: "code {path}", when: ["file", "folder", "image"], enabled: false },
      { id: "claude-code", name: "用 Claude Code 打开", command: "/usr/bin/osascript -e 'on run argv' -e 'tell application \"Terminal\" to do script (\"cd \" & quoted form of (item 1 of argv) & \" && claude\")' -e 'end run' {dir}", when: ["folder"], enabled: false },
    ],
  },
  netspeed: true,
  exclusiveHotkeys: true,
  pinyin: true,
  appearance: "system",
  disabledMatches: [] as string[],
  webApps: [{ id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com", keywords: ["ds"] }],
  screenshot: { target: "wechat", systemMode: "region" },
  relayApps: [
    { id: "wechat", name: "微信", bundleId: "com.tencent.xinWeChat", accelerator: "Control+Super+Digit1", screenshot: true, ready: false },
    { id: "qq", name: "QQ", bundleId: "com.tencent.qq", accelerator: "Control+Super+Digit2", screenshot: true, ready: false },
    { id: "dingtalk", name: "钉钉", bundleId: "com.alibaba.DingTalkMac", accelerator: "Control+Super+Digit3", screenshot: true, ready: false },
    { id: "utools", name: "uTools", bundleId: "org.yuanli.utools", accelerator: "Control+Super+Digit0", screenshot: false, ready: false },
  ],
};

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
function superState() {
  const paths = superScenario === "folder" ? ["/Users/me/Documents/设计稿"] : superScenario === "image" ? ["/Users/me/Documents/二维码.png"] : superScenario === "multi" ? ["/Users/me/Documents/图.png", "/Users/me/Documents/备注.txt"] : superScenario === "file" ? ["/Users/me/Documents/说明.txt"] : [];
  const text = superScenario === "url" ? "https://example.com" : superScenario === "text" ? "Build something useful with AhaTools." : undefined;
  const context = { kind: paths.length ? "files" : text ? "text" : "none", appName: paths.length ? "访达" : "Safari", paths, text, notice: superScenario === "permission" ? "无法读取访达。请在系统设置 → 隐私与安全性 → 自动化中允许 AhaTools 控制访达" : undefined };
  const row = (id: string, title: string, subtitle: string, plugin: string, feature = "") => ({ id, title, subtitle, plugin, feature });
  const actions = paths.length ? [
    ...(superScenario === "image" ? [row("qr", "识别二维码", "选中的图片", "qrcode", "scan")] : []),
    row("copy", "复制路径", `${paths.length} 个项目`, "launcher"), row("terminal", "在终端中打开", "所在文件夹", "launcher"),
    ...(superScenario === "folder" ? [row("new", "新建空白文件", "未命名.txt", "launcher")] : []), row("save", "收藏到快捷启动", "保留全部选中项目", "launcher"),
  ] : text ? [
    ...config.webApps.map((w) => row(`ask:${w.id}`, `问 ${w.name}`, "复制文字并打开网页应用", "webapps")), row("qr", "生成二维码", "选中的文字", "qrcode", "generate"), row("search", "在搜索面板中打开", "带入选中文字", "launcher"), row("copy", "复制为纯文本", "去掉文字格式", "launcher"), ...(superScenario === "url" ? [row("url", "在浏览器中打开", text, "webapps")] : []),
  ] : [];
  const pinned = config.superPanel.pinned.map((item, i) => ({ ...row(`pin:${i}`, item.title, item.subtitle, item.plugin, item.action.type === "feature" ? item.action.feature : ""), item }));
  return { requestId: superRequest, context, actions, pinned };
}
Object.assign(window, { __AHATOOLS_SUPER_MOCK__: {
  setScenario(value: string) { superScenario = value; superConsumed = false; superRequest++; return emit("superpanel-shown", superState()); },
  get executed() { return executed; }, get pending() { return pendingRequest; }, get text() { return clipboardText; },
  openFeature(plugin: string, feature: string, input?: string, viewOnly = false) { navigate(plugin, feature, input, viewOnly); },
  setOcr(phase: string) { ocrJob = makeOcr(String(++ocrId), phase); navigate("system", "ocr", ocrJob.id, true); return emit("system-ocr-updated", ocrJob); },
} });
if (params.get("page") === "settings") pendingRequest = { id: ++requestId, plugin: "settings", feature: "general", input: "superpanel" };
if (params.has("ocrMock")) pendingRequest = { id: ++requestId, plugin: "system", feature: "ocr", input: "1", viewOnly: true };
mockWindows(params.get("view") === "super" ? "super" : "panel");
mockIPC((cmd, args) => {
  const a = (args ?? {}) as Record<string, unknown>;
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
    case "list_plugins":
      return manifests;
    case "search": {
      const original = String(a.query ?? "").trim();
      const q = original.toLowerCase();
      if (!q) return [];
      const prefix = original.match(/^(\S+)\s+([\s\S]+)$/);
      const features = manifests.flatMap((m) => m.features.flatMap((f) => {
        const prefixed = prefix && f.cmds.some((c) => c.toLowerCase() === prefix[1].toLowerCase());
        const named = f.cmds.some((c) => c.toLowerCase().includes(q));
        const auto = !named && f.match?.text && Array.from(original).length >= Math.max(1, f.match.minLength ?? 1) &&
          !config.disabledMatches.includes(`${m.id}/${f.code}`);
        if (!prefixed && !named && !auto) return [];
        const input = prefixed ? prefix[2].trim() : auto ? original : undefined;
        const line = input?.split("\n")[0] ?? "";
        const summary = Array.from(line).slice(0, 24).join("") + (Array.from(line).length > 24 || input?.includes("\n") ? "…" : "");
        return [{
          title: !prefixed && auto && m.id === "qrcode" ? `为「${summary}」生成二维码` : f.explain,
          subtitle: input ? `${m.name} · 「${summary}」` : `${m.name} · 插件功能`,
          score: prefixed ? 10_000 : named ? 100 : -1,
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
      return [...webHits, ...features, ...hits].sort((x, y) => y.score - x.score);
    }
    case "netspeed_snapshot": {
      const history = Array.from({ length: 60 }, (_, i) => [
        (1.5 + Math.sin(i / 5) + Math.random()) * 1024 * 1024,
        (60 + Math.random() * 80) * 1024,
      ]);
      const [down, up] = history[59];
      return { up, down, history, rxTotal: 12.4 * 1024 ** 3, txTotal: 1.8 * 1024 ** 3, iface: "en0", ifaceLabel: "Wi-Fi" };
    }
    case "plugin:autostart|is_enabled":
      return false;
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
    case "superpanel_run": {
      if (Number(a.requestId) !== superRequest || superConsumed) throw new Error("上下文已更新，请重新呼出");
      if (params.get("superError") === "run") throw new Error("无法执行动作（预览错误）");
      superConsumed = true; const id = String(a.actionId); executed.push(id);
      const s = superState();
      if (id === "settings") navigate("settings", "general", "superpanel");
      else if (id === "search-panel" || id === "search") { pendingRequest = { id: ++requestId, plugin: "", feature: "", query: id === "search" ? s.context.text : "" }; void emit("panel-query", pendingRequest); }
      else if (id === "copy") clipboardText = s.context.text ?? s.context.paths.join("\n");
      else if (id === "qr") navigate("qrcode", s.context.kind === "files" ? "scan" : "generate", s.context.kind === "files" ? JSON.stringify({ paths: s.context.paths }) : s.context.text);
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
      if (!clipboardPixels && scenario === "empty") throw new Error("剪贴板里没有图片");
      if (!clipboardPixels && scenario === "error") throw new Error("暂时无法读取剪贴板（预览错误）");
      const rid = nextImage++;
      images.set(rid, cloneImage(clipboardPixels ?? fixtureImage()));
      return rid;
    }
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
      return null;
    }
    case "plugin:clipboard-manager|write_text":
      clipboardText = String(a.text);
      clipboardPixels = undefined;
      scenario = "empty";
      return null;
    case "plugin:clipboard-manager|read_text":
      return clipboardText;
    case "plugin:dialog|save":
      return params.get("qrSave") === "cancel" ? null : "/预览/二维码.png";
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
      return usage;
    case "usage_toggle_pin": {
      const item = homeItem(a.item as SearchItem);
      const had = usage.pinned.some((x) => sameItem(x, item));
      usage.pinned = had ? usage.pinned.filter((x) => !sameItem(x, item)) : [...usage.pinned, item];
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
    case "set_panel_large":
    case "hotkey_set_recording":
    case "relay_press_later":
    case "screenshot_take":
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
