// Host API for plugin views. Plugins import from "@ahatools/sdk", never from "src/*" directly,
// so this file is the contract external plugins will be written against later.

import { invoke } from "@tauri-apps/api/core";
import type { Config, TranslateDirection, TranslateProfile, TranslateProtocol } from "./config";
import { listen } from "@tauri-apps/api/event";
import { Image } from "@tauri-apps/api/image";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readImage, writeImage, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save, type SaveDialogOptions } from "@tauri-apps/plugin-dialog";

export { invoke };
export * from "./ui";
export * from "./config";
export { imageCanvas, imagePng, pixelsFromBlob, hasTextSelection, isEditingTarget } from "./image";

export type ItemAction =
  | { type: "openPath"; path: string }
  | { type: "openWeb"; id: string }
  | { type: "feature"; feature: string; input?: string };

export interface SearchItem {
  title: string;
  subtitle: string;
  score: number;
  plugin: string;
  kind: "app" | "saved" | "feature";
  /** Saved paths: "folder" | "file" | "link". Web apps: the site URL, for its icon. */
  icon?: string;
  action: ItemAction;
}

export interface Feature {
  code: string;
  explain: string;
  cmds: string[];
  match?: { text?: boolean; minLength?: number; regex?: string; files?: string[]; image?: boolean; maxFiles?: number };
}

export interface Manifest {
  id: string;
  name: string;
  version: string;
  description: string;
  searchProvider: boolean;
  features: Feature[];
}

export type FeatureTarget = { plugin: string; feature: string; input?: string; content?: PluginContent; returnTo?: FeatureTarget };

/** A snapshot of an explicit paste/drop, kept in memory and never written to history. */
export type PluginContent =
  | { type: "image"; image: RgbaImage; name: string }
  | { type: "files"; paths: string[] };

/** Pixels are RGBA, in row-major order. Native image handles never leave the SDK. */
export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** Props every plugin view receives. */
export interface PluginViewProps {
  /** Leave the plugin and return to search. */
  onBack: () => void;
  /** Text for the right side of the panel footer, e.g. "4 个收藏". */
  setStatus: (text: string) => void;
  /** Text the feature was opened with ("fy hello" → "hello", or a matched query). */
  input?: string;
  content?: PluginContent;
  /** Open another feature, including its title and optional input. */
  openFeature: (target: FeatureTarget) => void;
}

export const hidePanel = () => invoke("hide_panel");

export const openPath = (path: string) => invoke("open_path", { path });

export const writeClipboardText = (text: string) => writeText(text);
export const readClipboardFiles = () => invoke<string[]>("clipboard_files");

export async function readClipboardImage(): Promise<RgbaImage | null> {
  let image: Image;
  try {
    image = await readImage();
  } catch (error) {
    // arboard reports an empty clipboard and a missing image format with the same error.
    if (/clipboard.*(?:empty|not available)|requested format|ContentNotAvailable|剪贴板里没有图片/i.test(String(error))) return null;
    throw error;
  }
  try {
    const [{ width, height }, rgba] = await Promise.all([image.size(), image.rgba()]);
    return { width, height, rgba: new Uint8ClampedArray(rgba) };
  } finally {
    await image.close();
  }
}

export async function writeClipboardImage({ width, height, rgba }: RgbaImage): Promise<void> {
  const image = await Image.new(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height);
  try {
    await writeImage(image);
  } finally {
    await image.close();
  }
}

export const saveFileDialog = (options: SaveDialogOptions) => save(options);

export interface PanelShownEvent { reset: boolean }
export const onPanelShown = (handler: (event: PanelShownEvent) => void) =>
  listen<PanelShownEvent>("panel-shown", ({ payload }) => handler(payload));

export const onFileDrop = (handler: (paths: string[]) => void) =>
  getCurrentWindow().onDragDropEvent(({ payload }) => {
    if (payload.type === "drop") handler(payload.paths);
  });

/**
 * Keeps the panel open while `fn` runs. Use around anything that steals focus,
 * such as a native file dialog, otherwise the panel hides itself on blur.
 */
let pinCount = 0;
let pinTransition: Promise<unknown> = Promise.resolve();
export async function withPinned<T>(fn: () => Promise<T>): Promise<T> {
  if (pinCount++ === 0) pinTransition = pinTransition.catch(() => {}).then(() => invoke("set_panel_pinned", { pinned: true }));
  try {
    await pinTransition;
    return await fn();
  } finally {
    if (--pinCount === 0) {
      pinTransition = pinTransition.catch(() => {}).then(() => invoke("set_panel_pinned", { pinned: false }));
      await pinTransition;
      await getCurrentWindow().setFocus();
    }
  }
}

export type TranslateMode = "translate" | "polish" | "explain";
export interface TranslateDraft {
  profileId: string;
  protocol: TranslateProtocol;
  baseUrl: string;
  key?: string;
}
export interface TranslateModel { id: string; name: string }
export interface TranslateChunk { id: string; delta: string }
export interface TranslateDone { id: string; reason: "completed" | "stopped"; word: boolean }
export interface TranslateError { id: string; message: string }

export const onConfigChanged = (handler: (cfg: Config) => void) =>
  listen<Config>("config-changed", (e) => handler(e.payload));
export async function onTranslation(handlers: {
  chunk: (e: TranslateChunk) => void;
  done: (e: TranslateDone) => void;
  error: (e: TranslateError) => void;
}) {
  const unlisten: (() => void)[] = [];
  try {
    unlisten.push(await listen<TranslateChunk>("translate-chunk", (e) => handlers.chunk(e.payload)));
    unlisten.push(await listen<TranslateDone>("translate-done", (e) => handlers.done(e.payload)));
    unlisten.push(await listen<TranslateError>("translate-error", (e) => handlers.error(e.payload)));
    return () => unlisten.forEach((f) => f());
  } catch (e) { unlisten.forEach((f) => f()); throw e; }
}
export const translateStart = (args: { id: string; profileId: string; text: string; mode: TranslateMode; direction: TranslateDirection }) =>
  withPinned(() => invoke<void>("translate_start", args));
export const translateStop = (id: string) => invoke<void>("translate_stop", { id });
export const translateSelect = (changes: { profileId?: string; direction?: TranslateDirection }) =>
  invoke<Config>("translate_select", changes);
export const translateHasKey = (profileId: string) => withPinned(() => invoke<boolean>("translate_has_key", { profileId }));
export const translateSaveProfile = (profile: TranslateProfile, key?: string) =>
  withPinned(() => invoke<Config>("translate_save_profile", { profile, key: key || null }));
export const translateDeleteProfile = (profileId: string) =>
  withPinned(() => invoke<Config>("translate_delete_profile", { profileId }));
export const translateListModels = (draft: TranslateDraft) =>
  withPinned(() => invoke<TranslateModel[]>("translate_list_models", { draft }));
export const translateTestConnection = (draft: TranslateDraft, model: string) =>
  withPinned(() => invoke<{ firstTokenMs: number }>("translate_test_connection", { draft, model }));

export const pluginSettingsTarget = (plugin: string, returnTo: FeatureTarget): FeatureTarget =>
  ({ plugin: "settings", feature: "general", input: `plugins/${plugin}/settings`, returnTo });
