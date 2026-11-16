import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CopyIcon, PageActions, RefreshIcon, invoke, menuPoint, showContextMenu, openPath, onHostEvent, writeClipboardText, type Config, type PluginViewProps } from "@ahatools/sdk";
import { TABS, filterListeners, listenerUrl, ms, replyTime, summarize, type DnsResult, type Listener, type Local } from "./model";

type Tab = (typeof TABS)[number]["feature"];

function CopyButton({ text, onCopied }: { text: string; onCopied: (text: string) => void }) {
  return <button type="button" className="icon-btn sm" aria-label={`复制 ${text}`} title="复制"
    onClick={() => void writeClipboardText(text).then(() => onCopied(text))}><CopyIcon size={14} /></button>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="net-field"><span className="net-label">{label}</span>{children}</div>;
}

function IpTab({ notify }: { notify: (text: string, bad?: boolean) => void }) {
  const [local, setLocal] = useState<Local | null>(null);
  const [publicIp, setPublicIp] = useState<{ state: "idle" | "loading" | "done" | "error"; value: string }>({ state: "idle", value: "" });
  const [service, setService] = useState("");
  const load = useCallback(() => {
    invoke<Local>("network_local").then(setLocal).catch((e) => notify(String(e), true));
  }, [notify]);
  useEffect(() => {
    load();
    invoke<Config>("config_get").then((c) => { try { setService(new URL(c.publicIpUrl).hostname); } catch { /* shown without a name */ } });
  }, [load]);
  const lookup = async () => {
    setPublicIp({ state: "loading", value: "" });
    try { setPublicIp({ state: "done", value: await invoke<string>("network_public_ip") }); }
    catch (e) { setPublicIp({ state: "error", value: String(e) }); }
  };
  const copied = (text: string) => notify(`已复制 ${text}`);
  return <div className="net-section">
    <div className="net-head"><h2>本机地址</h2><button type="button" className="btn ghost sm" onClick={load}><RefreshIcon />刷新</button></div>
    {!local ? <p className="note">正在读取…</p> : local.addresses.length === 0 ? <p className="note">没有连接网络</p> : (
      <div className="net-table" role="table" aria-label="本机地址">
        {local.addresses.map((a) => (
          <div className="net-row" role="row" key={`${a.interface}-${a.ip}`}>
            <span role="cell" className="net-cell-label">{a.label}<span className="note"> · {a.interface}</span></span>
            <span role="cell" className="mono net-value">{a.ip}</span>
            <span role="cell" className="note">{a.v6 ? "IPv6" : "IPv4"}</span>
            <CopyButton text={a.ip} onCopied={copied} />
          </div>
        ))}
        {local.gateway && <div className="net-row" role="row">
          <span role="cell" className="net-cell-label">默认网关<span className="note"> · {local.gatewayInterface}</span></span>
          <span role="cell" className="mono net-value">{local.gateway}</span><span role="cell" />
          <CopyButton text={local.gateway} onCopied={copied} />
        </div>}
      </div>
    )}
    <div className="net-head"><h2>公网 IP</h2></div>
    <div className="net-row net-public">
      {publicIp.state === "done" ? <>
        <span className="mono net-value">{publicIp.value}</span>
        <CopyButton text={publicIp.value} onCopied={copied} />
      </> : <span className={`note${publicIp.state === "error" ? " bad-text" : ""}`}>
        {publicIp.state === "loading" ? "正在查询…" : publicIp.state === "error" ? publicIp.value : `点按查询，会向 ${service || "设置里的服务"} 发送一次请求`}
      </span>}
      <span className="spacer" />
      <button type="button" className="btn sm" disabled={publicIp.state === "loading"} onClick={() => void lookup()}>{publicIp.state === "done" ? "重新查询" : "查询公网 IP"}</button>
    </div>
  </div>;
}

