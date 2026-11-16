import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { holdContextMenu, type ContextMenuEntry, type MenuPoint } from "./path-actions";

export default function ContextMenu({ entries, point, onClose, onError }: { entries: ContextMenuEntry[]; point: MenuPoint; onClose: () => void; onError: (message: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: point.x, y: point.y });
  useLayoutEffect(() => {
    const release = holdContextMenu();
    const restore = point.target ?? document.activeElement as HTMLElement | null;
    const menu = root.current!;
    const buttons = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const place = () => { const box = menu.getBoundingClientRect(); setPosition({ x: Math.max(4, Math.min(point.x, innerWidth - box.width - 4)), y: Math.max(4, Math.min(point.y, innerHeight - box.height - 4)) }); };
    place(); buttons()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.isComposing) return;
      if (["Escape", "Tab"].includes(event.key)) { event.preventDefault(); onClose(); return; }
      const options = buttons(); const current = options.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[next]?.focus(); options[next]?.scrollIntoView({ block: "nearest" });
      }
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); options[current]?.click(); }
    };
    const outside = (event: MouseEvent) => { if (!menu.contains(event.target as Node)) onClose(); };
    window.addEventListener("keydown", key, true); document.addEventListener("mousedown", outside, true); window.addEventListener("resize", place);
    return () => { release(); window.removeEventListener("keydown", key, true); document.removeEventListener("mousedown", outside, true); window.removeEventListener("resize", place); if (restore?.isConnected) restore.focus({ preventScroll: true }); };
  }, [point, onClose]);
  return createPortal(<div ref={root} className="context-menu" role="menu" aria-label="操作菜单" style={{ left: position.x, top: position.y }}>
    {entries.map((entry, i) => "action" in entry ? <button key={entry.id ?? i} type="button" role="menuitem" disabled={entry.disabled} onClick={() => { onClose(); void Promise.resolve().then(entry.action).catch((e) => onError(String(e))); }}>{entry.text}{entry.accelerator && <small>{entry.accelerator.replace("CmdOrCtrl+", "⌘")}</small>}</button> : <hr key={i} role="separator" />)}
  </div>, document.body);
}
