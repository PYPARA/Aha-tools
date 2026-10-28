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
}

export interface Config {
  hotkeys: Binding[];
  netspeed: boolean;
  exclusiveHotkeys: boolean;
  screenshot: { target: string; systemMode: "region" | "toolbar" };
  relayApps: RelayApp[];
  [key: string]: unknown;
}

export interface RelayStatus {
  id: string;
  installed: boolean;
  running: boolean;
}

/** Name of the configured screenshot tool, e.g. "微信" or "系统截图". */
export function screenshotToolName(cfg: Config) {
  return cfg.relayApps.find((a) => a.id === cfg.screenshot.target)?.name ?? "系统截图";
}
