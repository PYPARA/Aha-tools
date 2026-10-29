// The web apps plugin's 设置 tab: the sites, each with an optional hotkey.

import { useState } from "react";
import { CloseIcon, HotkeyRecorder, WebIcon, type Config, type PluginSettingsProps, type WebApp } from "@ahatools/sdk";

/** "Kimi" → "kimi", unique among `taken`. */
function newId(name: string, taken: string[]) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/** Adds https:// when it was left out; null when it isn't a web address. */
function normalizeUrl(raw: string) {
  const text = raw.trim();
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

export default function WebAppsSettings({ cfg, save }: PluginSettingsProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [keywords, setKeywords] = useState("");
  const [error, setError] = useState("");

  const hotkeyIndex = (w: WebApp) =>
    cfg.hotkeys.findIndex((b) => b.action.type === "openWeb" && b.action.id === w.id);

  const setHotkey = (w: WebApp, accelerator: string) => {
    const i = hotkeyIndex(w);
    const hotkeys =
      i >= 0
        ? cfg.hotkeys.map((b, j) => (j === i ? { ...b, accelerator, enabled: true } : b))
        : [...cfg.hotkeys, { accelerator, action: { type: "openWeb" as const, id: w.id }, enabled: true }];
    save({ ...cfg, hotkeys });
  };

  const remove = (w: WebApp) =>
    save({
      ...cfg,
      webApps: cfg.webApps.filter((x) => x.id !== w.id),
      // Its hotkey would point at nothing.
      hotkeys: cfg.hotkeys.filter((b) => !(b.action.type === "openWeb" && b.action.id === w.id)),
    } as Config);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const full = normalizeUrl(url);
    if (!name.trim() || !full) {
      setError(!name.trim() ? "填一个名称" : "网址不对，例如 https://kimi.com");
      return;
    }
    const web: WebApp = {
      id: newId(name, cfg.webApps.map((w) => w.id)),
      name: name.trim(),
      url: full,
      keywords: keywords.split(/[,，\s]+/).filter(Boolean),
    };
    save({ ...cfg, webApps: [...cfg.webApps, web] });
    setName("");
    setUrl("");
    setKeywords("");
    setError("");
  };

  return (
    <>
      <p className="note tab-note">在搜索框输入名称或关键词打开。关掉窗口只是收起，对话和登录都会保留。</p>
      {cfg.webApps.length > 0 && (
        <ul className="web-list">
          {cfg.webApps.map((w) => {
            const b = cfg.hotkeys[hotkeyIndex(w)];
            return (
              <li key={w.id}>
                <WebIcon url={w.url} name={w.name} />
                <span className="row-text">
                  <span className="row-title inline">
                    {w.name}
                    {w.keywords.map((k) => (
                      <span key={k} className="chip sm">
                        {k}
                      </span>
                    ))}
                  </span>
                  <span className="row-desc">{w.url}</span>
                </span>
                <HotkeyRecorder
                  className="sm"
                  value={b?.enabled ? b.accelerator : ""}
                  placeholder="设为热键"
                  onChange={(acc) => setHotkey(w, acc)}
                />
                <button type="button" className="icon-btn sm" aria-label={`移除 ${w.name}`} onClick={() => remove(w)}>
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form className="inline" style={{ flexWrap: "nowrap" }} onSubmit={add}>
        <label className="sr-only" htmlFor="web-name">
          名称
        </label>
        <input id="web-name" className="input" style={{ width: 110 }} placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="sr-only" htmlFor="web-url">
          网址
        </label>
        <input
          id="web-url"
          className="input"
          style={{ flex: 1 }}
          placeholder="网址，如 https://kimi.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <label className="sr-only" htmlFor="web-keywords">
          关键词
        </label>
        <input
          id="web-keywords"
          className="input"
          style={{ width: 110 }}
          placeholder="关键词（可选）"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
        <button type="submit" className="btn">
          添加
        </button>
      </form>
      {error && <p className="note warn-text">{error}</p>}
    </>
  );
}
