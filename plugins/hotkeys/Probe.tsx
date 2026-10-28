import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ClockIcon,
  invoke,
  RefreshIcon,
  SharedIcon,
  ShieldIcon,
  Spinner,
  withPinned,
  type PluginViewProps,
} from "@ahatools/sdk";

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

function ModeBanner({ status, onToggle, onRequest }: { status: HotkeyStatus; onToggle: () => void; onRequest: () => void }) {
  if (!status.enabled) {
    return (
      <div className="banner muted" role="status">
        <SharedIcon />
        <span className="message">
          <b>共享模式</b>同一热键的其他程序（如 uTools）会一起触发
        </span>
        <span className="actions">
          <button type="button" className="btn" onClick={onToggle}>
            开启独占
          </button>
        </span>
      </div>
    );
  }
  if (!status.exclusive) {
    return (
      <div className="banner warn" role="status">
        <ClockIcon />
        <span className="message">
          <b>等待授权</b>在系统设置里允许「辅助功能」后自动生效
        </span>
        <span className="actions">
          <button type="button" className="btn primary" onClick={onRequest}>
            去授权
          </button>
          <button type="button" className="btn" onClick={onToggle}>
            关闭独占
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="banner ok" role="status">
      <ShieldIcon />
      <span className="message">
        <b>独占模式</b>AhaTools 的热键只有它自己响应，其他程序不会再同时弹出
      </span>
      <span className="actions">
        <button type="button" className="btn" onClick={onToggle}>
          关闭独占
        </button>
      </span>
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
    if (!results) return setStatus("");
    const taken = results.filter((r) => r.status === "occupied").length;
    setStatus(`${results.length} 个候选热键 · ${taken} 个被占用`);
  }, [results, setStatus]);

  const requestAccess = () => withPinned(() => invoke("hotkey_request_access"));
  const toggle = () =>
    mode && withPinned(() => invoke<HotkeyStatus>("hotkey_set_exclusive", { enabled: !mode.enabled })).then(setMode);

  return (
    <div className="view">
      {mode && <ModeBanner status={mode} onToggle={toggle} onRequest={requestAccess} />}
      <div className="toolbar">
        <button type="button" className="btn sm" onClick={run}>
          <RefreshIcon />
          重新检测
        </button>
        <span className="note">「被占用」只说明有程序注册了它，占用者按常见默认键推测</span>
      </div>
      <div className="card">
        {!results ? (
          <div style={{ padding: 16 }}>
            <Spinner label="检测中…" />
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col" style={{ width: 104 }}>
                  热键
                </th>
                <th scope="col" style={{ width: 72 }}>
                  用途
                </th>
                <th scope="col" style={{ width: 128 }}>
                  状态
                </th>
                <th scope="col">占用者</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.accelerator}>
                  <td>
                    <kbd>{r.label}</kbd>
                  </td>
                  <td className="muted">{PURPOSE[r.purpose]}</td>
                  <td>
                    <span className={`tag ${STATUS[r.status].tone}`}>{STATUS[r.status].text}</span>
                  </td>
                  <td className="muted">{r.owner ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="note">
        检测不到的情况：以非独占方式注册热键的程序（不少 Electron 应用），以及通过事件拦截抢占热键的程序（如
        Karabiner），所以「未发现占用」不等于一定空闲。改 AhaTools 自己的热键：编辑 ~/Library/Application
        Support/com.ahatools.app/config.json 后重启。
      </p>
    </div>
  );
}
