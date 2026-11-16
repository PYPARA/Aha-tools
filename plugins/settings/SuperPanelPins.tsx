import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DragDropProvider, useDragDropManager, useDragDropMonitor } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { Accessibility, Feedback, KeyboardSensor, PointerActivationConstraints, PointerSensor, type DragStartEvent, type DragOverEvent, type DragEndEvent } from "@dnd-kit/dom";
import { closestCenter } from "@dnd-kit/collision";
import { AppIcon, WebIcon, PathIcon, CloseIcon, FeatureIcon, invoke, type Config, type Manifest, type SearchItem } from "@ahatools/sdk";

const identity = (item: SearchItem) => `${item.plugin}/${JSON.stringify(item.action.type === "feature" ? { type: "feature", feature: item.action.feature } : item.action)}`;
type Edit = { type: "add" | "remove"; item: SearchItem } | { type: "move"; item: SearchItem; before: SearchItem | null };
const transition = { duration: 180, easing: "ease-out", idle: true };
const sensors = [
  PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })] }),
  KeyboardSensor.configure({ keyboardCodes: { ...KeyboardSensor.defaults.keyboardCodes, start: ["Space"] } }),
];
const plugins: ComponentProps<typeof DragDropProvider>["plugins"] = (defaults) => [
  ...defaults,
  Feedback.configure({ dropAnimation: { duration: 180, easing: "ease-out" }, keyboardTransition: transition }),
  Accessibility.configure({ screenReaderInstructions: { draggable: "按空格提起，用方向键移动，空格或回车放下，Esc 取消。也可用 Option 加左右方向键排序。" }, announcements: {
    dragstart: ({ operation }: DragStartEvent) => `已提起「${operation.source?.data.title ?? "固定项"}」。`,
    dragover: ({ operation }: DragOverEvent) => isSortable(operation.source) ? `移动到第 ${operation.source.index + 1} 个位置。` : undefined,
    dragend: ({ canceled }: DragEndEvent) => canceled ? "已取消排序。" : "已放下固定项。",
  } }),
];

export default function SuperPanelPins({ cfg, manifests }: { cfg: Config; manifests: Manifest[] }) {
  return <DragDropProvider sensors={sensors} plugins={plugins}><Pins cfg={cfg} manifests={manifests} /></DragDropProvider>;
}

function Pins({ cfg, manifests }: { cfg: Config; manifests: Manifest[] }) {
  const manager = useDragDropManager();
  const [items, setItems] = useState(cfg.superPanel.pinned);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [sorting, setSorting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState({ text: "", error: false });
  const [unavailable, setUnavailable] = useState(new Set<string>());
  const snapshot = useRef(items);
  const mounted = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!busyRef.current) setItems(cfg.superPanel.pinned); }, [cfg.superPanel.pinned]);
  useEffect(() => {
    let live = true;
    void invoke<boolean[]>("superpanel_pin_status").then((status) => {
      if (live) setUnavailable(new Set(cfg.superPanel.pinned.filter((_, i) => status[i] === false).map(identity)));
    }).catch(() => { /* A failed availability check must not block editing. */ });
    return () => { live = false; };
  }, [cfg.superPanel.pinned]);
  useEffect(() => {
    mounted.current = true;
    const cancel = () => { if (manager?.dragOperation.status.dragging) manager.actions.stop({ canceled: true }); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && manager && !manager.dragOperation.status.idle) {
        event.preventDefault(); event.stopImmediatePropagation(); cancel();
      }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("keydown", escape, true);
    return () => {
      mounted.current = false; cancel();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("keydown", escape, true);
    };
  }, [manager]);

  const save = async (edit: Edit, optimistic: SearchItem[], message: string) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setNotice({ text: "正在保存…", error: false });
    const previous = items;
    setItems(optimistic);
    try {
      const saved = await invoke<SearchItem[]>("superpanel_edit_pins", { edit });
      if (mounted.current) { setItems(saved); setNotice({ text: message, error: false }); }
      return true;
    } catch (error) {
      let restored = previous;
      try { restored = (await invoke<Config>("config_get")).superPanel.pinned; } catch { /* Keep the last known saved order. */ }
      if (mounted.current) { setItems(restored); setNotice({ text: `没能保存：${String(error)}`, error: true }); }
      return false;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const move = (from: number, to: number, source = items) => {
    if (from === to || to < 0 || to >= source.length || busyRef.current) return;
    const reordered = [...source];
    const [item] = reordered.splice(from, 1); reordered.splice(to, 0, item);
    void save({ type: "move", item, before: reordered[to + 1] ?? null }, reordered, "已保存固定项顺序");
  };
  useDragDropMonitor({
    onBeforeDragStart: (event) => { if (busyRef.current || adding) event.preventDefault(); },
    onDragStart: () => { snapshot.current = items; setSorting(true); setNotice({ text: "", error: false }); },
    onDragEnd: ({ operation, canceled }) => {
      setSorting(false);
      if (!canceled && isSortable(operation.source)) move(operation.source.initialIndex, operation.source.index, snapshot.current);
    },
  });
  const closePicker = () => {
    setAdding(false);
    requestAnimationFrame(() => (addButton.current ?? grid.current)?.focus({ preventScroll: true }));
  };
  return <>
    <div className="super-section-head"><h2>我的面板</h2><span className="note">{items.length} / 12 · 拖动排序</span></div>
    <div ref={grid} tabIndex={-1} className="super-card super-pin-grid" aria-label="我的面板，可拖动排序" data-sorting={sorting || undefined} aria-busy={busy}>
      {items.map((item, i) => <SortablePin key={identity(item)} item={item} index={i} disabled={busy || adding} unavailable={unavailable.has(identity(item))}
        onMove={(to) => move(i, to)} onRemove={() => { void save({ type: "remove", item }, items.filter((p) => identity(p) !== identity(item)), `已移除「${item.title}」`); }}>
        <PinIcon item={item} cfg={cfg} size={34} />
      </SortablePin>)}
      {items.length < 12 && <button ref={addButton} type="button" className="super-pin-cell super-pin-add" disabled={busy || sorting} aria-haspopup="dialog" onClick={() => { setNotice({ text: "", error: false }); setAdding(true); }}><span className="tile">＋</span><span className="super-pin-name">添加</span></button>}
    </div>
    <p className="note super-hint">拖动图标调整顺序；也可按空格提起、方向键移动、回车放下。</p>
    <p className={notice.error ? "bad-text super-pin-status" : "note super-pin-status"} role="status">{notice.text || (items.length === 12 ? "已放满 12 项，移除一项后可继续添加。" : "也可以在搜索结果上右键「固定到超级面板」。")}</p>
    {adding && <PinPicker cfg={cfg} manifests={manifests} pinned={items} busy={busy} error={notice.error ? notice.text : ""} onClose={closePicker}
      onAdd={async (item) => { if (await save({ type: "add", item }, [...items, item], `已添加「${item.title}」`)) closePicker(); }} />}
  </>;
}

