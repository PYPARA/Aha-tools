import { retainPanel } from "./window-retention";
import { invoke } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export type ContextMenuEntry = {
  id?: string; text: string; accelerator?: string; disabled?: boolean; action: () => unknown;
} | { item: "Separator" };
export type MenuPoint = { x: number; y: number; target?: HTMLElement | null };
let menuDepth = 0;
export const isContextMenuOpen = () => menuDepth > 0;
export function holdContextMenu() { menuDepth++; let done = false; return () => { if (!done) { done = true; menuDepth--; } }; }
export const isLocalPath = (path: string) => !!path.trim() && !/^[a-z][a-z\d+.-]*:/i.test(path.trim());
export const revealPaths = (paths: string[]) => invoke<void>("reveal_paths", { paths });
export const copyMenuText = async (text: string) => { await writeText(text); await invoke("clipboard_mark_own").catch(() => {}); };
export const menuPoint = (event: { clientX: number; clientY: number; currentTarget: EventTarget | null }): MenuPoint => {
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const box = target?.getBoundingClientRect();
  return { x: event.clientX || box?.left || 4, y: event.clientY || box?.bottom || 4, target };
};
export function pathMenuEntries(paths: string[]): ContextMenuEntry[] {
  const local = [...new Set(paths.filter(isLocalPath))];
  if (!local.length) return [];
  return [
    { id: "reveal", text: local.length > 1 ? `打开 ${local.length} 个文件的位置` : "打开文件位置", action: () => revealPaths(local) },
    { id: "copy-path", text: local.length > 1 ? `复制 ${local.length} 个文件的路径` : "复制路径", action: () => copyMenuText(local.join("\n")) },
  ];
}
export function textMenuEntries(text: string, selected = ""): ContextMenuEntry[] {
  return [
    ...(selected ? [{ id: "copy-selection", text: "复制所选文字", accelerator: "CmdOrCtrl+C", action: () => copyMenuText(selected) }] : []),
    { id: "copy-all", text: "复制全部", disabled: !text, action: () => copyMenuText(text) },
  ];
}
export function selectedTextWithin(target: Element): string {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.toString()) return "";
  const range = selection.getRangeAt(0);
  return target.contains(range.commonAncestorContainer) ? selection.toString() : "";
}
let request = 0;
export async function showContextMenu(entries: ContextMenuEntry[], onError: (message: string) => void, at?: MenuPoint): Promise<void> {
  if (!entries.length) return;
  const id = ++request;
  const restore = at?.target ?? document.activeElement as HTMLElement | null;
  restore?.focus({ preventScroll: true });
  const release = holdContextMenu();
  const hold = retainPanel();
  let menu: Menu | undefined;
  let picked = false;
  try {
    await hold.ready;
    menu = await Menu.new({ items: entries.map((entry, index) => "action" in entry ? {
      id: `context-${id}-${entry.id ?? index}`, text: entry.text, enabled: !entry.disabled, accelerator: entry.accelerator,
      action: () => { picked = true; void Promise.resolve().then(entry.action).catch((e) => onError(String(e))); },
    } : entry) });
    if (id !== request) return;
    await menu.popup(at ? new LogicalPosition(at.x, at.y) : undefined);
  } catch (e) { onError(String(e)); }
  finally {
    release(); await hold.release().catch((e) => onError(String(e)));
    // Menu callbacks may arrive on the next IPC tick. Focus only when staying on this page.
    if (!picked && restore?.isConnected) restore.focus({ preventScroll: true });
    await menu?.close().catch(() => {});
  }
}

/** Installed before page listeners so menu keystrokes cannot reach the underlying view. */
export function installContextMenus() {
  window.addEventListener("keydown", (event) => {
    if (isContextMenuOpen()) return;
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input,textarea,[contenteditable]:not([contenteditable='false'])")) return;
    const element = target?.closest<HTMLElement>("[data-context-menu]")
      ?? document.querySelector<HTMLElement>('[aria-selected="true"][data-context-menu], [aria-current="true"][data-context-menu], .selected[data-context-menu]');
    if (!element) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const box = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 12, clientY: box.top + Math.min(box.height, 30) }));
  }, true);
  window.addEventListener("click", (event) => {
    if (!event.ctrlKey || event.button !== 0 || !(event.target instanceof Element)) return;
    if (event.target.closest("input,textarea,[contenteditable]:not([contenteditable='false'])")) return;
    if (!event.target.closest("[data-context-menu]")) return;
    event.preventDefault(); event.stopImmediatePropagation();
    event.target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY }));
  }, true);
  window.addEventListener("contextmenu", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("input,textarea,[contenteditable]:not([contenteditable='false'])")) { event.stopPropagation(); return; }
    let output = event.target.closest<HTMLElement>("[data-copy-text],pre,.translate-result,.ocr-result,.net-value");
    if (output && output.closest("[data-context-menu]") && output.tagName !== "PRE" && !output.hasAttribute("data-copy-text") && !output.hasAttribute("data-context-menu")) output = null;
    const selectionRoot = output ?? event.target.closest<HTMLElement>("[data-context-menu]") ?? event.target;
    const selected = selectedTextWithin(selectionRoot);
    if ((output && !output.closest("[data-history-preview]")) || selected) {
      event.preventDefault(); event.stopPropagation();
      const text = output?.dataset.copyText ?? output?.innerText ?? selected;
      void showContextMenu(textMenuEntries(text, selected), (message) => window.dispatchEvent(new CustomEvent("context-error", { detail: message })), { x: event.clientX, y: event.clientY, target: output ?? event.target.closest<HTMLElement>("[data-context-menu]") });
    }
  }, true);
  window.addEventListener("contextmenu", (event) => { if (!(event.target instanceof Element) || !event.target.closest("input,textarea,[contenteditable]:not([contenteditable='false'])")) event.preventDefault(); });
}
