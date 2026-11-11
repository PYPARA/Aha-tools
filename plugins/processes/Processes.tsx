import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppIcon, ChevronIcon, PageActions, SearchIcon, invoke, onPanelShown, type PluginViewProps } from "@ahatools/sdk";
import { pressureLabel } from "../../src/sysmon";
import {
  formatBytes, formatCpu, heavy, lockReason, totalCpu, visibleGroups,
  type AppGroup, type ProcessRow, type ProcessSnapshot, type SortKey, type View,
} from "./model";

const REFRESH_MS = 2000;

/** A lone process outside any app: a quiet terminal tile instead of an app icon. */
function ProcessTile() {
  return <span className="tile proc-tile" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M7.5 10l3 2.5-3 2.5M12.5 15h4" /></svg></span>;
}

export default function Processes({ setStatus }: PluginViewProps) {
  const [snapshot, setSnapshot] = useState<ProcessSnapshot | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("apps");
  const [sort, setSort] = useState<SortKey>("cpu");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<AppGroup | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setSnapshot(await invoke<ProcessSnapshot>("processes_snapshot"));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Refreshes only while the page is on screen; leaving it stops the loop.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState !== "hidden") await load();
      if (alive) timer = setTimeout(tick, REFRESH_MS);
    };
    void tick();
    const off = onPanelShown(() => { void load(); });
    return () => { alive = false; clearTimeout(timer); void off.then((f) => f()).catch(() => {}); };
  }, [load]);

  const rows = useMemo(() => visibleGroups(snapshot, view, sort, query), [snapshot, view, sort, query]);
  const index = Math.max(0, rows.findIndex((g) => g.id === selected));
  const current = rows.length ? rows[index] : null;

  useEffect(() => {
    setStatus(snapshot ? `↑↓ 选择 · ⌘⌫ 退出 · ⌥⌘⌫ 强制结束 · ${snapshot.count} 个进程` : "");
  }, [snapshot?.count, setStatus]);
  useEffect(() => {
    if (!notice || notice.bad) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current?.id]);

  const quit = useCallback(async (group: AppGroup, processes: ProcessRow[], force: boolean) => {
    setConfirm(null);
    setBusy(true);
    try {
      const message = await invoke<string>("processes_quit", { targets: processes.map((p) => ({ pid: p.pid, path: p.path })), force });
      setNotice({ text: `${group.name}：${message}`, bad: false });
      setTimeout(() => void load(), 600);
    } catch (e) {
      setNotice({ text: String(e), bad: true });
    } finally {
      setBusy(false);
    }
  }, [load]);
  const ask = (group: AppGroup, force: boolean) => {
    const reason = lockReason(group);
    if (reason) { setNotice({ text: `${group.name}：${reason}`, bad: true }); return; }
    if (force) setConfirm(group);
    else void quit(group, group.processes, false);
  };
  const toggle = (id: string, open?: boolean) => setExpanded((set) => {
    const next = new Set(set);
    if (open ?? !next.has(id)) next.add(id); else next.delete(id);
    return next;
  });

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.isComposing || e.defaultPrevented) return;
    if (confirm) {
      // Captured before the panel's own esc, which would leave the page.
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setConfirm(null); }
      if (e.key === "Enter") { e.preventDefault(); void quit(confirm, confirm.processes, true); }
      return;
    }
    const typing = e.target instanceof HTMLInputElement && e.target.value !== "";
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) setSelected(next.id);
    } else if (!typing && view === "apps" && current && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      toggle(current.id, e.key === "ArrowRight");
    } else if (e.key === "Enter" && current && view === "apps" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      toggle(current.id);
    } else if (e.key === "Backspace" && e.metaKey && current && !typing) {
      e.preventDefault();
      ask(current, e.altKey);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const total = snapshot ? totalCpu(snapshot) : 0;
  const memory = snapshot?.memory;
  const actions = (group: AppGroup) => {
    const reason = lockReason(group);
    return <span className="proc-actions">
      {reason ? <span className="note" title={reason}>{group.protected ? "系统" : "无权限"}</span> : <>
        <button type="button" className="btn sm" disabled={busy} onClick={(e) => { e.stopPropagation(); ask(group, false); }}>退出</button>
        <button type="button" className="btn ghost sm danger" disabled={busy} onClick={(e) => { e.stopPropagation(); ask(group, true); }}>强制结束</button>
      </>}
    </span>;
  };

  return (
    <div className="proc-view">
      <PageActions>
        <div className="seg" role="tablist" aria-label="显示方式">
          {([["apps", "按应用"], ["all", "全部进程"]] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => { setView(value); setSelected(null); }}>{label}</button>
          ))}
        </div>
      </PageActions>
      <div className="proc-toolbar">
        <label className="proc-search">
          <SearchIcon size={14} />
          <input className="input" autoFocus spellCheck={false} placeholder="筛选应用、进程或 PID" aria-label="筛选进程" value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); }} />
        </label>
        <span className="spacer" />
        {snapshot && <span className="note">CPU 合计 <b className="mono proc-figure">{Math.round(total)}%</b>（{snapshot.cores} 核）</span>}
        {memory && <span className="note">内存 <b className="mono proc-figure">{formatBytes(memory.usedBytes)} / {formatBytes(memory.totalBytes)}</b> · {pressureLabel[memory.pressure]}</span>}
      </div>
      {notice && <p className={`note ${notice.bad ? "bad-text" : "ok-text"}`} role={notice.bad ? "alert" : "status"}>{notice.text}</p>}
      <div className="proc-list" role="grid" aria-label="进程" ref={listRef}>
        <div className="proc-row proc-head" role="row">
          <span role="columnheader">名称</span>
          {(["cpu", "memory"] as const).map((key) => (
            <button key={key} type="button" role="columnheader" aria-sort={sort === key ? "descending" : "none"} className={`proc-sort${sort === key ? " on" : ""}`}
              onClick={() => setSort(key)}>{key === "cpu" ? "CPU" : "内存"}{sort === key ? " ▾" : ""}</button>
          ))}
          <span />
        </div>
        {!snapshot ? (
          <div className="state"><p className="lede">{error || "正在读取进程…"}</p>{error && <button type="button" className="btn" onClick={() => void load()}>重试</button>}</div>
        ) : rows.length === 0 ? (
          <div className="state"><p className="lede">没有匹配「{query.trim()}」的进程</p></div>
        ) : rows.map((group) => {
          const open = view === "apps" && expanded.has(group.id) && group.processes.length > 1;
          const tone = heavy(group.cpu, group.memory);
          const isSelected = current?.id === group.id;
          return <Fragment key={group.id}>
            <div role="row" aria-selected={isSelected} className={`proc-row${isSelected ? " selected" : ""}`}
              onClick={() => setSelected(group.id)} onDoubleClick={() => view === "apps" && toggle(group.id)}>
              <span className="proc-name" role="gridcell">
                {view === "apps" && group.processes.length > 1
                  ? <button type="button" className="proc-twisty" aria-label={open ? "收起子进程" : "展开子进程"} aria-expanded={open}
                      onClick={(e) => { e.stopPropagation(); toggle(group.id); }}><ChevronIcon size={12} /></button>
                  : <span className="proc-twisty" />}
                {group.bundle ? <AppIcon path={group.bundle} name={group.name} /> : <ProcessTile />}
                <span className="proc-text">
                  <span className="proc-title">{group.name}</span>
                  <span className="note">{view === "all" || group.processes.length === 1 ? `PID ${group.processes[0].pid}` : `${group.processes.length} 个进程`}
                    {group.protected ? " · 系统进程" : !group.mine ? " · 其他用户" : ""}</span>
                </span>
              </span>
              <span role="gridcell" className={`mono proc-num ${tone ? `${tone}-text` : ""}`}>{formatCpu(group.cpu)}</span>
              <span role="gridcell" className="mono proc-num">{formatBytes(group.memory)}</span>
              <span role="gridcell">{actions(group)}</span>
            </div>
            {open && group.processes.map((p) => (
              <div key={p.pid} role="row" className="proc-row proc-child">
                <span className="proc-name" role="gridcell"><span className="proc-text"><span className="proc-title">{p.name}</span><span className="note mono">PID {p.pid}</span></span></span>
                <span role="gridcell" className={`mono proc-num ${heavy(p.cpu, p.memory) ? `${heavy(p.cpu, p.memory)}-text` : ""}`}>{formatCpu(p.cpu)}</span>
                <span role="gridcell" className="mono proc-num">{formatBytes(p.memory)}</span>
                <span role="gridcell" className="proc-actions">
                  {!lockReason(p) && <button type="button" className="btn ghost sm" disabled={busy} title="结束这个子进程"
                    onClick={() => void quit({ ...group, name: p.name }, [p], false)}>结束</button>}
                </span>
              </div>
            ))}
          </Fragment>;
        })}
      </div>
      {confirm && (
        <div className="proc-confirm" role="alertdialog" aria-label="确认强制结束">
          <span className="bad-text">强制结束「{confirm.name}」{confirm.processes.length > 1 ? `及 ${confirm.processes.length} 个进程` : ""}？</span>
          <span className="note">未保存的内容会丢失；普通退出会让应用先询问保存。</span>
          <span className="spacer" />
          <button type="button" className="btn sm" onClick={() => setConfirm(null)}>取消</button>
          <button type="button" className="btn sm danger proc-kill" autoFocus onClick={() => void quit(confirm, confirm.processes, true)}>强制结束</button>
        </div>
      )}
    </div>
  );
}
