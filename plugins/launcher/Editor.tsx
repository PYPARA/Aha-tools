import { useEffect, useState } from "react";
import { Select, invoke, openFileDialog, withPinned, type SavedEntry } from "@ahatools/sdk";
import Modal from "../../src/Modal";
export default function Editor({ entry, mode, onClose, onSaved }: { entry: SavedEntry; mode: "edit" | "openWith"; onClose: () => void; onSaved: (entries: SavedEntry[]) => void }) {
  const [name, setName] = useState(entry.name), [path, setPath] = useState(entry.path), [application, setApplication] = useState(entry.openWithApp ?? "");
  const [apps, setApps] = useState<SavedEntry[]>([]), [remember, setRemember] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { void invoke<SavedEntry[]>("launcher_apps").then(setApps).catch((e) => setError(String(e))); }, []);
  const choose = async (value: string) => {
    if (value !== "__other") { setApplication(value); return; }
    try { const picked = await withPinned(() => openFileDialog({ title: "选择打开应用", defaultPath: "/Applications", filters: [{ name: "应用", extensions: ["app"] }] })); if (typeof picked === "string") setApplication(picked); }
    catch (e) { setError(String(e)); }
  };
  const canChoose = !/^[a-z][a-z\d+.-]*:/i.test(path) && !path.endsWith(".app");
  const save = async () => {
    setBusy(true); setError("");
    try {
      if (mode === "edit" || remember) onSaved(await invoke<SavedEntry[]>("launcher_update", { id: entry.id, name, path, openWithApp: canChoose && application ? application : null }));
      if (mode === "openWith") await invoke("launcher_open", { id: entry.id, application: application || "" });
      onClose();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <Modal title={mode === "edit" ? "编辑收藏" : "打开方式"} busy={busy} onClose={onClose}>
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="edit-form">
      {mode === "edit" && <><label>名称<input className="input" autoFocus value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label><label>路径或网址<input className="input" value={path} disabled={busy} onChange={(e) => setPath(e.target.value)} /></label></>}
      {canChoose && <><label>打开应用</label><Select label="打开应用" value={application} disabled={busy} options={[
        { value: "", label: "跟随系统" }, ...apps.map((a) => ({ value: a.path, label: a.name })),
        ...(!apps.some((a) => a.path === application) && application ? [{ value: application, label: application.split("/").pop() ?? application }] : []),
        { value: "__other", label: "选择其他应用…" },
      ]} onChange={(value) => void choose(value)} searchable /></>}
      {mode === "openWith" ? <label className="inline"><input type="checkbox" checked={remember} disabled={busy} onChange={(e) => setRemember(e.target.checked)} />设为此收藏的默认应用</label> : <p className="note">仅用于这条收藏；可选择“跟随系统”恢复默认。</p>}
      {error && <p className="note bad-text" role="alert">{error}</p>}
      <div className="row-actions end"><button type="button" className="btn" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="btn primary" disabled={busy || !name.trim() || !path.trim()}>{busy ? "正在处理…" : mode === "edit" ? "保存" : remember ? "设为默认并打开" : "仅本次打开"}</button></div>
    </form>
  </Modal>;
}
