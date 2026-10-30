// Built-in plugins wired into the panel: views keyed by "<plugin id>/<feature code>" from
// each plugin.json, features that run without a page, icons, and 设置 tabs.

import type { ComponentType } from "react";
import {
  invoke,
  imagePng,
  saveFileDialog,
  withPinned,
  writeClipboardImage,
  writeClipboardText,
  type PluginContent,
  type PluginSettingsProps,
  type PluginViewProps,
  type FeatureTarget,
} from "@ahatools/sdk";

import LauncherManage from "../plugins/launcher/Manage";
import HotkeysProbe from "../plugins/hotkeys/Probe";
import ScreenshotSettings from "../plugins/screenshot/Settings";
import Settings from "../plugins/settings/Settings";
import WebAppsSettings from "../plugins/webapps/Settings";
import QrGenerate from "../plugins/qrcode/Generate";
import QrScan from "../plugins/qrcode/Scan";
import Translate from "../plugins/translate/Translate";
import TranslateSettings from "../plugins/translate/Settings";

export { featureIcons, featureIconKey } from "./feature-icons";

export const views: Record<string, ComponentType<PluginViewProps>> = {
  "launcher/manage": LauncherManage,
  "hotkeys/probe": HotkeysProbe,
  "settings/general": Settings,
  "qrcode/generate": QrGenerate,
  "qrcode/scan": QrScan,
  "translate/translate": Translate,
};

/** Views that draw the whole window themselves (no page header or footer). */
export const fullPageViews = new Set(["settings/general"]);

/** A page in the panel: a plugin feature, optionally with input. */
export type Target = FeatureTarget;

/** Features that act right away instead of opening their own page. */
export const actions: Record<string, (ctx: { input?: string; content?: PluginContent; open: (t: Target) => void }) => unknown> = {
  "screenshot/take": () => invoke("screenshot_take", { target: null }),
  // Web apps are managed in their plugin's 设置 tab.
  "webapps/manage": ({ open }) => open({ plugin: "settings", feature: "general", input: "plugins/webapps/settings" }),
  "images/copy": async ({ content }) => {
    if (content?.type !== "image") throw new Error("先在搜索框粘贴一张图片");
    await writeClipboardImage(content.image);
    return "已复制图片";
  },
  "images/save": async ({ content }) => {
    if (content?.type !== "image") throw new Error("先在搜索框粘贴一张图片");
    const bytes = Array.from(new Uint8Array(await (await imagePng(content.image)).arrayBuffer()));
    return withPinned(async () => {
      const path = await saveFileDialog({ defaultPath: "图片.png", filters: [{ name: "PNG 图片", extensions: ["png"] }] });
      if (!path) return;
      await invoke("qr_save_png", { path, bytes });
      return "已保存图片";
    });
  },
  "launcher/copy-path": async ({ content }) => {
    if (content?.type !== "files") throw new Error("先在搜索框粘贴或拖入文件");
    await writeClipboardText(content.paths.join("\n"));
    return "已复制文件路径";
  },
  "launcher/copy-name": async ({ content }) => {
    if (content?.type !== "files") throw new Error("先在搜索框粘贴或拖入文件");
    await writeClipboardText(content.paths.map((path) => path.replace(/\/$/, "").split("/").pop()).join("\n"));
    return "已复制文件名称";
  },
};

/** Each plugin's 设置 tab in the plugin detail page. */
export const pluginSettings: Record<string, ComponentType<PluginSettingsProps>> = {
  screenshot: ScreenshotSettings,
  webapps: WebAppsSettings,
  translate: TranslateSettings,
};
