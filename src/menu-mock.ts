// Browser-only stand-in for Tauri's native menu. Loaded only by dev-mock.ts.
type MockItem = { text?: string; item?: string; enabled?: boolean; accelerator?: string; handler?: { onmessage: (id: string) => void } };
const menus = new Map<number, MockItem[]>();
let nextId = 1_000_000;
let point = { x: 0, y: 0 };
let dismiss: (() => void) | undefined;
document.addEventListener("contextmenu", (event) => { point = { x: event.clientX, y: event.clientY }; }, true);

export function closeMockMenu(rid: number) { menus.delete(rid); }

export function menuMockInvoke(command: string, args: Record<string, unknown>) {
  if (command === "plugin:menu|new") {
    const id = nextId++;
    menus.set(id, (args.options as { items: MockItem[] }).items);
    return [id, String(id)];
  }
  if (command !== "plugin:menu|popup") return null;
  dismiss?.();
  const items = menus.get(Number(args.rid)) ?? [];
  let finish: () => void = () => {};
  const completion = new Promise<void>((resolve) => { finish = resolve; });
  const focus = document.activeElement as HTMLElement | null;
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "操作菜单");
  menu.style.cssText = "position:fixed;z-index:10000;min-width:200px;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px);overflow:auto;padding:4px;border:1px solid var(--border-strong);border-radius:10px;background:var(--surface);color:var(--text);font:13px -apple-system,sans-serif";
  const buttons: HTMLButtonElement[] = [];
  for (const [index, item] of items.entries()) {
    if (item.item === "Separator") {
      const line = document.createElement("div");
      line.setAttribute("role", "separator");
      line.style.cssText = "height:1px;background:var(--border);margin:4px";
      menu.append(line);
    } else {
      const button = document.createElement("button");
      button.type = "button"; button.setAttribute("role", "menuitem");
      button.className = "btn ghost"; button.textContent = item.text ?? ""; if (item.accelerator) { const hint = document.createElement("small"); hint.textContent = item.accelerator.replace("CmdOrCtrl+", "⌘"); hint.style.cssText="float:right;margin-left:16px;color:var(--muted)"; button.append(hint); } button.disabled = item.enabled === false;
      button.style.cssText = "display:block;width:100%;text-align:left;height:32px";
      button.onclick = () => { dismiss?.(); item.handler?.onmessage(String(index)); };
      menu.append(button); if (!button.disabled) buttons.push(button);
    }
  }
  const outside = (event: MouseEvent) => { if (!menu.contains(event.target as Node)) dismiss?.(); };
  const key = (event: KeyboardEvent) => {
    event.stopImmediatePropagation();
    if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); dismiss?.(); }
    if (event.key === "Home" || event.key === "End") { event.preventDefault(); buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  };
  dismiss = () => {
    menu.remove(); document.removeEventListener("mousedown", outside, true); window.removeEventListener("keydown", key, true);
    dismiss = undefined; focus?.focus(); finish();
  };
  document.body.append(menu);
  const at = args.at as { x?: number; y?: number } | undefined;
  menu.style.left = `${Math.max(4, Math.min(at?.x ?? point.x, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(at?.y ?? point.y, window.innerHeight - menu.offsetHeight - 4))}px`;
  document.addEventListener("mousedown", outside, true); window.addEventListener("keydown", key, true);
  buttons[0]?.focus();
  return completion;
}
