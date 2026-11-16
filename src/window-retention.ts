import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
let count = 0;
let transition: Promise<unknown> = Promise.resolve();
/** Shared by dialogs, native menus and file pickers so nested operations cannot unpin each other. */
export function retainPanel() {
  if (count++ === 0) transition = transition.catch(() => {}).then(() => invoke("set_panel_pinned", { pinned: true }));
  const ready = transition;
  let released = false;
  return { ready, release: async () => {
    if (released) return; released = true;
    if (--count === 0) { transition = transition.catch(() => {}).then(() => invoke("set_panel_pinned", { pinned: false })); await transition; }
  } };
}
export async function withPinned<T>(fn: () => Promise<T>): Promise<T> {
  const hold = retainPanel();
  try { await hold.ready; return await fn(); }
  finally { await hold.release(); await getCurrentWindow().setFocus(); }
}
