// Fake backend for previewing the UI in a plain browser (http://localhost:1420 while
// `tauri dev` runs). Only loaded in dev when the page isn't inside Tauri.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import launcher from "../plugins/launcher/plugin.json";
import hotkeys from "../plugins/hotkeys/plugin.json";
import screenshot from "../plugins/screenshot/plugin.json";
import settings from "../plugins/settings/plugin.json";

const manifests = [launcher, hotkeys, screenshot, settings];

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

const feature = (plugin: string, code: string, title: string, subtitle: string) => ({
  title, subtitle, score: 0, plugin, kind: "feature", action: { type: "feature", feature: code },
});
const app = (title: string, path: string) => ({
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
    case "list_plugins":
      return manifests;
    case "search": {
      const q = String(a.query ?? "").trim().toLowerCase();
      if (!q) return [];
      const features = manifests.flatMap((m) =>
        m.features
          .filter((f) => f.cmds.some((c) => c.toLowerCase().includes(q)))
          .map((f) => ({
            title: f.explain,
            subtitle: `${m.name} · 插件功能`,
            score: 100,
            plugin: m.id,
            kind: "feature",
            action: { type: "feature", feature: f.code },
          })),
      );
      const hits = apps
        .filter((x) => (x.title + x.subtitle).toLowerCase().includes(q))
        .map((x) => ({ ...x, score: 50, plugin: "launcher", action: { type: "openPath", path: x.path } }));
      return [...features, ...hits];
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
      return [];
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
      const item = a.item as (typeof usage.pinned)[number];
      const same = (x: typeof item) => x.plugin === item.plugin && JSON.stringify(x.action) === JSON.stringify(item.action);
      const had = usage.pinned.some(same);
      usage.pinned = had ? usage.pinned.filter((x) => !same(x)) : [...usage.pinned, item];
      return !had;
    }
    case "app_icon":
      return null;
    case "config_dir":
      return "/Users/me/Library/Application Support/com.ahatools.app";
    case "plugin:app|version":
      return "0.1.0";
    case "usage_record":
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
