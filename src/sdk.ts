// Host API for plugin views. Plugins import from "@aha/sdk", never from "src/*" directly,
// so this file is the contract external plugins will be written against later.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export { invoke };
export * from "./ui";

export type ItemAction =
  | { type: "openPath"; path: string }
  | { type: "feature"; feature: string };

export interface SearchItem {
  title: string;
  subtitle: string;
  score: number;
  plugin: string;
  kind: "app" | "saved" | "feature";
  /** Saved paths only. */
  icon?: "folder" | "file" | "link";
  action: ItemAction;
}

export interface Feature {
  code: string;
  explain: string;
  cmds: string[];
}

export interface Manifest {
  id: string;
  name: string;
  version: string;
  description: string;
  searchProvider: boolean;
  features: Feature[];
}

/** Props every plugin view receives. */
export interface PluginViewProps {
  /** Leave the plugin and return to search. */
  onBack: () => void;
  /** Text for the right side of the panel footer, e.g. "4 个收藏". */
  setStatus: (text: string) => void;
}

export const hidePanel = () => invoke("hide_panel");

export const openPath = (path: string) => invoke("open_path", { path });

/**
 * Keeps the panel open while `fn` runs. Use around anything that steals focus,
 * such as a native file dialog, otherwise the panel hides itself on blur.
 */
export async function withPinned<T>(fn: () => Promise<T>): Promise<T> {
  await invoke("set_panel_pinned", { pinned: true });
  try {
    return await fn();
  } finally {
    await invoke("set_panel_pinned", { pinned: false });
    await getCurrentWindow().setFocus();
  }
}
