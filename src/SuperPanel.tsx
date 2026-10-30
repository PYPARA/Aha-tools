import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppIcon, PathIcon, FeatureIcon, GearIcon, SearchIcon, WebIcon, formatAccelerator, invoke, useAppearance, type Config, type SearchItem } from "@ahatools/sdk";
import "./styles.css";

interface Entry { id: string; title: string; subtitle: string; plugin: string; feature: string; item?: SearchItem }
interface Snapshot {
  requestId: number;
  context: { kind: string; appName: string; paths: string[]; text?: string; notice?: string; permission?: string };
  actions: Entry[]; pinned: Entry[];
}
export default function SuperPanel() {
  useAppearance();
  const [state, setState] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [hotkey, setHotkey] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    const receive = (s: Snapshot) => { if (live) { setState(s); setSelected(0); setBusy(false); setMenu(null); setError(""); } };
    const config = (c: Config) => {
      setUrls(new Map(c.webApps.map((w) => [w.id, w.url])));
      const b = c.hotkeys.find((b) => b.action.type === "superPanel" && b.enabled);
      setHotkey(b ? formatAccelerator(b.accelerator) : "");
    };
    const subs = [listen<Snapshot>("superpanel-shown", (e) => receive(e.payload)), listen<Config>("config-changed", (e) => {
      config(e.payload); void invoke<Snapshot>("superpanel_state").then(receive);
    })];
    void Promise.all(subs).then(() => invoke<Snapshot>("superpanel_state")).then(receive);
    void invoke<Config>("config_get").then((c) => { if (live) config(c); });
    return () => { live = false; subs.forEach((s) => { void s.then((f) => f()); }); };
  }, []);
  const run = async (id: string) => {
    if (!state?.requestId || busy) return;
    setBusy(true); setError("");
    try { await invoke("superpanel_run", { requestId: state.requestId, actionId: id }); }
    catch (e) { setBusy(false); setError(String(e)); }
  };
  const entries = state ? [...state.actions, ...state.pinned] : [];
  const contextual = state?.context.kind === "files" || state?.context.kind === "text";
  const handlers = useRef({ run, entries, selected, contextual, menu });
  handlers.current = { run, entries, selected, contextual, menu };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const h = handlers.current;
      if (e.key === "Escape") { e.preventDefault(); if (h.menu) setMenu(null); else void invoke("superpanel_hide"); return; }
      if (e.isComposing || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "Enter") {
        if (e.target instanceof Element && e.target.closest("button") && !e.target.closest("[data-super-action]")) return;
        e.preventDefault(); const id = (e.target as HTMLElement)?.closest<HTMLElement>("[data-super-action]")?.dataset.superAction ?? h.entries[h.selected]?.id;
        if (id) void h.run(id); return;
      }
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key) || h.entries.length === 0) return;
      e.preventDefault(); const step = !h.contextual && ["ArrowDown", "ArrowUp"].includes(e.key) ? 3 : 1;
      const next = Math.max(0, Math.min(h.entries.length - 1, h.selected + (["ArrowDown", "ArrowRight"].includes(e.key) ? step : -step)));
      setSelected(next);
      const target = root.current?.querySelectorAll<HTMLButtonElement>("[data-super-action]")[next];
      target?.focus(); target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  const icon = (entry: Entry) => {
    const item = entry.item;
    if (item?.action.type === "openPath" && item.kind === "app") return <AppIcon path={item.action.path} name={item.title} large />;
    if (item?.action.type === "openPath") return <span className="tile"><PathIcon kind={item.icon as "file" | "folder" | "link"} size={20} /></span>;
    if (item?.action.type === "openWeb") {
      const url = urls.get(item.action.id); if (url) return <WebIcon url={url} name={item.title} large />;
    }
    return <FeatureIcon plugin={entry.plugin} feature={entry.feature} size={38} />;
  };
  const cell = (entry: Entry, i: number, compact = false) => <button key={entry.id} type="button" data-super-action={entry.id}
    className={`super-cell${compact ? " compact" : ""}`} aria-current={selected === i ? "true" : undefined}
    disabled={busy} title={entry.title} onFocus={() => setSelected(i)} onClick={() => void run(entry.id)}
    onContextMenu={(e) => { e.preventDefault(); setMenu(entry.id); }}>
    {icon(entry)}{!compact && <span>{entry.title}</span>}
  </button>;
  const ctx = state?.context;
  const title = ctx?.kind === "files" ? `访达 · ${ctx.paths.length === 1 ? ctx.paths[0].split("/").filter(Boolean).pop() : `${ctx.paths.length} 个项目`}`
    : ctx?.kind === "text" ? `${ctx.appName} · 选中 ${Array.from(ctx.text ?? "").length} 个字` : "我的面板";
  return <div className="super-panel" ref={root}>
    <header className="super-head"><FeatureIcon plugin="superpanel" size={22} /><strong title={title}>{title}</strong>
      <button className="icon-btn" aria-label="打开搜索面板" onClick={() => void run("search-panel")}><SearchIcon size={16} /></button>
      <button className="icon-btn" aria-label="超级面板设置" onClick={() => void run("settings")}><GearIcon /></button>
    </header>
    <main className="super-body" onClick={() => menu && setMenu(null)}>
      {ctx?.notice && <p className="super-notice" role="status">{ctx.notice}<button type="button" className="btn ghost sm" onClick={() => void invoke("open_path", { path: ctx.permission === "automation" ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation" : "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" })}>打开授权设置</button></p>}
      {error && <p className="super-notice bad-text" role="alert">{error}</p>}
      {contextual ? <div className="super-actions" aria-label="上下文动作">{state.actions.map((entry, i) => <button type="button" key={entry.id} data-super-action={entry.id} className="super-action"
        aria-current={selected === i ? "true" : undefined} disabled={busy} onFocus={() => setSelected(i)} onClick={() => void run(entry.id)}>
        <FeatureIcon plugin={entry.plugin} feature={entry.feature} size={26} /><span><b>{entry.title}</b><small>{entry.subtitle}</small></span>
      </button>)}</div> : <div className="super-grid" aria-label="我的面板">{state?.pinned.map((entry, i) => cell(entry, i))}
        {(state?.pinned.length ?? 0) < 12 && <button className="super-cell super-add" onClick={() => void run("settings")}><span aria-hidden="true">＋</span>添加</button>}
      </div>}
    </main>
    {contextual && <div className="super-bottom"><span>我的面板</span><div>{state.pinned.map((entry, i) => cell(entry, state.actions.length + i, true))}</div></div>}
    {menu && <div className="super-pin-menu" role="menu"><button type="button" role="menuitem" onClick={() => {
      void invoke("superpanel_remove_pin", { index: Number(menu.split(":")[1]) }).catch((e) => setError(String(e))); setMenu(null);
    }}>从我的面板移除</button><button type="button" role="menuitem" onClick={() => setMenu(null)}>取消</button></div>}
    <footer className="super-foot">{hotkey ? `${hotkey} 呼出 · ` : ""}esc 关闭</footer>
  </div>;
}
