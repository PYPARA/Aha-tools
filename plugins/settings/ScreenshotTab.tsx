import { useEffect, useState } from "react";
import { formatAccelerator, HotkeyRecorder, invoke } from "@ahatools/sdk";
import type { Config, RelayApp, RelayStatus } from "./types";

const PRESS_DELAY_S = 5;

/** Where each app keeps its screenshot shortcut. Wording stays general: menus move between versions. */
const GUIDES: Record<string, string> = {
  wechat: "打开微信的设置，在「快捷键」里找到「截取屏幕」",
  qq: "打开 QQ 的设置，在「热键 / 快捷键」里找到「截图」",
  dingtalk: "打开钉钉的设置，在「快捷键」里找到「截图」",
};

function StatusTag({ status }: { status?: RelayStatus }) {
  if (!status) return null;
  if (status.running) return <span className="tag ok">运行中</span>;
  return <span className="pill">{status.installed ? "未运行" : "未安装"}</span>;
}

export default function ScreenshotTab({ cfg, save }: { cfg: Config; save: (c: Config) => void }) {
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
  const setSecret = (app: RelayApp, accelerator: string) =>
    save({ ...cfg, relayApps: cfg.relayApps.map((a) => (a.id === app.id ? { ...a, accelerator } : a)) });

  const pressLater = async (app: RelayApp) => {
    await invoke("relay_press_later", { id: app.id, delayMs: PRESS_DELAY_S * 1000 });
    setPressing(app.id);
    setTimeout(() => setPressing(null), PRESS_DELAY_S * 1000);
  };

  return (
    <>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <span className="note">按下截图热键时交给谁：</span>
        <span className="toolbar">
          <span className="note">截图热键</span>
          <HotkeyRecorder value={binding?.enabled ? binding.accelerator : ""} onChange={setHotkey} placeholder="未设置" />
        </span>
      </div>

      <div className="choices" role="radiogroup" aria-label="截图工具">
        <label className={`choice${target === "system" ? " selected" : ""}`}>
          <span className="choice-head">
            <input type="radio" name="shot-tool" checked={target === "system"} onChange={() => setTarget("system")} />
            <span className="choice-name">
              系统截图<span className="note"> 无需设置</span>
            </span>
            <select
              className="select sm"
              aria-label="系统截图方式"
              value={cfg.screenshot.systemMode}
              onChange={(e) =>
                save({ ...cfg, screenshot: { ...cfg.screenshot, systemMode: e.target.value as "region" | "toolbar" } })
              }
            >
              <option value="region">区域 → 剪贴板</option>
              <option value="toolbar">截图工具栏</option>
            </select>
          </span>
        </label>

        {tools.map((app) => {
          const selected = target === app.id;
          return (
            <div key={app.id} className={`choice${selected ? " selected" : ""}`}>
              <label className="choice-head">
                <input type="radio" name="shot-tool" checked={selected} onChange={() => setTarget(app.id)} />
                <span className="choice-name">{app.name}</span>
                <StatusTag status={statuses.find((s) => s.id === app.id)} />
                <span className="note">暗号键</span>
                <HotkeyRecorder className="sm" value={app.accelerator} onChange={(acc) => setSecret(app, acc)} />
              </label>
              {selected && (
                <div className="choice-body">
                  <p className="note">
                    一次性设置：{GUIDES[app.id] ?? `打开${app.name}的快捷键设置，找到截图`}，点一下输入框，再点「
                    {PRESS_DELAY_S} 秒后代按」并切回去，AhaTools 会替你按下 {formatAccelerator(app.accelerator)}。
                  </p>
                  <span className="toolbar">
                    <button type="button" className="btn sm" disabled={pressing === app.id} onClick={() => pressLater(app)}>
                      {pressing === app.id ? "等待按下…" : `${PRESS_DELAY_S} 秒后代按`}
                    </button>
                    <button type="button" className="btn sm" onClick={() => invoke("screenshot_take", { target: app.id })}>
                      测试截图
                    </button>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
