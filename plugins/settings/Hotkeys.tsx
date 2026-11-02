import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ActionMenu, CloseIcon, formatAccelerator, HotkeyRecorder, invoke, Switch, type Binding } from "@ahatools/sdk";
import { actionChoices, describeAction } from "./actions";
import Row from "./Row";
import type { SectionProps } from "./Settings";

interface ProbeResult {
  accelerator: string;
  status: "free" | "occupied" | "system" | "self";
  owner: string | null;
}

/** Same combo regardless of modifier order or "4" vs "Digit4". */
const sameCombo = (a: string, b: string) => formatAccelerator(a) === formatAccelerator(b);

/** 「添加热键」: a button with a menu of everything a hotkey can do, grouped. */
function AddMenu({ choices, onPick }: { choices: ReturnType<typeof actionChoices>; onPick: (index: number) => void }) {
  return <ActionMenu label="添加热键" placeholder="添加热键" searchPlaceholder="搜索功能或插件…"
    options={choices.map((choice, index) => ({ value: String(index), label: choice.label, description: choice.detail, group: choice.group }))}
    onPick={(index) => onPick(Number(index))} />;
}

export default function Hotkeys({ cfg, save, manifests }: SectionProps) {
  const [probe, setProbe] = useState<ProbeResult[]>([]);
  const [exclusive, setExclusive] = useState(false);
  /** A row just added from 「添加热键」, recording its combo. */
  const [recording, setRecording] = useState<number | null>(null);

  useEffect(() => {
    invoke<ProbeResult[]>("hotkey_probe").then(setProbe);
    invoke<{ exclusive: boolean }>("hotkey_status").then((s) => setExclusive(s.exclusive));
    const un = listen<{ exclusive: boolean }>("hotkey-status", (e) => setExclusive(e.payload.exclusive));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const choices = actionChoices(cfg, manifests);
  const update = (i: number, patch: Partial<Binding>) =>
    save({ ...cfg, hotkeys: cfg.hotkeys.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const remove = (i: number) => save({ ...cfg, hotkeys: cfg.hotkeys.filter((_, j) => j !== i) });
  const add = (index: number) => {
    save({ ...cfg, hotkeys: [...cfg.hotkeys, { accelerator: "", action: choices[index].action, enabled: false }] });
    setRecording(cfg.hotkeys.length);
  };

  /** Problems to show under a row: duplicates, or a combo macOS itself uses. */
  const warning = (b: Binding, i: number) => {
    if (!b.accelerator || !b.enabled) return null;
    const key = formatAccelerator(b.accelerator);
    if (cfg.hotkeys.some((o, j) => j !== i && o.enabled && sameCombo(o.accelerator, b.accelerator))) {
      return `${key} 被设置了两次，只有一个会生效`;
    }
    const p = probe.find((r) => sameCombo(r.accelerator, b.accelerator));
    if (p?.status === "system") return `${key} 是系统「${p.owner}」的快捷键，设成它会让这个系统功能失效`;
    if (p?.status === "occupied" && !exclusive) return `${key} 已被其他程序占用（${p.owner ?? "未知"}），共享模式下会一起触发`;
    return null;
  };

  return (
    <>
      <div className="content-head">
        <span>
          <h1 className="page-h1">全局热键</h1>
          <span className="note">在任何应用里按下都会生效，改动立即生效</span>
        </span>
        <AddMenu choices={choices} onPick={add} />
      </div>
      {cfg.hotkeys.map((b, i) => {
        const { title, desc } = describeAction(b.action, cfg, manifests);
        const warn = warning(b, i);
        const relay = b.action.type === "forward" ? cfg.relayApps.find((a) => a.id === (b.action as { app: string }).app) : undefined;
        const below = (
          <>
            {warn && <span className="note warn-text">{warn}</span>}
            {relay && (
              <label className="inline note" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={relay.ready}
                  style={{ margin: 0, accentColor: "var(--accent)" }}
                  onChange={(e) =>
                    save({
                      ...cfg,
                      relayApps: cfg.relayApps.map((a) => (a.id === relay.id ? { ...a, ready: e.target.checked } : a)),
                    })
                  }
                />
                已在 {relay.name} 里把它的热键改成 {formatAccelerator(relay.accelerator)}；没勾选时不会转发
              </label>
            )}
          </>
        );
        return (
          <Row key={i} title={title} desc={desc} below={below}>
            <button type="button" className="icon-btn sm row-remove" aria-label={`删除「${title}」热键`} onClick={() => remove(i)}>
              <CloseIcon />
            </button>
            <HotkeyRecorder
              value={b.accelerator}
              placeholder="未设置"
              startRecording={recording === i}
              onCancel={() => setRecording(null)}
              onChange={(acc) => {
                setRecording(null);
                update(i, { accelerator: acc, enabled: true });
              }}
            />
            <Switch
              label={`启用「${title}」`}
              checked={b.enabled}
              disabled={!b.accelerator}
              onChange={(on) => update(i, { enabled: on })}
            />
          </Row>
        );
      })}
    </>
  );
}
