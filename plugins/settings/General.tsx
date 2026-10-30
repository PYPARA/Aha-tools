import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { HotkeyRecorder, invoke, Switch, withPinned, type Config, type MenubarItem } from "@ahatools/sdk";
import Row from "./Row";
import type { SectionProps } from "./Settings";

interface HotkeyStatus {
  enabled: boolean;
  exclusive: boolean;
}

const MENUBAR_ITEMS: { id: MenubarItem; name: string }[] = [
  { id: "netspeed", name: "网速" }, { id: "cpu", name: "CPU" }, { id: "memory", name: "内存" },
];

export default function General({ cfg, save }: SectionProps) {
  const [mode, setMode] = useState<HotkeyStatus | null>(null);
  const [autostart, setAutostart] = useState(false);

  useEffect(() => {
    invoke<HotkeyStatus>("hotkey_status").then(setMode);
    isEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(false));
    const un = listen<HotkeyStatus>("hotkey-status", (e) => setMode(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const set = (patch: Partial<Config>) => save({ ...cfg, ...patch });

  const panelIndex = cfg.hotkeys.findIndex((b) => b.action.type === "togglePanel");
  const panelKey = panelIndex >= 0 && cfg.hotkeys[panelIndex].enabled ? cfg.hotkeys[panelIndex].accelerator : "";
  const setPanelKey = (accelerator: string) =>
    set({
      hotkeys:
        panelIndex >= 0
          ? cfg.hotkeys.map((b, i) => (i === panelIndex ? { ...b, accelerator, enabled: true } : b))
          : [{ accelerator, action: { type: "togglePanel" }, enabled: true }, ...cfg.hotkeys],
    });

  const setAutostartOn = async (on: boolean) => {
    await (on ? enable() : disable());
    setAutostart(await isEnabled());
  };

  return (
    <>
      <h1 className="page-h1">通用</h1>
      <Row title="呼出快捷键" desc="打开搜索面板">
        <HotkeyRecorder value={panelKey} onChange={setPanelKey} placeholder="未设置" />
      </Row>
      <Row title="独占热键" desc="AhaTools 的热键只有它自己响应，uTools 等不会同时弹出">
        {mode?.enabled &&
          (mode.exclusive ? (
            <span className="note ok-text">已生效</span>
          ) : (
            <button
              type="button"
              className="btn ghost sm"
              style={{ color: "var(--warn)" }}
              onClick={() => withPinned(() => invoke("hotkey_request_access"))}
            >
              等待授权 · 去授权
            </button>
          ))}
        <Switch label="独占热键" checked={cfg.exclusiveHotkeys} onChange={(on) => set({ exclusiveHotkeys: on })} />
      </Row>
      <Row title="拼音搜索" desc="用全拼或首字母搜中文名，例如 wx 找到微信">
        <Switch label="拼音搜索" checked={cfg.pinyin} onChange={(on) => set({ pinyin: on })} />
      </Row>
      <section className="menubar-settings" aria-label="菜单栏显示">
        <h2>菜单栏显示</h2>
        <p className="note">可多选，新开启的项目排在末尾。都关闭时显示 AhaTools 标志。</p>
        {MENUBAR_ITEMS.map(({ id, name }) => <Row key={id} title={name} desc={id === "netspeed" ? "实时上传和下载速度" : "实时使用率"}>
          <Switch label={`菜单栏${name}`} checked={cfg.menubar.includes(id)} onChange={(on) => set({ menubar: on ? [...cfg.menubar.filter((item) => item !== id), id] : cfg.menubar.filter((item) => item !== id) })} />
        </Row>)}
        <p className="note menubar-order">{cfg.menubar.length ? `显示顺序：${cfg.menubar.map((id) => MENUBAR_ITEMS.find((item) => item.id === id)?.name).join(" → ")}` : "只显示 AhaTools 标志"}</p>
      </section>
      <Row title="开机自动启动" desc="登录后在菜单栏运行">
        <Switch label="开机自动启动" checked={autostart} onChange={setAutostartOn} />
      </Row>
      <Row title="外观" desc="浅色、深色或跟随系统">
        <label className="sr-only" htmlFor="appearance">
          外观
        </label>
        <select
          id="appearance"
          className="select"
          value={cfg.appearance}
          onChange={(e) => set({ appearance: e.target.value as Config["appearance"] })}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </Row>
    </>
  );
}
