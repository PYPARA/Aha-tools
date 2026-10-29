import { useState } from "react";
import {
  HotkeyRecorder,
  PuzzleIcon,
  Switch,
  featureAction,
  sameAction,
  type Feature,
  type Manifest,
} from "@ahatools/sdk";
import { pluginIcons, pluginSettings } from "../../src/views";
import type { SectionProps } from "./Settings";

type Tab = "keywords" | "match" | "settings";

/** 自动匹配 conditions in plain words. */
function describeMatch(f: Feature) {
  const m = f.match ?? {};
  const parts = [];
  if (m.text) parts.push(m.minLength && m.minLength > 1 ? `任意文字，至少 ${m.minLength} 个字` : "任意文字");
  if (m.regex) parts.push(`符合规则 ${m.regex}`);
  if (m.files?.length) parts.push(`拖入 ${m.files.map((x) => `.${x}`).join(" ")} 文件`);
  return parts.join("；");
}

function Keywords({ plugin, cfg, save }: SectionProps & { plugin: Manifest }) {
  /** Feature whose 「设为热键」 was clicked and is recording. */
  const [recording, setRecording] = useState<string | null>(null);

  const setKey = (f: Feature, accelerator: string) => {
    setRecording(null);
    const action = featureAction(plugin.id, f.code);
    const i = cfg.hotkeys.findIndex((b) => sameAction(b.action, action));
    const hotkeys =
      i >= 0
        ? cfg.hotkeys.map((b, j) => (j === i ? { ...b, accelerator, enabled: true } : b))
        : [...cfg.hotkeys, { accelerator, action, enabled: true }];
    save({ ...cfg, hotkeys });
  };

  return (
    <>
      <p className="note tab-note">在搜索框里输入这些词，就能找到对应的功能。</p>
      {plugin.features.map((f) => {
        const b = cfg.hotkeys.find((b) => sameAction(b.action, featureAction(plugin.id, f.code)));
        const key = b?.enabled ? b.accelerator : "";
        return (
          <div key={f.code} className="feature-block">
            <span>
              <span className="row-title">{f.explain}</span>
              {key || recording === f.code ? (
                <span className="inline">
                  {key && <span className="note">热键</span>}
                  <HotkeyRecorder
                    className="sm"
                    value={key}
                    startRecording={recording === f.code}
                    onCancel={() => setRecording(null)}
                    onChange={(acc) => setKey(f, acc)}
                  />
                </span>
              ) : (
                <button type="button" className="btn ghost sm accent" onClick={() => setRecording(f.code)}>
                  设为热键
                </button>
              )}
            </span>
            <span className="chips">
              {f.cmds.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </>
  );
}

function Matches({ plugin, cfg, save }: SectionProps & { plugin: Manifest }) {
  const toggle = (key: string, on: boolean) =>
    save({
      ...cfg,
      disabledMatches: on ? cfg.disabledMatches.filter((k) => k !== key) : [...cfg.disabledMatches, key],
    });
  return (
    <>
      <p className="note tab-note">
        不用记关键词：输入或粘贴的内容符合条件时，它会出现在搜索结果的最后，不会挡住应用和常用结果。
      </p>
      {plugin.features
        .filter((f) => f.match)
        .map((f) => {
          const key = `${plugin.id}/${f.code}`;
          return (
            <div key={f.code} className="rule-card">
              <span className="row-text">
                <span className="row-title">{f.explain}</span>
                <span className="row-desc">条件：{describeMatch(f)}</span>
                <span className="row-desc">例如：输入一段符合条件的内容，结果最后出现「{f.explain}」</span>
              </span>
              <Switch label={`自动匹配「${f.explain}」`} checked={!cfg.disabledMatches.includes(key)} onChange={(on) => toggle(key, on)} />
            </div>
          );
        })}
    </>
  );
}

export default function Plugins(
  props: SectionProps & { initialPlugin?: string; initialTab?: string; errors: string[] },
) {
  const { manifests, cfg, save, initialPlugin, initialTab, errors } = props;
  const plugins = manifests.filter((m) => m.id !== "settings");
  const [selected, setSelected] = useState(initialPlugin ?? plugins[0]?.id);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? "keywords");
  const plugin = plugins.find((m) => m.id === selected) ?? plugins[0];
  if (!plugin) return <div className="detail" />;

  const PluginSettings = pluginSettings[plugin.id];
  const tabs: { id: Tab; label: string }[] = [
    { id: "keywords", label: "关键词" },
    ...(plugin.features.some((f) => f.match) ? [{ id: "match" as Tab, label: "自动匹配" }] : []),
    ...(PluginSettings ? [{ id: "settings" as Tab, label: "设置" }] : []),
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : "keywords";
  const Icon = pluginIcons[plugin.id] ?? PuzzleIcon;

  return (
    <>
      <ul className="plist" aria-label="已安装插件">
        {plugins.map((m) => {
          const MIcon = pluginIcons[m.id] ?? PuzzleIcon;
          return (
            <li key={m.id}>
              <button
                type="button"
                aria-current={m.id === plugin.id}
                onClick={() => {
                  setSelected(m.id);
                  setTab("keywords");
                }}
              >
                <span className="tile sm" aria-hidden="true">
                  <MIcon size={14} />
                </span>
                {m.name}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="detail">
        {errors.length > 0 && (
          <div className="banner" role="status">
            {errors.join("；")}
          </div>
        )}
        <div className="detail-head">
          <span className="tile xl" aria-hidden="true">
            <Icon size={22} />
          </span>
          <span>
            <strong>{plugin.name}</strong>
            <span className="note">
              {plugin.description} · 内置 {plugin.version}
            </span>
          </span>
        </div>
        <div className="seg" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={current === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {current === "keywords" && <Keywords {...props} plugin={plugin} />}
        {current === "match" && <Matches {...props} plugin={plugin} />}
        {current === "settings" && PluginSettings && <PluginSettings cfg={cfg} save={save} />}
      </div>
    </>
  );
}
