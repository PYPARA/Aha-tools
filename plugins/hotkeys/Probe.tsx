import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke, PageActions, Spinner, withPinned, type PluginViewProps } from "@ahatools/sdk";

interface HotkeyStatus {
  /** User setting. */
  enabled: boolean;
  /** Actually swallowing keys (setting on and Accessibility granted). */
  exclusive: boolean;
  trusted: boolean;
}

interface ProbeResult {
  label: string;
  accelerator: string;
  purpose: "launcher" | "screenshot";
  status: "free" | "occupied" | "system" | "self";
  owner: string | null;
}

const STATUS: Record<ProbeResult["status"], { text: string; tone: string }> = {
  free: { text: "未发现占用", tone: "ok" },
  occupied: { text: "被占用", tone: "bad" },
  system: { text: "系统占用", tone: "warn" },
  self: { text: "AhaTools 在用", tone: "accent" },
};

const PURPOSE: Record<ProbeResult["purpose"], string> = {
  launcher: "启动器",
  screenshot: "截图",
};

function ModeStrip({ status, onToggle, onRequest }: { status: HotkeyStatus; onToggle: () => void; onRequest: () => void }) {
  const [tone, title, detail] = !status.enabled
    ? ["", "共享模式", "同一热键的其他程序（如 uTools）会一起触发"]
    : !status.exclusive
      ? ["warn", "等待授权", "在系统设置里允许「辅助功能」后自动生效"]
      : ["ok", "独占模式已生效", "AhaTools 的热键只有它自己响应"];
  return (
    <div className={`strip ${tone}`} role="status">
      <span className={`dot ${tone}`} aria-hidden="true" />
      <span className="message">
        <b>{title}</b>
        <span>　{detail}</span>
      </span>
      {status.enabled && !status.exclusive && (
        <button type="button" className="btn sm" onClick={onRequest}>
          去授权
        </button>
      )}
      <button type="button" className="btn ghost sm muted" onClick={onToggle}>
        {status.enabled ? "关闭独占" : "开启独占"}
      </button>
    </div>
  );
}

export default function Probe({ setStatus }: PluginViewProps) {
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [mode, setMode] = useState<HotkeyStatus | null>(null);

  useEffect(() => {
    invoke<HotkeyStatus>("hotkey_status").then(setMode);
    const un = listen<HotkeyStatus>("hotkey-status", (e) => setMode(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const run = () => {
    setResults(null);
    invoke<ProbeResult[]>("hotkey_probe").then(setResults);
  };
  useEffect(run, []);

  useEffect(() => {
    setStatus("「被占用」的占用者按常见默认键推测");
  }, [setStatus]);

  const requestAccess = () => withPinned(() => invoke("hotkey_request_access"));
  const toggle = () =>
    mode && withPinned(() => invoke<HotkeyStatus>("hotkey_set_exclusive", { enabled: !mode.enabled })).then(setMode);

  return (
    <div className="view" style={{ gap: 14, paddingTop: 18 }}>
      <PageActions>
        <button type="button" className="btn" onClick={run}>
          重新检测
        </button>
      </PageActions>
      {mode && <ModeStrip status={mode} onToggle={toggle} onRequest={requestAccess} />}
      {!results ? (
        <Spinner label="检测中…" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col" style={{ width: 120 }}>
                热键
              </th>
              <th scope="col" style={{ width: 80 }}>
                用途
              </th>
              <th scope="col" style={{ width: 150 }}>
                状态
              </th>
              <th scope="col">占用者</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.accelerator}>
                <td className="mono" style={{ fontSize: 12 }}>
                  {r.label}
                </td>
                <td className="muted">{PURPOSE[r.purpose]}</td>
                <td>
                  <span className="with-dot">
                    <span className={`dot ${STATUS[r.status].tone}`} aria-hidden="true" />
                    {STATUS[r.status].text}
                  </span>
                </td>
                <td className="muted">{r.owner ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="note">
        检测不到的情况：以非独占方式注册热键的程序（不少 Electron 应用），以及通过事件拦截抢占热键的程序（如
        Karabiner），所以「未发现占用」不等于一定空闲。
      </p>
    </div>
  );
}
