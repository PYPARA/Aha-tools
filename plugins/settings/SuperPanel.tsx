import { useEffect, useRef, useState } from "react";
import { HotkeyRecorder, Switch, invoke, type Binding, type CustomAction } from "@ahatools/sdk";
import Row from "./Row";
import SuperPanelPins from "./SuperPanelPins";
import type { SectionProps } from "./Settings";

const TYPES = [["file", "文件"], ["folder", "文件夹"], ["image", "图片"], ["text", "文字"]] as const;
// These are the panel's own context actions, outside the plugin feature registry.
const BUILTIN_GROUPS = [
  { name: "文件", actions: [
    { name: "复制路径", description: "文件或文件夹；多选时每项占一行" },
    { name: "复制文件名", description: "文件或文件夹；保留扩展名" },
    { name: "在终端中打开", description: "用系统终端打开文件夹或文件所在目录；多选需在同一目录" },
    { name: "新建空白文件", description: "单个文件夹；创建未命名.txt，重名时加序号" },
    { name: "收藏到快捷启动", description: "文件或文件夹；支持一次收藏多项" },
  ] },
  { name: "文字", actions: [
    { name: "在搜索面板中打开", description: "将选中文字带入搜索框" },
    { name: "复制为纯文本", description: "复制选中文字，去除原有格式" },
    { name: "在浏览器中打开", description: "选中完整的 HTTP 或 HTTPS 网址时出现" },
    { name: "问网页应用", description: "每个网页应用一项；先复制文字，再打开网页" },
  ] },
];

export default function SuperPanelSettings({ cfg, save, manifests, onOpenPlugins }: SectionProps & { onOpenPlugins: () => void }) {
  const settings = cfg.superPanel;
  const [editing, setEditing] = useState<CustomAction | null>(null);
  const [editorError, setEditorError] = useState("");
  const [trusted, setTrusted] = useState(true);
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState<string | null>(null);
  const editor = useRef<HTMLElement>(null);
  const binding = cfg.hotkeys.findIndex((b) => b.action.type === "superPanel");
  const hotkey = cfg.hotkeys[binding];
  const update = (patch: Partial<typeof settings>) => save({ ...cfg, superPanel: { ...settings, ...patch } });
  const updateBinding = (patch: Partial<Binding>) => {
    const base: Binding = hotkey ?? { action: { type: "superPanel" }, accelerator: "Alt+Shift+Space", enabled: false };
    save({ ...cfg, hotkeys: binding < 0 ? [...cfg.hotkeys, { ...base, ...patch }] : cfg.hotkeys.map((b, i) => i === binding ? { ...b, ...patch } : b) });
  };
  useEffect(() => { void invoke<{ trusted: boolean }>("hotkey_status").then((s) => setTrusted(s.trusted)); }, [settings.longPressRight]);
  useEffect(() => {
    if (!more) return;
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest?.(".super-more")) setMore(null); };
    window.addEventListener("mousedown", close); return () => window.removeEventListener("mousedown", close);
  }, [more]);
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
    <SuperPanelPins cfg={cfg} manifests={manifests} />
    <section aria-labelledby="super-builtins-heading">
      <div className="super-section-head"><h2 id="super-builtins-heading">内置动作</h2></div>
      <p className="note super-builtin-hint">根据选中的内容自动出现，不占「我的面板」名额。</p>
      <div className="super-builtin-groups">{BUILTIN_GROUPS.map((group) => <section key={group.name} className="super-card super-builtin-card" aria-label={`${group.name}内置动作`}>
        <h3>{group.name}</h3>
        <ul>{group.actions.map((action) => <li key={action.name}>
          <span className="row-title">{action.name}</span>
          <span className="row-desc">{action.description}</span>
        </li>)}</ul>
      </section>)}</div>
    </section>
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
