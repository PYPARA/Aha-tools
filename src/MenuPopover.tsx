// The menu-bar popover (window "menu"): live network speed plus the app's switches.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { ChevronIcon, formatAccelerator, invoke, Switch, useAppearance, type Config } from "@ahatools/sdk";
import SystemMonitor from "./SystemMonitor";
import { EMPTY_SYSTEM, type SystemSnapshot } from "./sysmon";

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

const openSettings = () => invoke("menu_open_feature", { plugin: "settings", feature: "general" });

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


const W = 268;
const H = 44;
const SLOTS = 60;

function Sparkline({ history }: { history: [number, number][] }) {
  const max = Math.max(1024, ...history.flat());
  // Right-aligned: the newest sample sits at the right edge.
  const points = (pick: 0 | 1) =>
    history.map((s, i) => {
      const x = W - (history.length - 1 - i) * (W / (SLOTS - 1));
      const y = H - 3 - (s[pick] / max) * (H - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  const down = points(0);
  const up = points(1);
  const firstX = down[0]?.split(",")[0] ?? `${W}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="最近 60 秒网速曲线">
      {down.length > 1 && (
        <>
          <polygon points={`${firstX},${H} ${down.join(" ")} ${W},${H}`} fill="var(--accent)" opacity="0.1" />
          <polyline points={down.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
          <polyline points={up.join(" ")} fill="none" stroke="var(--text-3)" strokeWidth="1.2" strokeDasharray="3 3" />
        </>
      )}
    </svg>
  );
}

export default function MenuPopover() {
  useAppearance();
  const contentRef = useRef<HTMLDivElement>(null);
  const [net, setNet] = useState<Snapshot>(EMPTY);
  const [hotkey, setHotkey] = useState<HotkeyStatus | null>(null);
  const [system, setSystem] = useState<SystemSnapshot>(EMPTY_SYSTEM);
  const [autostart, setAutostart] = useState(false);
  const [cfg, setCfg] = useState<Config | null>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const popover = content?.parentElement;
    if (!content || !popover) return;
    let lastHeight = 0;
    const resize = () => {
      const border = popover.offsetHeight - popover.clientHeight;
      const height = Math.ceil(content.getBoundingClientRect().height + border);
      if (height === lastHeight) return;
      lastHeight = height;
      void invoke("menu_resize", { height }).catch(() => {});
    };
    // Measure the unconstrained content, even when a short screen makes it scroll.
    const observer = new ResizeObserver(resize);
    observer.observe(content);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    let visible = true;
    let request = 0;
    const updateSystem = (next: SystemSnapshot) => {
      if (alive && visible) setSystem((previous) => next.sequence >= previous.sequence ? next : previous);
    };
    const refresh = () => {
      visible = true;
      const currentRequest = ++request;
      void invoke<Snapshot>("netspeed_snapshot").then((next) => { if (alive) setNet(next); }).catch(() => {});
      void invoke<SystemSnapshot>("sysmon_snapshot").then((next) => {
        if (currentRequest === request) updateSystem(next);
      }).catch(() => {
        if (alive && visible && currentRequest === request) setSystem((previous) => ({
          ...previous,
          cpu: { usage: { state: "unavailable" }, history: [], busiest: { state: "unavailable" } },
          memory: { state: "unavailable" }, battery: { state: "unavailable" }, disk: { state: "unavailable" },
        }));
      });
      void invoke<HotkeyStatus>("hotkey_status").then((next) => { if (alive) setHotkey(next); }).catch(() => {});
      void invoke<Config>("config_get").then((next) => { if (alive) setCfg(next); }).catch(() => {});
      void isEnabled().then((next) => { if (alive) setAutostart(next); }).catch(() => {});
    };
    const subs = [
      listen<Snapshot>("netspeed", (e) => { if (alive && visible) setNet(e.payload); }),
      listen<SystemSnapshot>("sysmon", (e) => { request++; updateSystem(e.payload); }),
      listen<HotkeyStatus>("hotkey-status", (e) => { if (alive) setHotkey(e.payload); }),
      listen("menu-shown", refresh),
      listen("menu-hidden", () => { visible = false; request++; }),
      listen<Config>("config-changed", (e) => { if (alive) setCfg(e.payload); }),
    ];
    // Subscribe before reading the cache so the first sample cannot fall in a gap.
    void Promise.all(subs).then(() => { if (alive) refresh(); });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void invoke("menu_hide");
      // A menu-bar-only app has no app menu, so ⌘Q needs handling here.
      if (e.metaKey && e.key.toLowerCase() === "q") invoke("quit_app");
      if (e.metaKey && e.key === ",") openSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      subs.forEach((s) => s.then((f) => f()));
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const panelBinding = cfg?.hotkeys.find((b) => b.enabled && b.action.type === "togglePanel");
  const accelerator = panelBinding ? formatAccelerator(panelBinding.accelerator) : "";

  const tools = cfg
    ? [
        { id: "system", name: "系统截图" },
        ...cfg.relayApps.filter((a) => a.screenshot).map((a) => ({ id: a.id, name: a.ready ? a.name : `${a.name}（未设置）` })),
      ]
    : [];
  const setTool = (target: string) => {
    if (!cfg) return;
    const updated = { ...cfg, screenshot: { ...cfg.screenshot, target } };
    setCfg(updated);
    invoke("config_set", { config: updated });
  };

  const [down, downUnit] = splitRate(net.down);
  const [up, upUnit] = splitRate(net.up);

  const setExclusive = (on: boolean) => invoke<HotkeyStatus>("hotkey_set_exclusive", { enabled: on }).then(setHotkey);
  const setAutostartOn = async (on: boolean) => {
    await (on ? enable() : disable());
    setAutostart(await isEnabled());
  };

  return (
    <div className="popover" role="dialog" aria-label="AhaTools 菜单">
      <div className="popover-content" ref={contentRef}>
        <div className="pop-head">
          <strong>网速</strong>
          {net.iface && <span>{net.ifaceLabel ? `${net.ifaceLabel} · ${net.iface}` : net.iface}</span>}
        </div>

        <div className="speeds">
          <div className="speed">
            <span className="label">↓ 下载</span>
            <span className="value">
              {down}
              <small> {downUnit}</small>
            </span>
          </div>
          <div className="speed">
            <span className="label">↑ 上传</span>
            <span className="value">
              {up}
              <small> {upUnit}</small>
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

        <SystemMonitor snapshot={system} />

        <hr />

        <div className="menu-group">
          <button type="button" className="menu-row" onClick={() => invoke("menu_open_panel")}>
            打开搜索面板
            {accelerator && <span className="keys">{accelerator}</span>}
          </button>
          <label className="menu-row">
            截图工具
            <span className="value">
              {tools.find((t) => t.id === cfg?.screenshot.target)?.name ?? "系统截图"}
              <ChevronIcon />
            </span>
            <select aria-label="截图工具" value={cfg?.screenshot.target ?? "system"} onChange={(e) => setTool(e.target.value)}>
              {tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="menu-row">
            独占热键
            <span className="end">
              {hotkey?.enabled &&
                (hotkey.exclusive ? (
                  <span className="menu-state ok">已生效</span>
                ) : (
                  <button type="button" className="menu-state warn" onClick={() => invoke("hotkey_request_access")}>
                    等待授权
                  </button>
                ))}
              <Switch small label="独占热键" checked={!!hotkey?.enabled} onChange={setExclusive} />
            </span>
          </label>
        </div>

        <hr />

        <div className="menu-group">
          <button type="button" className="menu-row" onClick={openSettings}>
            设置…
            <span className="keys">⌘ ,</span>
          </button>
          <label className="menu-row">
            开机自动启动
            <Switch small label="开机自动启动" checked={autostart} onChange={setAutostartOn} />
          </label>
          <button type="button" className="menu-row" onClick={() => invoke("quit_app")}>
            退出 AhaTools
            <span className="keys">⌘ Q</span>
          </button>
        </div>
      </div>
    </div>
  );
}
