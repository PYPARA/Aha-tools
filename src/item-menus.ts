import { invoke } from "@tauri-apps/api/core";
import type { Config, FeatureTarget, SearchItem } from "./sdk";
import { copyMenuText, isLocalPath, pathMenuEntries, type ContextMenuEntry } from "./path-actions";
export interface SavedEntry { id: string; name: string; path: string; kind: "file" | "folder" | "link"; openWithApp?: string | null }
export function itemMenuEntries(item: SearchItem, context: { saved: SavedEntry[]; webApps: Config["webApps"]; settingsPlugins: string[]; open: (target: FeatureTarget) => unknown; run: () => unknown }): ContextMenuEntry[] {
  const action = item.action;
  const entries: ContextMenuEntry[] = [{ id: "open", text: "打开", action: context.run }];
  if (action.type === "openSaved") {
    const saved = context.saved.find((e) => e.id === action.id);
    if (!saved) return [{ id: "missing", text: "收藏已移除", disabled: true, action: () => {} }];
    if (!isLocalPath(saved.path)) entries[0] = { id: "open", text: "在默认浏览器中打开", action: context.run };
    if (isLocalPath(saved.path) && !saved.path.endsWith(".app")) entries.push({ id: "open-with", text: "打开方式…", action: () => context.open({ plugin: "launcher", feature: "manage", input: JSON.stringify({ id: saved.id, mode: "openWith" }) }) });
    entries.push(...pathMenuEntries([saved.path]));
    if (!isLocalPath(saved.path)) entries.push({ id: "copy-url", text: "复制网址", action: () => copyMenuText(saved.path) });
    entries.push({ item: "Separator" }, { id: "edit-saved", text: "编辑收藏…", action: () => context.open({ plugin: "launcher", feature: "manage", input: JSON.stringify({ id: saved.id, mode: "edit" }) }) });
  } else if (action.type === "openPath") {
    entries.push(...pathMenuEntries([action.path]));
    if (!isLocalPath(action.path)) entries.push({ id: "copy-url", text: "复制网址", action: () => copyMenuText(action.path) });
  } else if (action.type === "openWeb") {
    const web = context.webApps.find((w) => w.id === action.id);
    if (web) entries.push(
      { id: "open-browser", text: "在默认浏览器中打开", action: () => invoke("open_path", { path: web.url }) },
      { id: "copy-url", text: "复制网址", action: () => copyMenuText(web.url) },
      { item: "Separator" },
      { id: "edit-web", text: "编辑网页应用…", action: () => context.open({ plugin: "settings", feature: "general", input: `plugins/webapps/settings/edit/${encodeURIComponent(web.id)}` }) },
      { id: "hotkey", text: "设置快捷键…", action: () => context.open({ plugin: "settings", feature: "general", input: `plugins/webapps/settings/hotkey/${encodeURIComponent(web.id)}` }) },
    );
  } else if (action.type === "feature") {
    entries.push({ item: "Separator" },
      { id: "plugin-detail", text: "插件详情…", action: () => context.open({ plugin: "settings", feature: "general", input: `plugins/${item.plugin}/keywords` }) },
      ...(context.settingsPlugins.includes(item.plugin) ? [{ id: "plugin-settings", text: "插件设置…", action: () => context.open({ plugin: "settings", feature: "general", input: `plugins/${item.plugin}/settings` }) }] : []),
      { id: "hotkey", text: "设置快捷键…", action: () => context.open({ plugin: "settings", feature: "general", input: `plugins/${item.plugin}/keywords/${encodeURIComponent(action.feature)}` }) });
  }
  return entries;
}
