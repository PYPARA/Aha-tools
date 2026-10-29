// Built-in plugins wired into the panel: views keyed by "<plugin id>/<feature code>" from
// each plugin.json, features that run without a page, icons, and 设置 tabs.

import type { ComponentType } from "react";
import {
  BookmarkIcon,
  GearIcon,
  invoke,
  KeyboardIcon,
  ScreenshotIcon,
  type PluginSettingsProps,
  type PluginViewProps,
} from "@ahatools/sdk";

import LauncherManage from "../plugins/launcher/Manage";
import HotkeysProbe from "../plugins/hotkeys/Probe";
import ScreenshotSettings from "../plugins/screenshot/Settings";
import Settings from "../plugins/settings/Settings";

export const views: Record<string, ComponentType<PluginViewProps>> = {
  "launcher/manage": LauncherManage,
  "hotkeys/probe": HotkeysProbe,
  "settings/general": Settings,
};

/** Views that draw the whole window themselves (no page header or footer). */
export const fullPageViews = new Set(["settings/general"]);

/** Features that act right away instead of opening a page. */
export const actions: Record<string, (input?: string) => unknown> = {
  "screenshot/take": () => invoke("screenshot_take", { target: null }),
};

export const pluginIcons: Record<string, ComponentType<{ size?: number }>> = {
  launcher: BookmarkIcon,
  hotkeys: KeyboardIcon,
  screenshot: ScreenshotIcon,
  settings: GearIcon,
};

/** Each plugin's 设置 tab in the plugin detail page. */
export const pluginSettings: Record<string, ComponentType<PluginSettingsProps>> = {
  screenshot: ScreenshotSettings,
};
