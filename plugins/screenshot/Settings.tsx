// The screenshot plugin's 设置 tab: one AhaTools hotkey, handed to the tool picked here.

import { useEffect, useState } from "react";
import {
  formatAccelerator,
  HotkeyRecorder,
  invoke,
  Select,
  type PluginSettingsProps,
  type RelayApp,
  type RelayStatus,
} from "@ahatools/sdk";

const PRESS_DELAY_S = 5;

/** Where each app keeps its screenshot shortcut. Wording stays general: menus move between versions. */
const GUIDES: Record<string, string> = {
  wechat: "在微信的设置里找到「快捷键 → 截取屏幕」",
  qq: "在 QQ 的设置里找到「热键 → 截图」",
  dingtalk: "在钉钉的设置里找到「快捷键 → 截图」",
};

function stateOf(app: RelayApp, status?: RelayStatus): [string, string] {
  if (!status) return ["", ""];
  if (status.installed && !app.ready) return ["还没设置暗号键", "warn-text"];
  if (status.running) return ["运行中", "ok-text"];
  return [status.installed ? "未运行" : "未安装", ""];
}

export default function ScreenshotSettings({ cfg, save }: PluginSettingsProps) {
  const [statuses, setStatuses] = useState<RelayStatus[]>([]);
  const [pressing, setPressing] = useState<string | null>(null);

  useEffect(() => {
    invoke<RelayStatus[]>("relay_status").then(setStatuses);
  }, []);

  const tools = cfg.relayApps.filter((a) => a.screenshot);
  const target = cfg.screenshot.target;
  const bindingIndex = cfg.hotkeys.findIndex((b) => b.action.type === "screenshot");
  const binding = cfg.hotkeys[bindingIndex];

  const setHotkey = (accelerator: string) => {
    const hotkeys =
      bindingIndex >= 0
        ? cfg.hotkeys.map((b, i) => (i === bindingIndex ? { ...b, accelerator, enabled: true } : b))
        : [...cfg.hotkeys, { accelerator, action: { type: "screenshot" as const }, enabled: true }];
    save({ ...cfg, hotkeys });
  };
  const setTarget = (id: string) => save({ ...cfg, screenshot: { ...cfg.screenshot, target: id } });
  const patchApp = (app: RelayApp, patch: Partial<RelayApp>) =>
    save({ ...cfg, relayApps: cfg.relayApps.map((a) => (a.id === app.id ? { ...a, ...patch } : a)) });
  // A new secret key has to be entered in the app again.
  const setSecret = (app: RelayApp, accelerator: string) => patchApp(app, { accelerator, ready: false });

  const pressLater = async (app: RelayApp) => {
    await invoke("relay_press_later", { id: app.id, delayMs: PRESS_DELAY_S * 1000 });
    setPressing(app.id);
    setTimeout(() => setPressing(null), PRESS_DELAY_S * 1000);
  };

  return (
    <>
      <div className="row" style={{ minHeight: 0, paddingTop: 0, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
        <span className="row-main">
          <span className="row-text">
            <span className="row-title">截图热键</span>
            <span className="row-desc">只有 AhaTools 响应，再交给下面选中的工具</span>
          </span>
          <HotkeyRecorder value={binding?.enabled ? binding.accelerator : ""} onChange={setHotkey} placeholder="未设置" />
        </span>
      </div>

      <div className="radio-list" role="radiogroup" aria-label="截图工具">
        <div className="radio-item">
          <label>
            <input type="radio" name="shot-tool" checked={target === "system"} onChange={() => setTarget("system")} />
            <span className="name">系统截图</span>
            <span className="note">{cfg.screenshot.systemMode === "region" ? "区域 → 剪贴板" : "截图工具栏"}</span>
          </label>
          {target === "system" && (
            <div className="radio-body">
              <p className="note">不用任何设置。选择截图方式：</p>
              <span className="inline">
                <Select<"region" | "toolbar"> id="system-mode" label="系统截图方式" className="sm" value={cfg.screenshot.systemMode}
                  onChange={(systemMode) => save({ ...cfg, screenshot: { ...cfg.screenshot, systemMode } })}
                  options={[{ value: "region", label: "选区域，存到剪贴板" }, { value: "toolbar", label: "打开系统截图工具栏" }]} />
                <button type="button" className="btn ghost sm accent" onClick={() => invoke("screenshot_take", { target: "system" })}>
                  测试截图
                </button>
              </span>
            </div>
          )}
        </div>

        {tools.map((app) => {
          const selected = target === app.id;
          const [state, tone] = stateOf(app, statuses.find((s) => s.id === app.id));
          return (
            <div key={app.id} className="radio-item">
              <label>
                <input type="radio" name="shot-tool" checked={selected} onChange={() => setTarget(app.id)} />
                <span className="name">{app.name}</span>
                <span className={`note ${tone}`}>{state}</span>
              </label>
              {selected && (
                <div className="radio-body">
                  <p className="note">
                    第一次使用：{GUIDES[app.id] ?? `打开${app.name}的快捷键设置，找到截图`}，点一下它的输入框，再点「
                    {PRESS_DELAY_S} 秒后代按」并切回去，AhaTools 会替你按下暗号键{" "}
                    <span className="mono" style={{ color: "var(--text)" }}>
                      {formatAccelerator(app.accelerator)}
                    </span>
                    。对方记下的组合如果和暗号键不一样（有的应用不收某些修饰键），把右下角的暗号键改成对方显示的那个。
                  </p>
                  {!app.ready && (
                    <p className="note warn-text">
                      设好之前，按截图热键会先用系统截图，免得按下去没反应。
                    </p>
                  )}
                  <span className="inline">
                    <button type="button" className="btn sm" disabled={pressing === app.id} onClick={() => pressLater(app)}>
                      {pressing === app.id ? "等待按下…" : `${PRESS_DELAY_S} 秒后代按`}
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm accent"
                      onClick={() => invoke("screenshot_take", { target: app.id })}
                    >
                      测试截图
                    </button>
                    <span className="note" style={{ marginLeft: "auto" }}>
                      暗号键
                    </span>
                    <HotkeyRecorder className="sm" value={app.accelerator} onChange={(acc) => setSecret(app, acc)} />
                  </span>
                  <label className="inline" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={app.ready}
                      onChange={(e) => patchApp(app, { ready: e.target.checked })}
                      style={{ margin: 0, accentColor: "var(--accent)" }}
                    />
                    <span>已在{app.name}里设好暗号键，「测试截图」能弹出{app.name}截图</span>
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
