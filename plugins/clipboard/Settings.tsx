// 剪贴板历史's 设置 tab: on / off, how much to keep, apps whose copies are never kept.

import { useState } from "react";
import { CloseIcon, Select, Switch, type PluginSettingsProps } from "@ahatools/sdk";

export default function ClipboardSettings({ cfg, save }: PluginSettingsProps) {
  const history = cfg.clipboardHistory;
  const [app, setApp] = useState("");
  const set = (patch: Partial<typeof history>) => save({ ...cfg, clipboardHistory: { ...history, ...patch } });
  const add = () => {
    const id = app.trim();
    if (id && !history.excludedApps.includes(id)) set({ excludedApps: [...history.excludedApps, id] });
    setApp("");
  };
  return <div className="clip-settings">
    <div className="row">
      <span className="row-text"><span className="row-title">记录剪贴板历史</span>
        <span className="note">保存在本机 AhaTools 数据目录，不加密、不上传，只有你的账户能读取</span></span>
      <Switch label="记录剪贴板历史" checked={history.enabled} onChange={(enabled) => set({ enabled })} />
    </div>
    <div className="row">
      <span className="row-text"><span className="row-title">最多保留</span><span className="note">超出后先删除最旧的，固定的记录不受限制</span></span>
      <Select<string> id="clip-max-items" label="最多保留" value={String(history.maxItems)} onChange={(v) => set({ maxItems: Number(v) })}
        options={[{ value: "100", label: "100 条" }, { value: "500", label: "500 条" }, { value: "1000", label: "1000 条" }]} />
    </div>
    <div className="row">
      <span className="row-text"><span className="row-title">保留时长</span></span>
      <Select<string> id="clip-max-days" label="保留时长" value={String(history.maxDays)} onChange={(v) => set({ maxDays: Number(v) })}
        options={[{ value: "7", label: "7 天" }, { value: "30", label: "30 天" }, { value: "90", label: "90 天" }]} />
    </div>
    <div className="clip-excluded">
      <span className="row-title">不记录这些应用</span>
      <span className="note">填写应用的 Bundle ID。标记为隐私的复制（多数密码管理器都会标记）本来就不会保存。</span>
      <ul>
        {history.excludedApps.map((id) => <li key={id}><span className="mono">{id}</span>
          <button type="button" className="icon-btn sm" aria-label={`移除 ${id}`} onClick={() => set({ excludedApps: history.excludedApps.filter((x) => x !== id) })}><CloseIcon /></button></li>)}
      </ul>
      <form className="net-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input mono" spellCheck={false} placeholder="例如 com.bitwarden.desktop" aria-label="应用 Bundle ID" value={app} onChange={(e) => setApp(e.target.value)} />
        <button type="submit" className="btn" disabled={!app.trim()}>添加</button>
      </form>
    </div>
  </div>;
}