function PingTab({ input }: { input?: string }) {
  const [host, setHost] = useState(input ?? "");
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const current = useRef("");
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const subs = [
      onHostEvent<{ id: string; line: string }>("network-ping", (e) => { if (e.id === current.current) setLines((l) => [...l, e.line]); }),
      onHostEvent<{ id: string; ok: boolean }>("network-ping-done", (e) => { if (e.id === current.current) setRunning(false); }),
    ];
    return () => {
      if (current.current) void invoke("network_ping_stop", { id: current.current }).catch(() => {});
      subs.forEach((s) => void s.then((off) => off()));
    };
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [lines]);
  const start = async (target = host) => {
    if (current.current && running) void invoke("network_ping_stop", { id: current.current }).catch(() => {});
    const id = crypto.randomUUID();
    current.current = id;
    setLines([]); setError(""); setRunning(true);
    try { setHost(await invoke<string>("network_ping_start", { id, host: target })); }
    catch (e) { setError(String(e)); setRunning(false); current.current = ""; }
  };
  useEffect(() => { if (input?.trim()) void start(input); }, []);
  const summary = useMemo(() => summarize(lines), [lines]);
  const times = lines.map(replyTime).filter((t): t is number => t !== null);
  const peak = Math.max(1, ...times);
  return <div className="net-section">
    <form className="net-form" onSubmit={(e) => { e.preventDefault(); void start(); }}>
      <input className="input mono" autoFocus spellCheck={false} placeholder="域名或 IP，例如 github.com" aria-label="主机" value={host} onChange={(e) => setHost(e.target.value)} />
      {running ? <button type="button" className="btn" onClick={() => void invoke("network_ping_stop", { id: current.current })}>停止</button>
        : <button type="submit" className="btn primary" disabled={!host.trim()}>开始</button>}
    </form>
    {error && <p className="note bad-text" role="alert">{error}</p>}
    {lines.length > 0 && <>
      <div className="net-stats">
        <Field label="已发送">{summary.sent}</Field>
        <Field label="收到">{summary.received}</Field>
        <Field label="丢包"><span className={summary.loss > 0 ? "warn-text" : ""}>{summary.loss}%</span></Field>
        <Field label="平均">{ms(summary.avg)}</Field>
        <Field label="最快 / 最慢">{ms(summary.min)} / {ms(summary.max)}</Field>
      </div>
      {times.length > 0 && <div className="net-bars" aria-hidden="true">{times.map((t, i) => <i key={i} style={{ height: `${Math.max(6, (t / peak) * 100)}%` }} title={ms(t)} />)}</div>}
      <pre data-context-menu tabIndex={0} className="net-log mono" ref={logRef}>{lines.join("\n")}</pre>
    </>}
    {!lines.length && !error && <p className="note">每秒一次，共 10 次；运行中可以停止。</p>}
  </div>;
}

function DnsTab({ input }: { input?: string }) {
  const [host, setHost] = useState(input ?? "");
  const [server, setServer] = useState("");
  const [result, setResult] = useState<DnsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (target = host) => {
    setBusy(true); setError("");
    try { setResult(await invoke<DnsResult>("network_dns", { host: target, server: server || null })); }
    catch (e) { setError(String(e)); setResult(null); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (input?.trim()) void run(input); }, []);
  const a = result?.records.find((r) => r.kind === "A")?.values ?? [];
  const differs = result && result.system.length > 0 && a.length > 0 && !result.system.some((ip) => a.includes(ip));
  return <div className="net-section">
    <form className="net-form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
      <input className="input mono" autoFocus spellCheck={false} placeholder="域名，例如 github.com" aria-label="域名" value={host} onChange={(e) => setHost(e.target.value)} />
      <input className="input mono net-server" spellCheck={false} placeholder="DNS 服务器（可选）" aria-label="DNS 服务器" value={server} onChange={(e) => setServer(e.target.value)} />
      <button type="submit" className="btn primary" disabled={busy || !host.trim()}>{busy ? "正在查询…" : "查询"}</button>
    </form>
    {error && <p className="note bad-text" role="alert">{error}</p>}
    {result && <>
      <div className="net-table" role="table" aria-label="DNS 记录">
        {result.records.map((r) => (
          <div className="net-row" role="row" key={r.kind}>
            <span role="cell" className="net-cell-label mono">{r.kind}</span>
            <span role="cell" className="mono net-value net-multi">{r.values.length ? r.values.join("\n") : <span className="note">无记录</span>}</span>
          </div>
        ))}
        <div className="net-row" role="row">
          <span role="cell" className="net-cell-label">本机实际解析</span>
          <span role="cell" className="mono net-value net-multi">{result.system.length ? result.system.join("\n") : <span className="note">解析失败</span>}</span>
        </div>
      </div>
      {result.hostsFile.length > 0 && <p className="note warn-text">/etc/hosts 里有这个域名，本机会优先使用：{result.hostsFile.join("；")}</p>}
      {differs && !result.hostsFile.length && <p className="note warn-text">本机解析和 DNS 返回的 A 记录不同，可能来自 VPN、代理或缓存。</p>}
      <p className="note">查询使用 {result.server ?? "系统默认的 DNS 服务器"}。</p>
    </>}
  </div>;
}

