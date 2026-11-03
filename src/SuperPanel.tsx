import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppIcon, PathIcon, FeatureIcon, GearIcon, SearchIcon, WebIcon, formatAccelerator, invoke, useAppearance, type Config, type SearchItem } from "@ahatools/sdk";
import "./styles.css";

interface Entry { id: string; title: string; subtitle: string; plugin: string; feature: string; group: string; icon: string; item?: SearchItem }
interface Snapshot {
  requestId: number;
  context: { kind: string; appName: string; paths: string[]; text?: string; notice?: string; permission?: string };
  actions: Entry[]; pinned: Entry[];
}
interface Menu { entry: Entry; x: number; y: number }

const GROUPS: [string, string][] = [["match", "匹配的功能"], ["files", "文件"], ["text", "文字"], ["custom", "自定义动作"]];
/** Under context actions 我的面板 is one row of five: four pins and 「全部」, unless all fit. */
const STRIP = 5;
const pinKey = (i: SearchItem) => `${i.plugin}/${JSON.stringify(i.action.type === "feature" ? { type: "feature", feature: i.action.feature } : i.action)}`;

function Line({ children }: { children: ReactNode }) {
  return <span className="tile super-line" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg></span>;
}
/** AhaTools' own actions keep quiet line icons; plugin features carry the colour. */
const LINE: Record<string, ReactNode> = {
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  terminal: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M7.5 10l3 2.5-3 2.5M12.5 15h4" /></>,
  newfile: <><path d="M6.5 3.5h7l4 4v13h-11z" /><path d="M12 11v6M9 14h6" /></>,
  star: <path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z" /></>,
  command: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  file: <><path d="M6.5 3.5h7l4 4v13h-11z" /><path d="M13.5 3.5v4h4" /></>,
  text: <path d="M5 7h14M5 12h14M5 17h9" />,
  more: <><circle cx="6" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18" cy="12" r="1.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
};

