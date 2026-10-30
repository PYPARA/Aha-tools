// Built-in plugins wired into the panel: views keyed by "<plugin id>/<feature code>" from
// each plugin.json, features that run without a page, icons, and 设置 tabs.

import type { ComponentType } from "react";
import {
  invoke,
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
import OcrResult from "../plugins/system/OcrResult";

export const views: Record<string, ComponentType<PluginViewProps>> = {
  "launcher/manage": LauncherManage,
  "hotkeys/probe": HotkeysProbe,
  "settings/general": Settings,
  "qrcode/generate": QrGenerate,
  "qrcode/scan": QrScan,
  "system/ocr": OcrResult,
};

/** Views that draw the whole window themselves (no page header or footer). */
export const fullPageViews = new Set(["settings/general"]);

/** A page in the panel: a plugin feature, optionally with input. */
export type Target = FeatureTarget;

/** Features that act right away instead of opening their own page. */
export const actions: Record<string, (ctx: { input?: string; open: (t: Target) => void }) => unknown> = {
  "screenshot/take": () => invoke("screenshot_take", { target: null }),
  "superpanel/open": () => invoke("superpanel_open"),
  ...Object.fromEntries(["colorpicker", "desktop", "lock", "ocr"].map((feature) => [`system/${feature}`, () => invoke("system_run", { feature })])),
  // Web apps are managed in their plugin's 设置 tab.
  "webapps/manage": ({ open }) => open({ plugin: "settings", feature: "general", input: "plugins/webapps/settings" }),
};

/** Each plugin's 设置 tab in the plugin detail page. */
export const pluginSettings: Record<string, ComponentType<PluginSettingsProps>> = {
  screenshot: ScreenshotSettings,
  webapps: WebAppsSettings,
};
