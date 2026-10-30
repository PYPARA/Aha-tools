import { useEffect, useRef, type ReactNode } from "react";

/** Native HTML dialog supplies focus containment and restores the opener's focus. */
export default function Dialog({ title, children, onClose, busy = false }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const state = useRef({ busy, onClose });
  state.current = { busy, onClose };
  useEffect(() => {
    const element = ref.current!;
    element.showModal();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!state.current.busy) state.current.onClose();
      } else if (event.metaKey && [",", "s"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      element.close();
    };
  }, []);
  return (
    <dialog ref={ref} className="hosts-dialog" aria-labelledby="hosts-dialog-title" aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="hosts-dialog-head">
        <h2 id="hosts-dialog-title">{title}</h2>
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>关闭</button>
      </div>
      {children}
    </dialog>
  );
}
