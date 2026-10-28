// The menu-bar popover (window "menu"): live network speed plus the app's switches.

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { invoke } from "@aha/sdk";

interface Snapshot {
  up: number;
  down: number;
  /** [down, up] per second, oldest first. */
  history: [number, number][];
  rxTotal: number;
  txTotal: number;
  iface: string | null;
  ifaceLabel: string | null;
}

interface HotkeyStatus {
  enabled: boolean;
  exclusive: boolean;
  trusted: boolean;
}

const EMPTY: Snapshot = { up: 0, down: 0, history: [], rxTotal: 0, txTotal: 0, iface: null, ifaceLabel: null };

/** 3.4 MB/s → ["3.4", "MB/s"]; same rules as the menu-bar icon. */
function splitRate(bytesPerSec: number): [string, string] {
  const kb = bytesPerSec / 1024;
  const [value, unit] = kb < 1000 ? [kb, "KB"] : kb / 1024 < 1000 ? [kb / 1024, "MB"] : [kb / 1024 / 1024, "GB"];
  return [unit !== "KB" && value < 10 ? value.toFixed(1) : value.toFixed(0), `${unit}/s`];
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : v.toFixed(0)} ${units[i]}`;
}

/** "Alt+Space" → "⌥Space" */
function prettyAccelerator(acc: string) {
  const symbols: Record<string, string> = { alt: "⌥", option: "⌥", super: "⌘", cmd: "⌘", control: "⌃", ctrl: "⌃", shift: "⇧" };
  return acc
    .split("+")
    .map((p) => symbols[p.toLowerCase()] ?? p.replace(/^Key/, ""))
    .join("");
}

const W = 276;
const H = 48;
const SLOTS = 60;

function Sparkline({ history }: { history: [number, number][] }) {
  const max = Math.max(1024, ...history.flat());
  // Right-aligned: the newest sample sits at the right edge.
  const points = (pick: 0 | 1) =>
    history.map((s, i) => {
      const x = W - (history.length - 1 - i) * (W / (SLOTS - 1));
      const y = H - 2 - (s[pick] / max) * (H - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  const down = points(0);
  const up = points(1);
  const firstX = down[0]?.split(",")[0] ?? `${W}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="最近 60 秒网速曲线">
      {down.length > 1 && (
        <>
          <polygon points={`${firstX},${H} ${down.join(" ")} ${W},${H}`} fill="var(--accent-soft)" />
          <polyline points={down.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" />
          <polyline points={up.join(" ")} fill="none" stroke="var(--text-2)" strokeWidth="1.2" strokeDasharray="3 2" />
        </>
      )}
    </svg>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="switch"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export default function MenuPopover() {
  const [net, setNet] = useState<Snapshot>(EMPTY);
  const [hotkey, setHotkey] = useState<HotkeyStatus | null>(null);
  const [accelerator, setAccelerator] = useState("⌥Space");
  const [autostart, setAutostart] = useState(false);

  const refresh = () => {
    invoke<Snapshot>("netspeed_snapshot").then(setNet);
    invoke<HotkeyStatus>("hotkey_status").then(setHotkey);
    isEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(false));
    invoke<{ accelerator: string; action: { type: string }; enabled: boolean }[]>("hotkey_bindings").then((bs) => {
      const b = bs.find((b) => b.enabled && b.action.type === "togglePanel");
      if (b) setAccelerator(prettyAccelerator(b.accelerator));
    });
  };

  useEffect(() => {
    refresh();
    const subs = [
      listen<Snapshot>("netspeed", (e) => setNet(e.payload)),
      listen<HotkeyStatus>("hotkey-status", (e) => setHotkey(e.payload)),
      listen("menu-shown", refresh),
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") getCurrentWindow().hide();
      // A menu-bar-only app has no app menu, so ⌘Q needs handling here.
      if (e.metaKey && e.key.toLowerCase() === "q") invoke("quit_app");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      subs.forEach((s) => s.then((f) => f()));
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const [down, downUnit] = splitRate(net.down);
  const [up, upUnit] = splitRate(net.up);

  const setExclusive = (on: boolean) => invoke<HotkeyStatus>("hotkey_set_exclusive", { enabled: on }).then(setHotkey);
  const setAutostartOn = async (on: boolean) => {
    await (on ? enable() : disable());
    setAutostart(await isEnabled());
  };

  return (
    <div className="popover" role="dialog" aria-label="AhaTools 菜单">
      <div className="popover-head">
        <span>网速</span>
        {net.iface && (
          <span className="chip">{net.ifaceLabel ? `${net.ifaceLabel} · ${net.iface}` : net.iface}</span>
        )}
      </div>

      <div className="speeds">
        <div className="speed">
          <span className="label">↓ 下载</span>
          <span className="value down">
            {down} <small>{downUnit}</small>
          </span>
        </div>
        <div className="speed">
          <span className="label">↑ 上传</span>
          <span className="value">
            {up} <small>{upUnit}</small>
          </span>
        </div>
      </div>

      <div className="graph">
        <Sparkline history={net.history} />
        <span className="graph-legend">
          <span>最近 60 秒</span>
          <span>
            开机以来 ↓ {formatBytes(net.rxTotal)} · ↑ {formatBytes(net.txTotal)}
          </span>
        </span>
      </div>

      <hr />

      <div className="menu-group">
        <button type="button" className="menu-row" onClick={() => invoke("menu_open_panel")}>
          打开搜索面板
          <kbd>{accelerator}</kbd>
        </button>
        <button
          type="button"
          className="menu-row"
          onClick={() => invoke("menu_open_feature", { plugin: "hotkeys", feature: "probe" })}
        >
          热键检测
        </button>
        <label className="menu-row">
          独占热键
          <span className="row-end">
            {hotkey?.enabled &&
              (hotkey.exclusive ? (
                <span className="state ok">已生效</span>
              ) : (
                <button type="button" className="state warn" onClick={() => invoke("hotkey_request_access")}>
                  等待授权
                </button>
              ))}
            <Switch label="独占热键" checked={!!hotkey?.enabled} onChange={setExclusive} />
          </span>
        </label>
      </div>

      <hr />

      <div className="menu-group">
        <label className="menu-row">
          开机自动启动
          <Switch label="开机自动启动" checked={autostart} onChange={setAutostartOn} />
        </label>
        <button type="button" className="menu-row" onClick={() => invoke("quit_app")}>
          退出 AhaTools
          <kbd>⌘Q</kbd>
        </button>
      </div>
    </div>
  );
}
