import { useEffect, useRef, useState } from "react";
import { AppIcon, WebIcon, PathIcon, CloseIcon, FeatureIcon, HotkeyRecorder, Switch, invoke, type Binding, type CustomAction, type Config, type SearchItem } from "@ahatools/sdk";
import Row from "./Row";
import type { SectionProps } from "./Settings";

const TYPES = [["file", "文件"], ["folder", "文件夹"], ["image", "图片"], ["text", "文字"]] as const;
const identity = (i: SearchItem) => `${i.plugin}/${JSON.stringify(i.action.type === "feature" ? { type: "feature", feature: i.action.feature } : i.action)}`;

export default function SuperPanelSettings({ cfg, save, manifests }: SectionProps) {
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
  return <>
    <div className="content-head"><span><h1 className="page-h1">超级面板</h1><span className="note">在鼠标旁使用选中文字和文件</span></span></div>
    <div className="card">
      <Row title="呼出热键" desc="面板出现在鼠标所在的屏幕">
        <HotkeyRecorder value={hotkey?.accelerator ?? ""} onChange={(accelerator) => updateBinding({ accelerator, enabled: true })} />
        <Switch label="启用超级面板热键" checked={hotkey?.enabled ?? false} disabled={!hotkey?.accelerator} onChange={(enabled) => updateBinding({ enabled })} />
      </Row>
      <Row title="长按鼠标右键呼出" desc="按住约 0.4 秒；短按和右键拖动保持原有操作">
        <Switch label="长按鼠标右键呼出" checked={settings.longPressRight} onChange={(longPressRight) => update({ longPressRight })} />
      </Row>
    </div>
    {!trusted && <div className="banner">读取选中文字和长按右键需要辅助功能权限。<button className="btn ghost sm" onClick={() => void invoke("hotkey_request_access")}>去授权</button></div>}
    {hotkey && !hotkey.enabled && cfg.hotkeys.some((b, i) => i !== binding && b.enabled && b.accelerator === hotkey.accelerator) && <div className="banner">呼出热键与其他动作重复，请更换后启用。</div>}
    <div className="super-section-head"><h2>我的面板</h2><span className="note">拖动排序 · {settings.pinned.length} / 12</span><button className="btn sm" disabled={settings.pinned.length >= 12} onClick={() => setAdding((v) => !v)}>添加功能</button></div>
    <div className="super-pins" aria-label="固定功能排序">{settings.pinned.map((item, i) => <div className="super-pin" key={identity(item)} draggable
      onDragStart={() => { dragging.current = i; }} onDragEnd={() => { dragging.current = null; }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (dragging.current !== null) move(dragging.current, i); dragging.current = null; }}>
      <PinIcon item={item} cfg={cfg} />
      <span className="super-pin-name">{item.title}{available[i] === false && <small className="bad-text">已失效</small>}</span>
      <button className="icon-btn sm" disabled={i === 0} aria-label={`前移${item.title}`} onClick={() => move(i, i - 1)}>←</button>
      <button className="icon-btn sm" disabled={i === settings.pinned.length - 1} aria-label={`后移${item.title}`} onClick={() => move(i, i + 1)}>→</button>
      <button className="icon-btn sm" aria-label={`移除${item.title}`} onClick={() => update({ pinned: settings.pinned.filter((_, j) => j !== i) })}><CloseIcon /></button>
    </div>)}</div>
    {settings.pinned.length === 0 && <p className="note">添加常用功能，下次呼出就能直接使用。</p>}
    {adding && <div className="super-picker"><label>搜索应用、指令或收藏路径<input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入名称…" /></label>
      <div className="super-picker-results">{candidates.map((item) => <button key={identity(item)} className="super-pick" disabled={settings.pinned.length >= 12} onClick={() => add(item)}><PinIcon item={item} cfg={cfg} /><span>{item.title}<small>{item.subtitle}</small></span><span>＋</span></button>)}{!candidates.length && <p className="note">没有可添加的结果</p>}</div>
      <button className="btn ghost sm" onClick={() => setAdding(false)}>完成</button></div>}
    <div className="super-section-head"><h2>自定义动作</h2><button className="btn sm" onClick={() => { setEditing({ id: crypto.randomUUID(), name: "", command: "", when: ["file", "folder"], enabled: false }); setEditorError(""); }}>新建动作</button></div>
    <div className="card">{settings.actions.map((a) => <div key={a.id} className="super-custom-row"><button className="super-custom-edit" onClick={() => { setEditing({ ...a, when: [...a.when] }); setEditorError(""); }}><b>{a.name}</b><code>{a.command}</code><small>{a.when.map((t) => TYPES.find(([k]) => k === t)?.[1]).join(" · ")}</small></button><Switch label={`启用${a.name}`} checked={a.enabled} onChange={(enabled) => update({ actions: settings.actions.map((x) => x.id === a.id ? { ...x, enabled } : x) })} /><button className="icon-btn sm" aria-label={`删除${a.name}`} onClick={() => update({ actions: settings.actions.filter((x) => x.id !== a.id) })}><CloseIcon /></button></div>)}</div>
    <p className="note">命令在后台执行。支持 {"{path}、{dir}、{text}、{name}"}，占位符单独作为参数，不要加引号。需要长期运行时，请让命令打开终端。</p>
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

function PinIcon({ item, cfg }: { item: SearchItem; cfg: Config }) {
  if (item.action.type === "openPath") return item.kind === "app" ? <AppIcon path={item.action.path} name={item.title} /> : <span className="tile"><PathIcon kind={item.icon as "file" | "folder" | "link"} /></span>;
  if (item.action.type === "openWeb") { const id = item.action.id; const url = cfg.webApps.find((w) => w.id === id)?.url; if (url) return <WebIcon url={url} name={item.title} />; }
  return <FeatureIcon plugin={item.plugin} feature={item.action.type === "feature" ? item.action.feature : undefined} size={26} />;
}