export default function SuperPanel() {
  useAppearance();
  const [state, setState] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [hotkey, setHotkey] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLElement>(null);
  const reported = useRef(0);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    const receive = (s: Snapshot, fresh: boolean) => {
      if (!live) return;
      setState(s); setBusy(false); setMenu(null);
      // Each showing starts at the full height, so the size must be reported again.
      if (fresh) { setSelected(0); setShowAll(false); setMessage(null); reported.current = 0; }
    };
    const config = (c: Config) => {
      setUrls(new Map(c.webApps.map((w) => [w.id, w.url])));
      const b = c.hotkeys.find((b) => b.action.type === "superPanel" && b.enabled);
      setHotkey(b ? formatAccelerator(b.accelerator) : "");
    };
    const subs = [listen<Snapshot>("superpanel-shown", (e) => receive(e.payload, true)), listen<Config>("config-changed", (e) => {
      config(e.payload); void invoke<Snapshot>("superpanel_state").then((s) => receive(s, false));
    })];
    void Promise.all(subs).then(() => invoke<Snapshot>("superpanel_state")).then((s) => receive(s, true));
    void invoke<Config>("config_get").then((c) => { if (live) config(c); });
    return () => { live = false; subs.forEach((s) => { void s.then((f) => f()); }); };
  }, []);

  // The window follows the content's natural height (the native side caps it).
  useLayoutEffect(() => {
    const el = root.current, scroller = body.current;
    if (!el || !scroller) return;
    const report = () => {
      const height = el.offsetHeight - scroller.clientHeight + scroller.scrollHeight;
      if (height !== reported.current) { reported.current = height; void invoke("superpanel_resize", { height }); }
    };
    const observer = new ResizeObserver(report);
    observer.observe(el); Array.from(scroller.children).forEach((c) => observer.observe(c));
    report();
    return () => observer.disconnect();
  });

  useEffect(() => {
    if (!message || message.bad) return;
    const t = setTimeout(() => setMessage(null), 2000); return () => clearTimeout(t);
  }, [message]);
  const run = async (id: string) => {
    if (!state?.requestId || busy) return;
    if (id === "__all") { setShowAll(true); setSelected(0); return; }
    setBusy(true); setMessage(null);
    try { await invoke("superpanel_run", { requestId: state.requestId, actionId: id }); }
    catch (e) { setBusy(false); setMessage({ text: String(e), bad: true }); }
  };
  const ctx = state?.context;
  const hasContext = ctx?.kind === "files" || ctx?.kind === "text";
  const contextual = hasContext && !showAll;
  const handlers = useRef({ run, contextual, menu, showAll, selected });
  handlers.current = { run, contextual, menu, showAll, selected };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const h = handlers.current;
      if (e.key === "Escape") {
        e.preventDefault();
        if (h.menu) setMenu(null);
        else if (h.showAll) { setShowAll(false); setSelected(0); }
        else void invoke("superpanel_hide");
        return;
      }
      if (e.isComposing || e.altKey || e.metaKey || e.ctrlKey || h.menu) return;
      const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-super-action]") ?? []);
      if (e.key === "Enter") {
        if (e.target instanceof Element && e.target.closest("button") && !e.target.closest("[data-super-action]")) return;
        e.preventDefault();
        const id = (e.target as HTMLElement)?.closest<HTMLElement>("[data-super-action]")?.dataset.superAction ?? buttons[h.selected]?.dataset.superAction;
        if (id) void h.run(id); return;
      }
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key) || buttons.length === 0) return;
      e.preventDefault();
      const vertical = e.key === "ArrowDown" || e.key === "ArrowUp";
      const step = !h.contextual && vertical ? 4 : 1;
      const next = Math.max(0, Math.min(buttons.length - 1, h.selected + (e.key === "ArrowDown" || e.key === "ArrowRight" ? step : -step)));
      setSelected(next); buttons[next]?.focus(); buttons[next]?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);

  const icon = (entry: Entry, size: number) => {
    if (entry.icon && LINE[entry.icon]) return <Line>{LINE[entry.icon]}</Line>;
    const item = entry.item;
    if (item?.action.type === "openPath" && item.kind === "app") return <AppIcon path={item.action.path} name={item.title} large />;
    if (item?.action.type === "openPath") return <span className="tile"><PathIcon kind={item.icon as "file" | "folder" | "link"} size={size * .55} /></span>;
    if (item?.action.type === "openWeb") {
      const url = urls.get(item.action.id) ?? item.icon; if (url) return <WebIcon url={url} name={item.title} large />;
    }
    return <FeatureIcon plugin={entry.plugin} feature={entry.feature || undefined} size={size} />;
  };
  const pinnedKeys = new Set((state?.pinned ?? []).flatMap((p) => p.item ? [pinKey(p.item)] : []));
  const openMenu = (e: React.MouseEvent, entry: Entry) => {
    e.preventDefault();
    if (entry.group !== "pin" && !entry.item) return;
    const box = root.current?.getBoundingClientRect();
    setMenu({ entry, x: Math.min(e.clientX, (box?.width ?? 300) - 186), y: Math.min(e.clientY, (box?.height ?? 300) - 84) });
  };
  const togglePin = async (item: SearchItem) => {
    try {
      const pinned = await invoke<boolean>("superpanel_toggle_pin", { item });
      setMessage({ text: pinned ? `已固定「${item.title}」` : `已移除「${item.title}」`, bad: false });
    } catch (e) { setMessage({ text: String(e), bad: true }); }
  };
  const pinAction = async (command: string, entry: Entry) => {
    try { await invoke(command, { index: Number(entry.id.split(":")[1]) }); }
    catch (e) { setMessage({ text: String(e), bad: true }); }
  };

  let index = 0;
  const cell = (entry: Entry, small = false) => {
    const i = index++;
    return <button key={entry.id} type="button" data-super-action={entry.id} className={`super-cell${small ? " small" : ""}`}
      aria-current={selected === i ? "true" : undefined} disabled={busy} title={entry.title}
      onFocus={() => setSelected(i)} onMouseMove={() => setSelected(i)} onClick={() => void run(entry.id)} onContextMenu={(e) => openMenu(e, entry)}>
      {icon(entry, small ? 24 : 34)}<span>{entry.title}</span>
    </button>;
  };
  const row = (entry: Entry) => {
    const i = index++;
    return <button type="button" key={entry.id} data-super-action={entry.id} className="super-action"
      aria-current={selected === i ? "true" : undefined} disabled={busy}
      onFocus={() => setSelected(i)} onMouseMove={() => setSelected(i)} onClick={() => void run(entry.id)} onContextMenu={(e) => openMenu(e, entry)}>
      {icon(entry, 24)}<b>{entry.title}</b>{entry.subtitle && <small>{entry.subtitle}</small>}
    </button>;
  };
  const extra = (id: string, label: string, mark: ReactNode, small = false) => {
    const i = index++;
    return <button key={id} type="button" data-super-action={id} className={`super-cell super-extra${small ? " small" : ""}`}
      aria-current={selected === i ? "true" : undefined} disabled={busy}
      onFocus={() => setSelected(i)} onMouseMove={() => setSelected(i)} onClick={() => void run(id)}>
      <Line>{mark}</Line><span>{label}</span>
    </button>;
  };

  const pinned = state?.pinned ?? [];
  const strip = pinned.length <= STRIP ? pinned : pinned.slice(0, STRIP - 1);
  const title = showAll ? "我的面板"
    : ctx?.kind === "files" ? `访达 · ${ctx.paths.length === 1 ? ctx.paths[0].split("/").filter(Boolean).pop() : `${ctx.paths.length} 个项目`}`
    : ctx?.kind === "text" ? `${ctx.appName} · 选中 ${Array.from(ctx.text ?? "").length} 个字` : "我的面板";
  const mark = showAll || !contextual ? <FeatureIcon plugin="superpanel" size={22} />
    : <Line>{LINE[ctx?.kind === "text" ? "text" : ctx?.paths.length === 1 && !/\.[^/]+$/.test(ctx.paths[0]) ? "folder" : "file"]}</Line>;
  const menuPinned = menu?.entry.item ? pinnedKeys.has(pinKey(menu.entry.item)) : false;
  const menuIndex = menu?.entry.group === "pin" ? Number(menu.entry.id.split(":")[1]) : -1;
  return <div className="super-panel" ref={root} onClick={() => menu && setMenu(null)}>
    <header className="super-head">{mark}<strong title={title}>{title}</strong>
      {showAll && hasContext && <button type="button" className="btn ghost sm" onClick={() => { setShowAll(false); setSelected(0); }}>返回</button>}
      <button className="icon-btn" aria-label="打开搜索面板" onClick={() => void run("search-panel")}><SearchIcon size={15} /></button>
      <button className="icon-btn" aria-label="超级面板设置" onClick={() => void run("settings")}><GearIcon size={15} /></button>
    </header>
    <main className="super-body" ref={body}>
      {ctx?.notice && <p className="super-notice" role="status">{ctx.notice}<button type="button" className="btn ghost sm" onClick={() => void invoke("open_path", { path: ctx.permission === "automation" ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation" : "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" })}>打开授权设置</button></p>}
      {message && <p className={`super-notice${message.bad ? " bad-text" : ""}`} role={message.bad ? "alert" : "status"}>{message.text}</p>}
      {contextual && ctx?.kind === "text" && ctx.text && <p className="super-quote"><span>{ctx.text}</span></p>}
      {contextual ? GROUPS.map(([group, label]) => {
        const entries = state?.actions.filter((a) => a.group === group) ?? [];
        return entries.length > 0 && <section key={group} className="super-group" aria-label={label}><h2>{label}</h2>{entries.map(row)}</section>;
      }) : <div className="super-grid" aria-label="我的面板">{pinned.map((p) => cell(p))}
        {pinned.length < 12 && extra("pin-hint", "固定", LINE.plus)}
      </div>}
    </main>
    {contextual && pinned.length > 0 && <div className="super-strip" aria-label="我的面板"><h2>我的面板</h2><div>
      {strip.map((p) => cell(p, true))}{pinned.length > STRIP && extra("__all", `全部 ${pinned.length}`, LINE.more, true)}
    </div></div>}
    {menu && <div className="super-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
      {menu.entry.group === "pin" ? <>
        {menuIndex > 0 && <button type="button" role="menuitem" onClick={() => { setMenu(null); void pinAction("superpanel_pin_first", menu.entry); }}>移到最前</button>}
        <button type="button" role="menuitem" onClick={() => { setMenu(null); void pinAction("superpanel_remove_pin", menu.entry); }}>从超级面板移除</button>
      </> : menu.entry.item && <>
        <button type="button" role="menuitem" onClick={() => { const item = menu.entry.item!; setMenu(null); void togglePin(item); }}>{menuPinned ? "从超级面板移除" : "固定到超级面板"}</button>
        {menu.entry.item.action.type === "feature" && <><hr /><button type="button" role="menuitem" onClick={() => { setMenu(null); void run(`plugin-settings:${menu.entry.plugin}`); }}>插件设置…</button></>}
      </>}
    </div>}
    <footer className="super-foot">{hotkey ? `${hotkey} 呼出 · ` : ""}↑↓ 选择 · ↵ 执行 · esc {showAll && hasContext ? "返回" : "关闭"}</footer>
  </div>;
}