function PortTab({ input, notify, openFeature }: { openFeature: PluginViewProps["openFeature"]; input?: string; notify: (text: string, bad?: boolean) => void }) {
  const [rows, setRows] = useState<Listener[] | null>(null);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState(input ?? "");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    invoke<Listener[]>("network_ports").then(setRows).catch((e) => notify(String(e), true));
  }, [notify]);
  useEffect(load, [load]);
  const shown = rows ? filterListeners(rows, filter) : [];
  const quit = async (row: Listener) => {
    if (!row.path) { notify("进程信息已失效，请刷新后重试", true); return; }
    setBusy(true);
    try {
      const message = await invoke<string>("processes_quit", { targets: [{ pid: row.pid, path: row.path }], force: false });
      notify(`${row.process}：${message}`);
      setTimeout(load, 600);
    } catch (e) { notify(String(e), true); }
    finally { setBusy(false); }
  };
  return <div className="net-section">
    <div className="net-form">
      <input className="input mono" autoFocus spellCheck={false} placeholder="筛选端口、进程或 PID" aria-label="筛选端口" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <button type="button" className="btn ghost" onClick={load}><RefreshIcon />刷新</button>
    </div>
    {!rows ? <p className="note">正在读取…</p> : shown.length === 0 ? <p className="note">{filter.trim() ? `没有进程在监听「${filter.trim()}」` : "没有正在监听的 TCP 端口"}</p> : (
      <div className="net-table" role="table" aria-label="监听端口">
        {shown.map((r) => (
          <div className={`net-row net-port${selected === `${r.pid}-${r.address}-${r.port}` ? " selected" : ""}`} role="row" data-context-menu tabIndex={0} key={`${r.pid}-${r.address}-${r.port}`} onContextMenu={(event) => {
            event.preventDefault(); setSelected(`${r.pid}-${r.address}-${r.port}`); const row = { ...r };
            void showContextMenu([
              { id: "http", text: "以 HTTP 打开…", action: () => openPath(listenerUrl(row, "http")) },
              { id: "https", text: "以 HTTPS 打开…", action: () => openPath(listenerUrl(row, "https")) },
              { id: "process", text: "查看对应进程", action: () => openFeature({ plugin: "processes", feature: "processes", input: `pid:${row.pid}` }) },
              { item: "Separator" },
              { id: "copy-port", text: "复制端口", action: () => writeClipboardText(String(row.port)) },
              { id: "copy-address", text: "复制监听地址", action: () => writeClipboardText(row.address) },
              { id: "copy-pid", text: "复制 PID", action: () => writeClipboardText(String(row.pid)) },
              { item: "Separator" },
              { id: "quit", text: "结束进程", disabled: busy || !row.path, action: () => quit(row) },
            ], (message) => notify(message, true), menuPoint(event));
          }}>
            <span role="cell" className="mono net-value">{r.port}</span>
            <span role="cell" className="mono note">{r.address}</span>
            <span role="cell" className="net-cell-label">{r.process}<span className="note"> · PID {r.pid}</span></span>
            <button type="button" className="btn ghost sm danger" disabled={busy} onClick={() => void quit(r)}>结束</button>
          </div>
        ))}
      </div>
    )}
    <p className="note">只列出当前用户的进程；系统进程需要管理员权限才能看到。</p>
  </div>;
}

/** One page, four tabs; each tab is its own feature so search and hotkeys can open it. */
export default function Network({ feature, input, setStatus, openFeature }: PluginViewProps & { feature: Tab }) {
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const notify = useCallback((text: string, bad = false) => setNotice({ text, bad }), []);
  useEffect(() => { setStatus(""); }, [setStatus]);
  useEffect(() => {
    if (!notice || notice.bad) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);
  return <div className="net-view">
    <PageActions>
      <div className="seg" role="tablist" aria-label="网络工具">
        {TABS.map((t) => <button key={t.feature} type="button" role="tab" aria-selected={feature === t.feature}
          onClick={() => feature !== t.feature && openFeature({ plugin: "network", feature: t.feature })}>{t.label}</button>)}
      </div>
    </PageActions>
    {notice && <p className={`note ${notice.bad ? "bad-text" : "ok-text"}`} role={notice.bad ? "alert" : "status"}>{notice.text}</p>}
    {feature === "ip" ? <IpTab notify={notify} /> : feature === "ping" ? <PingTab input={input} /> : feature === "dns" ? <DnsTab input={input} /> : <PortTab input={input} notify={notify} openFeature={openFeature} />}
  </div>;
}

export const views = Object.fromEntries(TABS.map((t) => [`network/${t.feature}`, (props: PluginViewProps) => <Network {...props} feature={t.feature} />]));
