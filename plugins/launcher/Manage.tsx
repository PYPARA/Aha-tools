import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FileIcon,
  FolderIcon,
  invoke,
  openPath,
  PathIcon,
  withPinned,
  type PathKind,
  type PluginViewProps,
} from "@aha/sdk";

interface Entry {
  name: string;
  path: string;
  kind: PathKind;
}

export default function Manage({ setStatus }: PluginViewProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    invoke<Entry[]>("launcher_saved").then(setEntries);
  }, []);

  useEffect(() => {
    setStatus(`${entries.length} 个收藏 · 搜索时排在应用前面`);
  }, [entries, setStatus]);

  const add = async (p: string, n?: string) => {
    setEntries(await invoke<Entry[]>("launcher_add", { path: p, name: n || null }));
  };

  const pick = async (directory: boolean) => {
    const picked = await withPinned(() => open({ directory, multiple: true }));
    if (!picked) return;
    for (const p of Array.isArray(picked) ? picked : [picked]) await add(p);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;
    await add(path.trim(), name.trim());
    setPath("");
    setName("");
  };

  const remove = async (p: string) => {
    setEntries(await invoke<Entry[]>("launcher_remove", { path: p }));
  };

  return (
    <div className="view">
      <form className="toolbar" onSubmit={submit}>
        <label htmlFor="saved-path" className="sr-only">
          路径或网址
        </label>
        <input
          id="saved-path"
          className="input"
          style={{ flex: 1 }}
          autoFocus
          placeholder="路径或网址，如 ~/Projects、https://…"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <label htmlFor="saved-name" className="sr-only">
          名称
        </label>
        <input
          id="saved-name"
          className="input"
          style={{ width: 132 }}
          placeholder="名称（可选）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn primary" type="submit">
          收藏
        </button>
        <span className="divider" aria-hidden="true" />
        <button className="btn" type="button" onClick={() => pick(false)} aria-label="选择文件或应用">
          <FileIcon size={15} />
          文件
        </button>
        <button className="btn" type="button" onClick={() => pick(true)} aria-label="选择文件夹">
          <FolderIcon size={15} />
          文件夹
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="note">还没有收藏。收藏后在搜索框输入名称就能直接打开，并且排在应用前面。</p>
      ) : (
        <ul className="list card">
          {entries.map((e) => (
            <li key={e.path}>
              <span className="tile sm" aria-hidden="true">
                <PathIcon kind={e.kind} size={15} />
              </span>
              <span className="info">
                <span className="name">{e.name}</span>
                <span className="path">{e.path}</span>
              </span>
              <button className="btn text" type="button" onClick={() => openPath(e.path)}>
                打开
              </button>
              <button className="btn text danger" type="button" onClick={() => remove(e.path)}>
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
