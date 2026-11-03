import { useEffect, useRef, useState } from "react";
import { AppIcon, WebIcon, PathIcon, CloseIcon, FeatureIcon, HotkeyRecorder, Switch, invoke, type Binding, type CustomAction, type Config, type SearchItem } from "@ahatools/sdk";
import Row from "./Row";
import type { SectionProps } from "./Settings";

const TYPES = [["file", "文件"], ["folder", "文件夹"], ["image", "图片"], ["text", "文字"]] as const;
const identity = (i: SearchItem) => `${i.plugin}/${JSON.stringify(i.action.type === "feature" ? { type: "feature", feature: i.action.feature } : i.action)}`;

export default function SuperPanelSettings({ cfg, save, manifests, onOpenPlugins }: SectionProps & { onOpenPlugins: () => void }) {
  const settings = cfg.superPanel;
  const [editing, setEditing] = useState<CustomAction | null>(null);
  const [editorError, setEditorError] = useState("");
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [available, setAvailable] = useState<boolean[]>([]);
  const [trusted, setTrusted] = useState(true);
  const [saving, setSaving] = useState(false);
  const dragging = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [more, setMore] = useState<string | null>(null);
  const editor = useRef<HTMLElement>(null);
  const binding = cfg.hotkeys.findIndex((b) => b.action.type === "superPanel");
  const hotkey = cfg.hotkeys[binding];
  const update = (patch: Partial<typeof settings>) => save({ ...cfg, superPanel: { ...settings, ...patch } });
  const updateBinding = (patch: Partial<Binding>) => {
    const base: Binding = hotkey ?? { action: { type: "superPanel" }, accelerator: "Alt+Shift+Space", enabled: false };
    save({ ...cfg, hotkeys: binding < 0 ? [...cfg.hotkeys, { ...base, ...patch }] : cfg.hotkeys.map((b, i) => i === binding ? { ...b, ...patch } : b) });
  };
  useEffect(() => {
    let live = true;
    void invoke<boolean[]>("superpanel_pin_status").then((v) => { if (live) setAvailable(v); });
    return () => { live = false; };
  }, [settings.pinned]);
  useEffect(() => { void invoke<{ trusted: boolean }>("hotkey_status").then((s) => setTrusted(s.trusted)); }, [settings.longPressRight]);
  useEffect(() => {
    if (!more) return;
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest?.(".super-more")) setMore(null); };
    window.addEventListener("mousedown", close); return () => window.removeEventListener("mousedown", close);
  }, [more]);
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => { if (query.trim()) void invoke<SearchItem[]>("search", { query }).then((r) => { if (!stale) setResults(r); }); }, 120);
    return () => { stale = true; clearTimeout(timer); };
  }, [query]);
  const defaults: SearchItem[] = [
    ...manifests.filter((m) => m.id !== "superpanel").flatMap((m) => m.features.map((f) => ({ title: f.explain, subtitle: m.name, score: 0, plugin: m.id, kind: "feature" as const, action: { type: "feature" as const, feature: f.code } }))),
    ...cfg.webApps.map((w) => ({ title: w.name, subtitle: w.url, score: 0, plugin: "webapps", kind: "feature" as const, icon: w.url, action: { type: "openWeb" as const, id: w.id } })),
  ];
  const candidates = (query.trim() ? results : defaults).filter((i) => i.plugin !== "superpanel" && !settings.pinned.some((p) => identity(p) === identity(i)));
  const add = (item: SearchItem) => {
    if (settings.pinned.length >= 12) return;
    if (item.action.type === "feature") {
      const m = manifests.find((m) => m.id === item.plugin); const feature = item.action.feature;
      item = { ...item, title: m?.features.find((f) => f.code === feature)?.explain ?? item.title, subtitle: m?.name ?? item.subtitle, score: 0, action: { type: "feature", feature } };
    }
    update({ pinned: [...settings.pinned, item] });
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= settings.pinned.length || from === to) return;
    const pinned = [...settings.pinned]; const [item] = pinned.splice(from, 1); pinned.splice(to, 0, item); update({ pinned });
  };
  const commit = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.when.length) { setEditorError("请输入名称并选择至少一种适用类型"); return; }
    setSaving(true); setEditorError("");
    try {
      await invoke("superpanel_validate_command", { command: editing.command });
      const action = { ...editing, name: editing.name.trim() };
      update({ actions: settings.actions.some((a) => a.id === action.id) ? settings.actions.map((a) => a.id === action.id ? action : a) : [...settings.actions, action] });
      setEditing(null);
    } catch (e) { setEditorError(String(e)); } finally { setSaving(false); }
  };
  const remove = (i: number) => update({ pinned: settings.pinned.filter((_, j) => j !== i) });
  return <>
    <div className="content-head"><span><h1 className="page-h1">超级面板</h1><span className="note">在鼠标旁边处理选中的文字和文件</span></span></div>
    <div className="super-card">
      <Row title="呼出热键" desc="面板出现在鼠标旁边">
        <HotkeyRecorder value={hotkey?.accelerator ?? ""} onChange={(accelerator) => updateBinding({ accelerator, enabled: true })} />
        <Switch label="启用超级面板热键" checked={hotkey?.enabled ?? false} disabled={!hotkey?.accelerator} onChange={(enabled) => updateBinding({ enabled })} />
      </Row>
      <Row title="长按鼠标右键呼出" desc="按住约 0.4 秒；短按和右键拖动不受影响">
        <Switch label="长按鼠标右键呼出" checked={settings.longPressRight} onChange={(longPressRight) => update({ longPressRight })} />
      </Row>
      <Row title="匹配的功能" desc="按各插件的「自动匹配」开关决定是否出现">
        <button type="button" className="btn sm" onClick={onOpenPlugins}>在已安装插件中管理</button>
      </Row>
    </div>
    {!trusted && <div className="banner">读取选中文字和长按右键需要辅助功能权限。<button className="btn ghost sm" onClick={() => void invoke("hotkey_request_access")}>去授权</button></div>}
    {hotkey && !hotkey.enabled && cfg.hotkeys.some((b, i) => i !== binding && b.enabled && b.accelerator === hotkey.accelerator) && <div className="banner">呼出热键与其他动作重复，请更换后启用。</div>}
    <div className="super-section-head"><h2>我的面板</h2><span className="note">{settings.pinned.length} / 12 · 拖动排序</span></div>
    <div className="super-card super-pin-grid" aria-label="我的面板，拖动排序">{settings.pinned.map((item, i) => <div className="super-pin-cell" key={identity(item)} draggable tabIndex={0}
      aria-label={`${item.title}，第 ${i + 1} 个。⌥← ⌥→ 移动，Delete 移除`} data-dragging={dragOver === i ? "over" : undefined}
      onDragStart={(e) => { dragging.current = i; e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { dragging.current = null; setDragOver(null); }}
      onDragOver={(e) => { e.preventDefault(); if (dragging.current !== null && dragging.current !== i) setDragOver(i); }} onDragLeave={() => setDragOver((v) => v === i ? null : v)}
      onDrop={(e) => { e.preventDefault(); if (dragging.current !== null) move(dragging.current, i); dragging.current = null; setDragOver(null); }}
      onKeyDown={(e) => {
        if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); move(i, i - 1); }
        else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); move(i, i + 1); }
        else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(i); }
      }}>
      <PinIcon item={item} cfg={cfg} size={34} />
      <span className="super-pin-name">{item.title}</span>
      {available[i] === false && <small className="bad-text">已失效</small>}
      <button type="button" className="super-pin-x" aria-label={`移除${item.title}`} onClick={() => remove(i)}><CloseIcon size={10} /></button>
    </div>)}
      {settings.pinned.length < 12 && <button type="button" className="super-pin-cell super-pin-add" aria-expanded={adding} onClick={() => setAdding((v) => !v)}><span className="tile">＋</span><span className="super-pin-name">添加</span></button>}
    </div>
    <p className="note super-hint">也可以在搜索结果上右键「固定到超级面板」。悬停格子出现 × 移除。</p>
    {adding && <div className="super-picker"><label>搜索应用、指令或收藏路径<input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入名称…" /></label>
      <div className="super-picker-results">{candidates.map((item) => <button key={identity(item)} className="super-pick" disabled={settings.pinned.length >= 12} onClick={() => add(item)}><PinIcon item={item} cfg={cfg} /><span>{item.title}<small>{item.subtitle}</small></span><span>＋</span></button>)}{!candidates.length && <p className="note">没有可添加的结果</p>}</div>
      <button className="btn ghost sm" onClick={() => setAdding(false)}>完成</button></div>}
    <div className="super-section-head"><h2>自定义动作</h2><button className="btn sm" onClick={() => { setEditing({ id: crypto.randomUUID(), name: "", command: "", when: ["file", "folder"], enabled: false }); setEditorError(""); }}>＋ 新建动作</button></div>
    {settings.actions.length > 0 && <div className="super-card">{settings.actions.map((a) => <div key={a.id} className="super-custom-row">
      <button className="super-custom-edit" onClick={() => { setEditing({ ...a, when: [...a.when] }); setEditorError(""); }}><b>{a.name}</b><code>{a.command}</code></button>
      <span className="chip">{a.when.map((t) => TYPES.find(([k]) => k === t)?.[1]).join(" · ")}</span>
      <Switch label={`启用${a.name}`} checked={a.enabled} onChange={(enabled) => update({ actions: settings.actions.map((x) => x.id === a.id ? { ...x, enabled } : x) })} />
      <span className="super-more">
        <button className="icon-btn sm" aria-label={`${a.name}的更多操作`} aria-expanded={more === a.id} onClick={() => setMore((v) => v === a.id ? null : a.id)}><MoreIcon /></button>
        {more === a.id && <span className="super-more-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMore(null); setEditing({ ...a, when: [...a.when] }); setEditorError(""); }}>编辑</button>
          <button type="button" role="menuitem" className="bad-text" onClick={() => { setMore(null); update({ actions: settings.actions.filter((x) => x.id !== a.id) }); }}>删除</button>
        </span>}
      </span>
    </div>)}</div>}
    <p className="note super-hint">命令在后台执行，支持 {"{path}、{dir}、{text}、{name}"}；占位符单独作为参数，不要加引号。需要长期运行时，请让命令打开终端。</p>
    {editing && <section ref={editor} className="super-editor" role="dialog" aria-label="编辑动作" aria-modal="true" onKeyDown={(e) => { if (e.key === "Tab") {
      const items = editor.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea');
      if (items?.length) { const first=items[0], last=items[items.length-1]; if (e.shiftKey && document.activeElement===first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement===last) { e.preventDefault(); first.focus(); } }
    } if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }}>
      <h2>编辑动作</h2><label>名称<input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
      <label>命令<textarea className="mono" value={editing.command} onChange={(e) => setEditing({ ...editing, command: e.target.value })} placeholder="code {path}" rows={5} /></label>
      <span className="note">正确：code {"{path}"}；无需给占位符加引号。</span>
      <fieldset><legend>适用于</legend>{TYPES.map(([key, name]) => <label key={key}><input type="checkbox" checked={editing.when.includes(key)} onChange={(e) => setEditing({ ...editing, when: e.target.checked ? [...editing.when, key] : editing.when.filter((t) => t !== key) })} />{name}</label>)}</fieldset>
      {editorError && <p className="bad-text" role="alert">{editorError}</p>}
      <div className="inline"><button className="btn primary" disabled={saving} onClick={() => void commit()}>保存动作</button><button className="btn" onClick={() => setEditing(null)}>取消</button></div>
    </section>}
  </>;
}

const MoreIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="18" cy="12" r="1.5" /></svg>;

function PinIcon({ item, cfg, size = 26 }: { item: SearchItem; cfg: Config; size?: number }) {
  const large = size > 30;
  if (item.action.type === "openPath") return item.kind === "app" ? <AppIcon path={item.action.path} name={item.title} large={large} /> : <span className="tile"><PathIcon kind={item.icon as "file" | "folder" | "link"} /></span>;
  if (item.action.type === "openWeb") { const id = item.action.id; const url = cfg.webApps.find((w) => w.id === id)?.url; if (url) return <WebIcon url={url} name={item.title} large={large} />; }
  return <FeatureIcon plugin={item.plugin} feature={item.action.type === "feature" ? item.action.feature : undefined} size={size} />;
}
