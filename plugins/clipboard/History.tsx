import { isContextMenuOpen } from "@ahatools/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CopyIcon, FileIcon, PageActions, SearchIcon, invoke, onConfigChanged, onHostEvent, onPanelShown, pluginSettingsTarget,
  menuPoint, revealPaths, showContextMenu,
  type Config, type PluginViewProps,
} from "@ahatools/sdk";
import { FILTERS, hasImage, title, visibleEntries, when, type Entry, type Filter } from "./model";
import Preview from "./Preview";
import { historyMenu } from "./menus";

function KindTile({ entry }: { entry: Entry }) {
  const path = hasImage(entry)
    ? <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M5 17l4.5-4.5 3 3 3-3.5 4 5" /></>
    : entry.kind === "files" ? null : <path d="M6 7h12M6 12h12M6 17h8" />;
  return <span className="tile clip-tile" aria-hidden="true">
    {path ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{path}</svg> : <FileIcon size={14} />}
  </span>;
}

export default function History({ setStatus, openFeature }: PluginViewProps) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [undo, setUndo] = useState<{token: string; expiresAt: number} | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const enabled = cfg?.clipboardHistory.enabled ?? false;

  const load = useCallback(() => {
    void invoke<{token: string; expiresAt: number} | null>("clipboard_history_undo_state").then(setUndo).catch((e) => setNotice({ text: String(e), bad: true }));
    invoke<Entry[]>("clipboard_history_list").then(setEntries).catch((e) => setNotice({ text: String(e), bad: true }));
  }, []);
  useEffect(() => {
    void invoke<Config>("config_get").then(setCfg);
    load();
    const subs = [onConfigChanged(setCfg), onHostEvent("clipboard-history-changed", load), onPanelShown(load)];
    return () => subs.forEach((s) => void s.then((off) => off()));
  }, [load]);

  const shown = useMemo(() => visibleEntries(entries ?? [], filter, query), [entries, filter, query]);
  const index = Math.max(0, shown.findIndex((e) => e.id === selected));
  const current = shown[index] ?? null;
  useEffect(() => {
    setStatus("↵ 粘贴 · ⌘C 复制 · ⌘P 固定 · ⌘⌫ 删除");
  }, [enabled, setStatus]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current?.id]);
  useEffect(() => {
    if (!notice || notice.bad) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const setEnabled = async (on: boolean) => {
    if (!cfg) return;
    try { await invoke("config_set", { config: { ...cfg, clipboardHistory: { ...cfg.clipboardHistory, enabled: on } } });
    setNotice({ text: on ? "已开启，之后复制的内容会出现在这里" : "已暂停记录，已有记录保留", bad: false }); } catch (e) { reportError(String(e)); }
  };
  const use = async (entry: Entry, paste: boolean) => {
    try { setNotice({ text: await invoke<string>("clipboard_history_use", { id: entry.id, paste }), bad: false }); load(); }
    catch (e) { setNotice({ text: String(e), bad: true }); }
  };
  const pin = async (entry: Entry) => {
    try { await invoke("clipboard_history_pin", { id: entry.id, pinned: !entry.pinned }); load(); } catch (e) { reportError(String(e)); }
  };
  const remove = async (entry: Entry) => {
    const at = shown.findIndex((e) => e.id === entry.id);
    const next = shown[at + 1] ?? shown[at - 1];
    try { setUndo(await invoke("clipboard_history_delete", { id: entry.id })); setSelected(next?.id ?? null); load(); } catch (e) { reportError(String(e)); }
  };
  useEffect(() => { if (!undo) return; const timer = setTimeout(() => setUndo(null), Math.max(0, undo.expiresAt - Date.now())); return () => clearTimeout(timer); }, [undo]);
  const restore = async () => {
    if (!undo || restoring) return; setRestoring(true);
    try { await invoke("clipboard_history_restore", { token: undo.token }); setUndo(null); setNotice({ text: "已恢复这条历史", bad: false }); load(); }
    catch (e) { reportError(String(e)); } finally { setRestoring(false); }
  };
  const clear = async () => {
    setConfirmClear(false);
    try { await invoke("clipboard_history_clear", { pinnedToo: false }); setUndo(null); setNotice({ text: "已清空，固定的记录保留", bad: false }); load(); } catch (e) { reportError(String(e)); }
  };

  const reportError = (text: string) => setNotice({ text: text.replace(/^Error:\s*/, ""), bad: true });
  const selectEntry = (id: string) => { setSelected(id); setNotice(null); };
  const entryMenu = (event: React.MouseEvent, entry: Entry) => {
    event.preventDefault();
    selectEntry(entry.id);
    void showContextMenu(historyMenu(entry, { use, pin, remove }), reportError, menuPoint(event));
  };

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.isComposing || isContextMenuOpen()) return;
    if (confirmClear) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setConfirmClear(false); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = shown[Math.max(0, Math.min(shown.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) selectEntry(next.id);
    } else if (e.key === "Enter" && current && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      void use(current, true);
    } else if (e.metaKey && current && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()
      && !(e.target instanceof HTMLInputElement && e.target.selectionStart !== e.target.selectionEnd)) {
      e.preventDefault();
      void use(current, false);
    } else if (e.metaKey && current && e.key.toLowerCase() === "p") {
      e.preventDefault();
      void pin(current);
    } else if (e.metaKey && current && e.key === "Backspace") {
      e.preventDefault();
      void remove(current);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  const settings = () => openFeature(pluginSettingsTarget("clipboard", { plugin: "clipboard", feature: "history" }));

  if (cfg && !enabled && entries !== null && entries.length === 0) {
    return <div className="clip-view clip-intro">
      <div className="clip-intro-card">
        <h2>记下复制过的内容</h2>
        <p className="note">开启后，复制的文字、图片和文件会保存在这台 Mac 上，可以搜索后再次粘贴。</p>
        <ul className="note">
          <li>内容不加密地保存在 AhaTools 数据目录，只有你的账户能读取，不会上传。</li>
          <li>1Password、钥匙串等密码管理器复制的内容和标记为隐私的复制不会保存。</li>
          <li>默认最多 500 条、保留 30 天，固定的记录不受限制；随时可以暂停或清空。</li>
        </ul>
        <div className="row-actions">
          <button type="button" className="btn primary" onClick={() => void setEnabled(true)}>开启剪贴板历史</button>
          <button type="button" className="btn ghost" onClick={settings}>设置</button>
        </div>
      </div>
    </div>;
  }

  return <div className="clip-view">
    <PageActions>
      <button type="button" className="btn ghost sm" onClick={() => void setEnabled(!enabled)}>{enabled ? "暂停记录" : "继续记录"}</button>
      <button type="button" className="btn ghost sm" disabled={!entries?.length} onClick={() => setConfirmClear(true)}>清空</button>
      <button type="button" className="btn ghost sm" onClick={settings}>设置</button>
    </PageActions>
    <div className="clip-toolbar">
      <label className="proc-search">
        <SearchIcon size={14} />
        <input className="input" autoFocus spellCheck={false} placeholder="搜索复制过的内容" aria-label="搜索剪贴板历史" value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); setNotice(null); }} />
      </label>
      <div className="seg" role="tablist" aria-label="类型">
        {FILTERS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value}
          onClick={() => { setFilter(value); setSelected(null); setNotice(null); }}>{label}</button>)}
      </div>
      {!enabled && <span className="note warn-text">记录已暂停</span>}
    </div>
    {undo && <div className="undo-notice" role="status"><span>已删除这条历史 · 10 秒内可恢复</span><button type="button" className="btn ghost sm" disabled={restoring} onClick={() => void restore()}>{restoring ? "正在恢复…" : "撤销"}</button></div>}
    {notice && <p className={`note ${notice.bad ? "bad-text" : "ok-text"}`} role={notice.bad ? "alert" : "status"}>{notice.text}</p>}
    {confirmClear && <div className="proc-confirm" role="alertdialog" aria-label="确认清空">
      <span>清空全部剪贴板历史？固定的记录会保留。</span><span className="spacer" />
      <button type="button" className="btn sm" onClick={() => setConfirmClear(false)}>取消</button>
      <button type="button" className="btn sm danger proc-kill" autoFocus onClick={() => void clear()}>清空</button>
    </div>}
    <div className="clip-columns">
      <div className="clip-list" role="listbox" aria-label="剪贴板历史" ref={listRef}>
        {!entries ? <p className="note">正在读取…</p> : shown.length === 0 ? <p className="note clip-empty">{query.trim() || filter !== "all" ? "没有符合条件的记录" : "还没有记录，复制点什么试试"}</p>
          : shown.map((e) => (
            <div key={e.id} role="option" tabIndex={0} data-context-menu aria-selected={current?.id === e.id} className={`clip-row${current?.id === e.id ? " selected" : ""}`}
              onFocus={() => selectEntry(e.id)} onClick={() => selectEntry(e.id)} onDoubleClick={() => void use(e, true)} onContextMenu={(event) => entryMenu(event, e)}>
              <KindTile entry={e} />
              <span className="clip-row-text">
                <span className="clip-title">{title(e)}</span>
                <span className="note">{e.app ? `${e.app} · ` : ""}{when(e.at)}</span>
              </span>
              {e.pinned && <span className="chip sm">固定</span>}
            </div>
          ))}
      </div>
      <div className="clip-side">
        {current ? <>
          <Preview key={current.id} entry={current} onError={reportError} menu={(path) => historyMenu(current, { use, pin, remove }, path)} />
          <div className="row-actions">
            <button type="button" className="btn primary sm" onClick={() => void use(current, true)}>粘贴</button>
            <button type="button" className="btn sm" onClick={() => void use(current, false)}><CopyIcon />复制</button>
            {current.kind === "files" && current.paths.length > 0 && <button type="button" className="btn sm" onClick={() => void revealPaths(current.paths).catch((e) => reportError(String(e)))}>打开文件位置</button>}
            <button type="button" className="btn ghost sm" onClick={() => void pin(current)}>{current.pinned ? "取消固定" : "固定"}</button>
            <button type="button" className="btn ghost sm danger" onClick={() => void remove(current)}>删除</button>
          </div>
        </> : <p className="note">选择一条记录查看完整内容</p>}
      </div>
    </div>
  </div>;
}
