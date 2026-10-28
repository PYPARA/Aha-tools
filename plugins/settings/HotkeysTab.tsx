import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CloseIcon, formatAccelerator, HotkeyRecorder, invoke } from "@ahatools/sdk";
import { screenshotToolName, type Action, type Binding, type Config } from "./types";

interface ProbeResult {
  accelerator: string;
  status: "free" | "occupied" | "system" | "self";
  owner: string | null;
}

interface HotkeyStatus {
  enabled: boolean;
  exclusive: boolean;
}

/** Same combo regardless of modifier order or "4" vs "Digit4". */
const sameCombo = (a: string, b: string) => formatAccelerator(a) === formatAccelerator(b);

/** Action ⇄ the value of the action <select>. */
function actionKey(a: Action) {
  switch (a.type) {
    case "forward":
      return `forward:${a.app}`;
    case "openFeature":
      return `openFeature:${a.plugin}/${a.feature}`;
    default:
      return a.type;
  }
}

function actionFromKey(key: string): Action {
  if (key.startsWith("forward:")) return { type: "forward", app: key.slice(8) };
  if (key.startsWith("openFeature:")) {
    const [plugin, feature] = key.slice(12).split("/");
    return { type: "openFeature", plugin, feature };
  }
  return { type: key as "togglePanel" | "screenshot" };
}

export default function HotkeysTab({ cfg, save }: { cfg: Config; save: (c: Config) => void }) {
  const [probe, setProbe] = useState<ProbeResult[]>([]);
  const [mode, setMode] = useState<HotkeyStatus | null>(null);

  useEffect(() => {
    invoke<ProbeResult[]>("hotkey_probe").then(setProbe);
    invoke<HotkeyStatus>("hotkey_status").then(setMode);
    const un = listen<HotkeyStatus>("hotkey-status", (e) => setMode(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const options = useMemo(() => {
    const opts = [
      { key: "togglePanel", label: "打开搜索面板" },
      { key: "screenshot", label: `截图（${screenshotToolName(cfg)}）` },
      ...cfg.relayApps.filter((a) => !a.screenshot).map((a) => ({ key: `forward:${a.id}`, label: `转发给 ${a.name}` })),
    ];
    // Keep actions this list doesn't offer (e.g. set by hand in config.json) selectable.
    for (const b of cfg.hotkeys) {
      const key = actionKey(b.action);
      if (!opts.some((o) => o.key === key)) opts.push({ key, label: key });
    }
    return opts;
  }, [cfg]);

  const update = (i: number, patch: Partial<Binding>) =>
    save({ ...cfg, hotkeys: cfg.hotkeys.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const remove = (i: number) => save({ ...cfg, hotkeys: cfg.hotkeys.filter((_, j) => j !== i) });
  const add = () =>
    save({ ...cfg, hotkeys: [...cfg.hotkeys, { accelerator: "", action: { type: "togglePanel" }, enabled: false }] });

  /** Problems to show under a row: duplicates, or a combo macOS itself uses. */
  const hint = (b: Binding, i: number) => {
    if (!b.accelerator) return null;
    if (cfg.hotkeys.some((o, j) => j !== i && o.enabled && b.enabled && sameCombo(o.accelerator, b.accelerator))) {
      return `${formatAccelerator(b.accelerator)} 被设置了两次，只有一个会生效。`;
    }
    const p = probe.find((r) => sameCombo(r.accelerator, b.accelerator));
    if (p?.status === "system") return `${formatAccelerator(b.accelerator)} 是系统「${p.owner}」的快捷键，设成它会让系统功能失效。`;
    if (p?.status === "occupied" && !mode?.exclusive) return `${formatAccelerator(b.accelerator)} 已被其他程序占用（${p.owner ?? "未知"}），共享模式下会一起触发。`;
    return null;
  };

  return (
    <>
      <ul className="list card">
        {cfg.hotkeys.map((b, i) => {
          const warning = hint(b, i);
          return (
            <li key={i} className="hotkey-row">
              <span className="hotkey-line">
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  aria-label="启用"
                  checked={b.enabled}
                  disabled={!b.accelerator}
                  onChange={(e) => update(i, { enabled: e.target.checked })}
                />
                <HotkeyRecorder value={b.accelerator} onChange={(acc) => update(i, { accelerator: acc, enabled: true })} />
                <span className="arrow" aria-hidden="true">
                  →
                </span>
                <label className="sr-only" htmlFor={`action-${i}`}>
                  动作
                </label>
                <select
                  id={`action-${i}`}
                  className="select"
                  value={actionKey(b.action)}
                  onChange={(e) => update(i, { action: actionFromKey(e.target.value) })}
                >
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn text icon" aria-label="删除这个热键" onClick={() => remove(i)}>
                  <CloseIcon />
                </button>
              </span>
              {warning && <span className="row-hint warn">{warning}</span>}
            </li>
          );
        })}
      </ul>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <button type="button" className="btn sm" onClick={add}>
          ＋ 添加热键
        </button>
        {mode && (
          <span className={`note ${mode.exclusive ? "ok-text" : "warn-text"}`}>
            {mode.exclusive
              ? "独占模式已生效：这些热键只有 AhaTools 响应"
              : mode.enabled
                ? "独占模式等待「辅助功能」授权，暂时和其他程序共享热键"
                : "共享模式：用同一热键的其他程序会一起触发"}
          </span>
        )}
      </div>
    </>
  );
}
