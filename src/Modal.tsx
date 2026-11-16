import { useEffect, useRef, type ReactNode } from "react";
import { retainPanel } from "./window-retention";
import { isContextMenuOpen } from "./path-actions";
export default function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const working = useRef(busy); working.current = busy;
  useEffect(() => {
    const hold = retainPanel(); void hold.ready.catch((e) => window.dispatchEvent(new CustomEvent("context-error", {detail:String(e)})));
    const restore = document.activeElement as HTMLElement | null;
    const element = dialog.current!; element.showModal();
    const keys = (event: KeyboardEvent) => {
      if (isContextMenuOpen()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (!working.current) close.current(); }
      if (event.key === "Enter" || event.key === "Backspace" || event.metaKey || event.ctrlKey) event.stopPropagation();
    };
    element.addEventListener("keydown", keys);
    return () => { void hold.release().catch(() => {}); element.removeEventListener("keydown", keys); element.close(); if (restore?.isConnected) restore.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="edit-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) { const b = event.currentTarget.getBoundingClientRect(); if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) onClose(); } }}><h2>{title}</h2>{children}</dialog>;
}
