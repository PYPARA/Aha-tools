// The web apps plugin's 设置 tab: the sites, each with an optional hotkey.

import { useState } from "react";
import { CloseIcon, HotkeyRecorder, WebIcon, invoke, itemMenuEntries, showContextMenu, menuPoint, type Config, type PluginSettingsProps, type WebApp } from "@ahatools/sdk";

import Modal from "../../src/Modal";

/** "Kimi" → "kimi", unique among `taken`. */
function newId(name: string, taken: string[]) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/** Adds https:// when it was left out; null when it isn't a web address. */
function normalizeUrl(raw: string) {
  const text = raw.trim();
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function WebAppsSettings({ cfg, save, route }: PluginSettingsProps) {
  const [routeAction, routeId] = (route ?? "").split("/");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<WebApp | null>(() => routeAction === "edit" ? cfg.webApps.find((w) => w.id === decodeURIComponent(routeId ?? "")) ?? null : null);
  const [recording, setRecording] = useState<string | null>(routeAction === "hotkey" ? decodeURIComponent(routeId ?? "") : null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [keywords, setKeywords] = useState("");
  const [error, setError] = useState("");

  const hotkeyIndex = (w: WebApp) =>
    cfg.hotkeys.findIndex((b) => b.action.type === "openWeb" && b.action.id === w.id);

  const setHotkey = (w: WebApp, accelerator: string) => {
    const i = hotkeyIndex(w);
    const hotkeys =
      i >= 0
        ? cfg.hotkeys.map((b, j) => (j === i ? { ...b, accelerator, enabled: true } : b))
        : [...cfg.hotkeys, { accelerator, action: { type: "openWeb" as const, id: w.id }, enabled: true }];
    setRecording(null); save({ ...cfg, hotkeys });
  };

  const remove = (w: WebApp) =>
    save({
      ...cfg,
      webApps: cfg.webApps.filter((x) => x.id !== w.id),
      // Its hotkey would point at nothing.
      hotkeys: cfg.hotkeys.filter((b) => !(b.action.type === "openWeb" && b.action.id === w.id)),
    } as Config);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const full = normalizeUrl(url);
    if (!name.trim() || !full) {
      setError(!name.trim() ? "填一个名称" : "网址不对，例如 https://kimi.com");
      return;
    }
    const web: WebApp = {
      id: newId(name, cfg.webApps.map((w) => w.id)),
      name: name.trim(),
      url: full,
      keywords: keywords.split(/[,，\s]+/).filter(Boolean),
    };
    save({ ...cfg, webApps: [...cfg.webApps, web] });
    setRecording(null);
    setName("");
    setUrl("");
    setKeywords("");
    setError("");
  };

  return (
    <>
      <p className="note tab-note">在搜索框输入名称或关键词打开，也可从程序坞切换已打开的窗口。右上角可刷新页面（⌘R）；关掉只是收起，对话和登录都会保留，全部收起后程序坞图标隐藏。</p>
      {cfg.webApps.length > 0 && (
        <ul className="web-list">
          {cfg.webApps.map((w) => {
            const b = cfg.hotkeys[hotkeyIndex(w)];
            return (
              <li key={w.id} data-context-menu tabIndex={0} aria-current={selected === w.id || undefined} className={selected === w.id ? "selected" : ""} onFocus={() => setSelected(w.id)} onContextMenu={(event) => {
                event.preventDefault(); setSelected(w.id);
                void showContextMenu(itemMenuEntries({ plugin: "webapps", title: w.name, subtitle: w.url, score: 0, kind: "feature", action: { type: "openWeb", id: w.id } }, {
                  saved: [], webApps: cfg.webApps, settingsPlugins: [], run: () => invoke("webapp_open", { id: w.id }), open: (target) => { if (target.input?.includes("/edit/")) setEditing(w); else setRecording(w.id); },
                }), setError, menuPoint(event));
              }}>
                <WebIcon url={w.url} name={w.name} />
                <span className="row-text">
                  <span className="row-title inline">
                    {w.name}
                    {w.keywords.map((k) => (
                      <span key={k} className="chip sm">
                        {k}
                      </span>
                    ))}
                  </span>
                  <span className="row-desc">{w.url}</span>
                </span>
                <HotkeyRecorder
                  startRecording={recording === w.id}
                  onCancel={() => setRecording(null)}
                  className="sm"
                  value={b?.enabled ? b.accelerator : ""}
                  placeholder="设为热键"
                  onChange={(acc) => setHotkey(w, acc)}
                />
                <button type="button" className="icon-btn sm" aria-label={`移除 ${w.name}`} onClick={() => remove(w)}>
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form className="inline" style={{ flexWrap: "nowrap" }} onSubmit={add}>
        <label className="sr-only" htmlFor="web-name">
          名称
        </label>
        <input id="web-name" className="input" style={{ width: 110 }} placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="sr-only" htmlFor="web-url">
          网址
        </label>
        <input
          id="web-url"
          className="input"
          style={{ flex: 1 }}
          placeholder="网址，如 https://kimi.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <label className="sr-only" htmlFor="web-keywords">
          关键词
        </label>
        <input
          id="web-keywords"
          className="input"
          style={{ width: 110 }}
          placeholder="关键词（可选）"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
        <button type="submit" className="btn">
          添加
        </button>
      </form>
      {editing && <WebEditor web={editing} onClose={() => setEditing(null)} />}
      {error && <p className="note warn-text">{error}</p>}
    </>
  );
}

function WebEditor({ web, onClose }: { web: WebApp; onClose: () => void }) {
  const [name, setName] = useState(web.name), [url, setUrl] = useState(web.url), [keywords, setKeywords] = useState(web.keywords.join(" "));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submit = async () => { const full = normalizeUrl(url); if (!name.trim() || !full) { setError("请填写名称和有效网址"); return; } setBusy(true); setError("");
    try { await invoke("webapp_update", { id: web.id, name: name.trim(), url: full, keywords: keywords.split(/[,，\s]+/).filter(Boolean) }); onClose(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <Modal title="编辑网页应用" onClose={onClose} busy={busy}><form className="edit-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <label>名称<input className="input" autoFocus value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
    <label>网址<input className="input" value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} /></label>
    <label>关键词<input className="input" value={keywords} disabled={busy} onChange={(e) => setKeywords(e.target.value)} /></label>
    <p className="note">修改网址后，当前窗口继续保留页面；下次重启 AhaTools 后使用新网址。</p>
    {error && <p className="note bad-text" role="alert">{error}</p>}
    <div className="row-actions end"><button type="button" className="btn" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "正在保存…" : "保存"}</button></div>
  </form></Modal>;
}