function SortablePin({ item, index, disabled, unavailable, onMove, onRemove, children }: {
  item: SearchItem; index: number; disabled: boolean; unavailable: boolean; onMove: (to: number) => void; onRemove: () => void; children: ReactNode;
}) {
  const { ref, handleRef, isDragging } = useSortable({ id: identity(item), index, group: "super-pins", type: "super-pins", accept: "super-pins", data: { title: item.title }, disabled, transition, collisionDetector: closestCenter });
  return <div ref={ref} className="super-pin-cell super-sortable-pin" data-pin-key={identity(item)}>
    <button ref={handleRef} type="button" className="super-pin-handle" aria-label={`${item.title}，第 ${index + 1} 个`} aria-roledescription="可排序的固定项" disabled={disabled}
      onKeyDown={(event) => {
        if (isDragging) return;
        if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onMove(index + (event.key === "ArrowLeft" ? -1 : 1)); }
        else if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onRemove(); }
      }}>
      {children}<span className="super-pin-name">{item.title}</span>{unavailable && <small className="bad-text">已失效</small>}
    </button>
    <button type="button" className="super-pin-x" aria-label={`移除${item.title}`} disabled={disabled || isDragging} onClick={onRemove}><CloseIcon size={10} /></button>
  </div>;
}

function PinPicker({ cfg, manifests, pinned, busy, error, onClose, onAdd }: {
  cfg: Config; manifests: Manifest[]; pinned: SearchItem[]; busy: boolean; error: string; onClose: () => void; onAdd: (item: SearchItem) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ query: string; items: SearchItem[]; error?: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const [retry, setRetry] = useState(0);
  useLayoutEffect(() => {
    const el = dialog.current!;
    el.showModal();
    el.querySelector("input")?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => el.querySelector("input")?.focus({ preventScroll: true }));
    return () => { cancelAnimationFrame(frame); el.close(); };
  }, []);
  useEffect(() => {
    if (!query.trim()) return;
    let live = true;
    const timer = setTimeout(() => {
      void invoke<SearchItem[]>("search", { query }).then((items) => { if (live) setSearch({ query, items }); })
        .catch((reason) => { if (live) setSearch({ query, items: [], error: String(reason) }); });
    }, 120);
    return () => { live = false; clearTimeout(timer); };
  }, [query, retry]);
  const defaults: SearchItem[] = [
    ...manifests.flatMap((m) => m.features.map((f) => ({ title: f.explain, subtitle: m.name, score: 0, plugin: m.id, kind: "feature" as const, action: { type: "feature" as const, feature: f.code } }))),
    ...cfg.webApps.map((w) => ({ title: w.name, subtitle: w.url, score: 0, plugin: "webapps", kind: "feature" as const, icon: w.url, action: { type: "openWeb" as const, id: w.id } })),
  ];
  const loading = Boolean(query.trim() && search?.query !== query);
  const seen = new Set(pinned.map(identity));
  const candidates = (query.trim() ? loading ? [] : search?.items ?? [] : defaults).filter((item) => {
    const key = identity(item);
    if (item.plugin === "superpanel" || item.plugin.startsWith("fallback") || item.action.type === "copy" || seen.has(key)) return false;
    seen.add(key); return true;
  }).map((item) => {
    const action = item.action;
    if (action.type !== "feature") return item;
    const manifest = manifests.find((m) => m.id === item.plugin);
    return { ...item, title: manifest?.features.find((f) => f.code === action.feature)?.explain ?? item.title, subtitle: manifest?.name ?? item.subtitle, action: { type: "feature" as const, feature: action.feature } };
  });
  const active = Math.min(selected, Math.max(0, candidates.length - 1));
  const choose = (item: SearchItem) => { if (!busy && pinned.length < 12) void onAdd(item); };
  useEffect(() => {
    const row = dialog.current?.querySelector<HTMLElement>(`[data-choice="${active}"]`);
    const list = row?.parentElement;
    if (!row || !list) return;
    const rowBox = row.getBoundingClientRect(), listBox = list.getBoundingClientRect();
    if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top;
    else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom;
  }, [active, search]);
  return createPortal(<dialog ref={dialog} className="super-pin-dialog" aria-labelledby="super-pin-dialog-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
    onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Tab") {
        const controls = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
        const last = controls[controls.length - 1];
        const boundary = e.shiftKey ? controls[0] : last;
        if (document.activeElement === boundary) {
          e.preventDefault();
          (e.shiftKey ? last : controls[0])?.focus({ preventScroll: true });
        }
      }
      if (e.key === "Escape") { e.preventDefault(); if (!busy) onClose(); }
      if (e.target instanceof HTMLInputElement) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSelected(Math.max(0, Math.min(candidates.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)))); }
        if (e.key === "Enter") { e.preventDefault(); if (candidates[active]) choose(candidates[active]); }
      }
    }}>
    <div className="super-pin-dialog-body">
      <header><div className="inline"><h2 id="super-pin-dialog-title">添加到我的面板</h2><button className="icon-btn" type="button" aria-label="关闭添加窗口" disabled={busy} onClick={onClose}><CloseIcon /></button></div>
        <p className="note">选择一个功能加入面板，也可以搜索应用和收藏路径。</p>
        <input aria-label="搜索功能、应用或收藏路径" placeholder="搜索功能、应用或收藏路径…" value={query} disabled={busy} onChange={(e) => { setQuery(e.target.value); setSelected(0); }} />
      </header>
      <div className="super-picker-results" aria-label="可添加的功能" aria-busy={busy || loading}>
        {loading ? <p className="super-picker-empty">正在搜索…</p> : search?.query === query && search.error ? <div className="super-picker-empty" role="alert">搜索失败：{search.error}<button className="btn sm" onClick={() => { setSearch(null); setRetry((v) => v + 1); }}>重试</button></div> : candidates.length ? candidates.map((item, i) => <button key={identity(item)} type="button" className="super-pick" data-choice={i} data-active={i === active || undefined} disabled={busy || pinned.length >= 12} aria-label={`添加${item.title}`} onFocus={() => setSelected(i)} onMouseMove={() => setSelected(i)} onClick={() => choose(item)}>
          <PinIcon item={item} cfg={cfg} /><span className="super-pick-info"><b>{item.title}</b><small>{item.subtitle}</small></span><span className="note">添加</span>
        </button>) : <p className="super-picker-empty">没有可添加的结果，试试其他名称。</p>}
      </div>
      {error && <p className="bad-text super-picker-error" role="alert">{error}</p>}
      <footer><span>{pinned.length} / 12 已固定</span><span>{busy ? "正在保存…" : "↑↓ 选择 · ↵ 添加 · esc 取消"}</span></footer>
    </div>
  </dialog>, document.body);
}

function PinIcon({ item, cfg, size = 26 }: { item: SearchItem; cfg: Config; size?: number }) {
  const large = size > 30;
  if (item.action.type === "openSaved") return <span className="tile"><PathIcon kind={item.icon as "file" | "folder" | "link"} /></span>;
  if (item.action.type === "openPath") return item.kind === "app" ? <AppIcon path={item.action.path} name={item.title} large={large} /> : <span className="tile"><PathIcon kind={item.icon as "file" | "folder" | "link"} /></span>;
  if (item.action.type === "openWeb") { const id = item.action.id; const url = cfg.webApps.find((w) => w.id === id)?.url; if (url) return <WebIcon url={url} name={item.title} large={large} />; }
  return <FeatureIcon plugin={item.plugin} feature={item.action.type === "feature" ? item.action.feature : undefined} size={size} />;
}
