// Mirrors src-tauri/src/config.rs.

export type Action =
  | { type: "togglePanel" }
  | { type: "openFeature"; plugin: string; feature: string }
  | { type: "screenshot" }
  | { type: "forward"; app: string };

export interface Binding {
  accelerator: string;
  action: Action;
  enabled: boolean;
}

export interface RelayApp {
  id: string;
  name: string;
  bundleId: string;
  accelerator: string;
  screenshot: boolean;
  /** The user confirmed the secret hotkey is set inside that app. */
  ready: boolean;
}

export interface Config {
  hotkeys: Binding[];
  netspeed: boolean;
  exclusiveHotkeys: boolean;
  screenshot: { target: string; systemMode: "region" | "toolbar" };
  relayApps: RelayApp[];
  pinyin: boolean;
  appearance: "system" | "light" | "dark";
  /** Content matches switched off, as "<plugin>/<feature>". */
  disabledMatches: string[];
  [key: string]: unknown;
}

export interface RelayStatus {
  id: string;
  installed: boolean;
  running: boolean;
}

/** Props of a plugin's 设置 tab in the plugin detail page. */
export interface PluginSettingsProps {
  cfg: Config;
  /** Saves and applies at once. */
  save: (cfg: Config) => void;
}

/** Name of the configured screenshot tool, e.g. "微信" or "系统截图". */
export function screenshotToolName(cfg: Config) {
  return cfg.relayApps.find((a) => a.id === cfg.screenshot.target)?.name ?? "系统截图";
}

/** The hotkey action that runs a plugin feature. Screenshot runs directly, without a page. */
export function featureAction(plugin: string, feature: string): Action {
  return plugin === "screenshot" ? { type: "screenshot" } : { type: "openFeature", plugin, feature };
}

export function sameAction(a: Action, b: Action) {
  return JSON.stringify(a) === JSON.stringify(b);
}
