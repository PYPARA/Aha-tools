import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  invoke, onPanelShown, PageActions, Spinner, Switch, withPinned,
  type HostLocation, type HostScheme, type HostsOperation, type HostsSnapshot, type HostsValidation, type PluginViewProps,
} from "@ahatools/sdk";
import Dialog from "./Dialogs";
import Editor, { type EditorHandle } from "./Editor";
import "./hosts.css";

type Modal = "current" | "leave" | "restore" | "delete" | null;
const same = (a: HostScheme[], b: HostScheme[]) => JSON.stringify(a) === JSON.stringify(b);

export default function Hosts({ setStatus, registerBeforeLeave }: PluginViewProps) {
  const [snapshot, setSnapshot] = useState<HostsSnapshot | null>(null);
  const [schemes, setSchemes] = useState<HostScheme[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [validation, setValidation] = useState<HostsValidation>({ issues: [], counts: {} });
  const [checking, setChecking] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [notice, setNotice] = useState({ text: "", error: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [pendingLine, setPendingLine] = useState<number | null>(null);
  const editor = useRef<EditorHandle>(null);
  const alive = useRef(false);
  const working = useRef(false);
  const readSequence = useRef(0);
  const validationSequence = useRef(0);
  const loadedRevision = useRef<string | null>(null);
  const leaveResolver = useRef<((leave: boolean) => void) | null>(null);
  const current = schemes.find((s) => s.id === selection);
  const dirty = Boolean(snapshot && !same(schemes, snapshot.schemes));
  const blocked = checking || Boolean(validationError) || validation.issues.some((issue) => issue.blocking);
  const state = useRef({ dirty, busy, modal });
  state.current = { dirty, busy, modal };

  const refresh = useCallback(async (initial = false) => {
    const request = ++readSequence.current;
    try {
      const fresh = await invoke<HostsSnapshot>("hosts_load");
      if (!alive.current || request !== readSequence.current) return;
      if (!initial && loadedRevision.current !== null && loadedRevision.current !== fresh.revision && state.current.dirty) {
        setNotice({ text: "系统 hosts 或方案文件已变化，当前草稿已保留，请核对后再应用。", error: true });
      }
      loadedRevision.current = fresh.revision;
      setSnapshot(fresh);
      if (initial || !state.current.dirty) {
        setSchemes(fresh.schemes);
        if (initial) {
          setSelection(fresh.schemes[0]?.id ?? null);
          setNotice({ text: "", error: false });
        }
      }
    } catch (error) {
      if (alive.current && request === readSequence.current) setNotice({ text: String(error), error: true });
    } finally {
      if (alive.current && request === readSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh(true);
    const unlisten = onPanelShown(() => { if (!working.current) void refresh(); });
    return () => {
      alive.current = false;
      ++readSequence.current;
      unlisten.then((off) => off());
      leaveResolver.current?.(false);
      leaveResolver.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (!snapshot) return;
    const request = ++validationSequence.current;
    setChecking(true);
    const timer = setTimeout(() => {
      invoke<HostsValidation>("hosts_validate", { schemes }).then((result) => {
        if (alive.current && request === validationSequence.current) {
          setValidation(result); setValidationError("");
        }
      }, (error) => {
        if (alive.current && request === validationSequence.current) setValidationError(String(error));
      }).finally(() => {
        if (alive.current && request === validationSequence.current) setChecking(false);
      });
    }, 250);
    return () => { clearTimeout(timer); ++validationSequence.current; };
  }, [schemes, snapshot]);

  useEffect(() => {
    setStatus(busy ? "正在等待授权或应用…" : "⌘S 应用 · 修改系统时需要管理员授权");
  }, [busy, setStatus]);

  useEffect(() => registerBeforeLeave?.(() => {
    if (working.current || state.current.modal) return Promise.resolve(false);
    if (!state.current.dirty) return Promise.resolve(true);
    setModal("leave");
    return new Promise<boolean>((resolve) => { leaveResolver.current = resolve; });
  }), [registerBeforeLeave]);

  const closeModal = useCallback(() => {
    if (working.current) return;
    setModal(null);
    leaveResolver.current?.(false);
    leaveResolver.current = null;
  }, []);

  const apply = useCallback(async (restoring = false): Promise<boolean> => {
    if (!snapshot || working.current || (!restoring && blocked)) return false;
    working.current = true;
    ++readSequence.current;
    setBusy(true);
    setNotice({ text: "", error: false });
    try {
      const result = await withPinned(() => invoke<HostsOperation>(restoring ? "hosts_restore" : "hosts_apply", {
        revision: snapshot.revision, ...(!restoring ? { schemes } : {}),
      }));
      if (!alive.current) return false;
      if (result.snapshot) {
        loadedRevision.current = result.snapshot.revision;
        setSnapshot(result.snapshot);
        if (result.profilesSaved) {
          setSchemes(result.snapshot.schemes);
          if (restoring) setSelection(null);
        }
      }
      setNotice({
        text: result.cancelled ? "已取消授权，改动尚未应用" : result.error ??
          (restoring ? "已移除 AhaTools 条目，所有方案已关闭" : "已应用，DNS 已刷新"),
        error: Boolean(result.error),
      });
      return result.systemWritten && result.profilesSaved && result.dnsFlushed;
    } catch (error) {
      if (alive.current) {
        setNotice({ text: String(error), error: true });
        await refresh();
      }
      return false;
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }, [snapshot, blocked, schemes, refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && !event.isComposing && event.metaKey && !event.altKey && !event.ctrlKey &&
        !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!state.current.modal) void apply();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply]);

  useEffect(() => {
    if (pendingLine === null || !current) return;
    editor.current?.selectLine(pendingLine);
    setPendingLine(null);
  }, [pendingLine, current]);

  const update = (patch: Partial<HostScheme>) => {
    setChecking(true);
    setSchemes((list) => list.map((s) => s.id === selection ? { ...s, ...patch } : s));
  };
  const add = (copy?: HostScheme) => {
    const id = crypto.randomUUID();
    setChecking(true);
    setSchemes((list) => [...list, { id, name: copy ? `${copy.name} 副本` : "新方案", content: copy?.content ?? "", enabled: false }]);
    setSelection(id);
  };
  const describe = (location: HostLocation) => `${location.schemeId === null ? "系统 hosts" :
    schemes.find((s) => s.id === location.schemeId)?.name ?? "方案"}${location.line ? ` · 第 ${location.line} 行` : ""}`;
  const locate = (location: HostLocation) => {
    if (location.schemeId === null) { setModal("current"); return; }
    setSelection(location.schemeId);
    setPendingLine(location.line || 1);
  };
  const errorLines = useMemo(() => new Set(validation.issues.flatMap((issue) => [issue.location, ...issue.related])
    .filter((location) => location.schemeId === selection && location.line > 0).map((location) => location.line)), [validation, selection]);
  const enabledNames = snapshot?.schemes.filter((s) => s.enabled).map((s) => s.name).join("、");
  const appliedText = snapshot?.markerError ? "系统标记异常" : !snapshot?.matchesSaved ? "系统内容与已保存方案不同" :
    snapshot.managed ? `已应用：${enabledNames || "AhaTools 条目"}` : "系统 hosts · 无 AhaTools 条目";

  if (loading) return <div className="state"><Spinner label="正在读取 hosts…" /></div>;
  if (!snapshot) return <div className="state"><p className="note error" role="alert">{notice.text}</p>
    <button type="button" className="btn" onClick={() => { setLoading(true); void refresh(true); }}>重新读取</button></div>;

  return (
    <div className="hosts-view" aria-busy={busy}>
      <PageActions><span className={`hosts-applied${snapshot.matchesSaved && !snapshot.markerError ? " ok" : " warn"}`} title={appliedText}>
        <span className="hosts-dot" />{appliedText}</span></PageActions>
      <aside className="hosts-sidebar" aria-label="hosts 方案">
        <div className="hosts-scheme-list">
          <button type="button" className={`hosts-original${selection === null ? " selected" : ""}`} onClick={() => setSelection(null)} disabled={busy}>
            <strong>系统原始</strong><span>{snapshot.original === null ? "尚未备份 · 首次应用前创建" : "只读 · 首次应用前的备份"}</span>
          </button>
          {schemes.map((scheme) => {
            const invalid = validation.issues.some((issue) => [issue.location, ...issue.related].some((loc) => loc.schemeId === scheme.id));
            return <div key={scheme.id} className={`hosts-scheme${selection === scheme.id ? " selected" : ""}`}>
              <button type="button" className="hosts-scheme-name" onClick={() => setSelection(scheme.id)} disabled={busy}>
                <strong>{scheme.name || "未命名方案"}</strong>
                <span className={invalid ? "hosts-bad" : ""}>{validation.counts[scheme.id] ?? 0} 条{invalid ? " · 有错误" : ""}</span>
              </button>
              <Switch small checked={scheme.enabled} label={`${scheme.name}：下次应用时包含`} disabled={busy}
                onChange={(enabled) => { setChecking(true); setSchemes((list) => list.map((s) => s.id === scheme.id ? { ...s, enabled } : s)); }} />
            </div>;
          })}
        </div>
        <button type="button" className="btn ghost hosts-new" disabled={busy} onClick={() => add()}>＋ 新建方案</button>
        <p className="note hosts-switch-note">开关决定下次应用包含的方案</p>
      </aside>
      <section className="hosts-main" aria-label="方案编辑区">
        <div className="hosts-toolbar">
          {current ? <><label className="sr-only" htmlFor="hosts-name">方案名称</label>
            <input id="hosts-name" className="input" value={current.name} disabled={busy} onChange={(e) => update({ name: e.target.value })} />
            <button type="button" className="btn ghost" disabled={busy} onClick={() => add(current)}>复制</button>
            <button type="button" className="btn ghost hosts-danger" disabled={busy} onClick={() => setModal("delete")}>删除</button></> :
            <strong>系统原始 · 只读</strong>}
          {dirty && <span className="hosts-dirty"><span className="hosts-dot" />有改动未应用</span>}
        </div>
        {notice.text && <p className={`hosts-notice${notice.error ? " hosts-bad" : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
        {snapshot.markerError && <p className="hosts-bad note" role="alert">{snapshot.markerError}</p>}
        {current ? <Editor ref={editor} value={current.content} disabled={busy} errorLines={errorLines} onChange={(content) => update({ content })} /> :
          <textarea className="hosts-readonly" readOnly aria-label="系统原始内容" spellCheck={false}
            value={snapshot.original ?? snapshot.current} />}
        {!current && snapshot.original === null && <p className="note">尚未备份，当前显示系统 hosts。首次应用前会创建只读备份。</p>}
        <div className="hosts-issues" aria-live="polite">
          {validationError && <p className="hosts-bad note">{validationError}</p>}
          {validation.issues.map((issue, i) => <div key={i} className={issue.blocking ? "hosts-bad" : "hosts-disabled-issue"}>
            <button type="button" disabled={busy} onClick={() => locate(issue.location)}>{describe(issue.location)}</button>
            <span>：{issue.message}{!issue.blocking ? "（已关闭，不阻止应用）" : ""}</span>
            {issue.related.map((loc, j) => <button type="button" key={j} disabled={busy} onClick={() => locate(loc)}>↔ {describe(loc)}</button>)}
          </div>)}
        </div>
        <div className="hosts-bottom">
          <p className="note" id="hosts-format">每行「IP 空格 主机名」，支持 IPv6、别名和 # 注释</p>
          <div className="hosts-buttons">
            <button type="button" className="btn ghost hosts-danger" disabled={busy} onClick={() => setModal("restore")}>恢复原始 hosts…</button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setModal("current"); void refresh(); }}>查看当前生效内容</button>
            <button type="button" className="btn primary" disabled={busy || blocked} onClick={() => void apply()}>
              {busy ? "正在应用…" : checking ? "正在校验…" : "应用"}</button>
          </div>
        </div>
      </section>
      {modal && <Dialog title={modal === "current" ? "当前系统 hosts · 只读" : modal === "leave" ? "有改动未应用" :
        modal === "delete" ? `删除「${current?.name ?? "方案"}」？` : "恢复原始 hosts？"} busy={busy} onClose={closeModal}>
        {modal === "current" ? <><textarea className="hosts-readonly" readOnly aria-label="当前生效内容" value={snapshot.current} spellCheck={false} />
          <div className="hosts-dialog-actions"><button type="button" className="btn" onClick={() => void refresh()}>刷新内容</button></div></> :
          modal === "leave" ? <><p className="note">应用后保存方案并离开，或放弃本次改动。收起窗口会保留当前草稿。</p>
            <div className="hosts-dialog-actions">
              <button type="button" className="btn" disabled={busy} onClick={closeModal}>继续编辑</button>
              <button type="button" className="btn ghost hosts-danger" disabled={busy} onClick={() => {
                const resolve = leaveResolver.current; leaveResolver.current = null; setModal(null); resolve?.(true);
              }}>放弃改动</button>
              <button type="button" className="btn primary" disabled={busy || blocked} onClick={async () => {
                if (await apply()) { const resolve = leaveResolver.current; leaveResolver.current = null; setModal(null); resolve?.(true); }
              }}>{busy ? "正在应用…" : "应用并离开"}</button>
            </div></> : modal === "delete" ? <><p className="note">从当前列表移除，点击「应用」后才会保存并更新系统 hosts。</p>
              <div className="hosts-dialog-actions"><button type="button" className="btn" onClick={closeModal}>取消</button>
                <button type="button" className="btn hosts-danger" onClick={() => {
                  setChecking(true); setSchemes((list) => list.filter((s) => s.id !== selection)); setSelection(null); setModal(null);
                }}>删除方案</button></div></> : <><p className="note">移除 AhaTools 写入的条目，关闭所有已保存方案，并丢弃当前未应用改动。系统其他内容会保留。</p>
                <div className="hosts-dialog-actions"><button type="button" className="btn" disabled={busy} onClick={closeModal}>取消</button>
                  <button type="button" className="btn primary" disabled={busy || Boolean(snapshot.markerError)} onClick={async () => {
                    if (await apply(true)) setModal(null);
                  }}>{busy ? "正在恢复…" : "恢复原始 hosts"}</button></div></>}
        {modal !== "current" && notice.text && <p className={`note${notice.error ? " hosts-bad" : ""}`} role="status">{notice.text}</p>}
      </Dialog>}
    </div>
  );
}
