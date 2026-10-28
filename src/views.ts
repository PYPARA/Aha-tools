// Built-in plugin views, keyed by "<plugin id>/<feature code>" from each plugin.json,
// and each plugin's icon for result rows and shortcuts.

import type { ComponentType } from "react";
import { BookmarkIcon, KeyboardIcon, type PluginViewProps } from "@ahatools/sdk";

import LauncherManage from "../plugins/launcher/Manage";
import HotkeysProbe from "../plugins/hotkeys/Probe";

export const views: Record<string, ComponentType<PluginViewProps>> = {
  "launcher/manage": LauncherManage,
  "hotkeys/probe": HotkeysProbe,
};

export const pluginIcons: Record<string, ComponentType<{ size?: number }>> = {
  launcher: BookmarkIcon,
  hotkeys: KeyboardIcon,
};
