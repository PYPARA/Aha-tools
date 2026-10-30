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
import compress from "../plugins/compress/plugin.json";
import type { CompressionBatch, CompressionItem, ExportAction, ExportResult } from "../plugins/compress/model";

const manifests: Manifest[] = [launcher, hotkeys, screenshot, webapps, qrcode, compress, settings].map((m) => ({ searchProvider: false, ...m }));

type QrScenario = "url" | "text" | "empty" | "no-code" | "error";
const params = new URLSearchParams(location.search);
const compressionBatches: CompressionBatch[] = [];
const compressionCopies: string[][] = [];
const compressionExports: { batchId: string; action: string; itemIds: string[] }[] = [];
const compressionQueue: CompressionBatch[] = [];
let compressionWorking = false;
let compressionScenario = params.get("compressMock") ?? "empty";
const compressionFixtures = ["/预览/banner-home.png", "/预览/avatar@2x.png", "/预览/photo-0921.jpg", "/预览/最小 tiny.webp", "/预览/icon.svg", "/预览/broken.png"];
const expandMockPaths = (paths: string[]) => [...new Set(paths.flatMap((p) => p.endsWith("/图片") ? compressionFixtures : [p]))];
const mockImage = (path: string) => /\.(png|jpe?g|webp)$/i.test(path);

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
    { accelerator: "Alt+Space", action: { type: "togglePanel" }, enabled: true },
    { accelerator: "Shift+Super+KeyA", action: { type: "screenshot" }, enabled: true },
    { accelerator: "Control+Space", action: { type: "forward", app: "utools" }, enabled: false },
  ],
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

mockWindows("panel");
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
    case "search_files": {
      if (config.disabledMatches.includes("compress/compress")) return [];
      const paths = expandMockPaths(a.paths as string[]);
      const count = paths.filter(mockImage).length;
      return count ? [{ ...feature("compress", "compress", "压缩图片", `图片压缩 · ${count} 张图片`), action: { type: "feature", feature: "compress", input: JSON.stringify(paths) } }] : [];
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
