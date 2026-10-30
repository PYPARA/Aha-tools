import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke, openPath, PathIcon, withPinned, type PathKind, type PluginViewProps } from "@ahatools/sdk";

interface Entry {
  name: string;
  path: string;
  kind: PathKind;
}

/** Search text worth pre-filling as a path: "~/x", "/x" or a URL. */
const looksLikePath = (s: string) => /^(~\/|\/)|:\/\//.test(s);

export default function Manage({ setStatus, input, content }: PluginViewProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [path, setPath] = useState(content?.type === "files" ? content.paths[0] ?? "" : input && looksLikePath(input) ? input : "");
  const [name, setName] = useState(input && !looksLikePath(input) ? input : "");

  useEffect(() => {
    invoke<Entry[]>("launcher_saved").then(setEntries);
  }, []);

  useEffect(() => {
    setStatus(`${entries.length} 个收藏`);
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
      <p className="lede">收藏的文件、文件夹和网址，搜索时排在应用前面。</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <form className="inline" style={{ flexWrap: "nowrap" }} onSubmit={submit}>
          <label htmlFor="saved-path" className="sr-only">
            路径或网址
          </label>
          <input
            id="saved-path"
            className="input"
            style={{ flex: 1 }}
            autoFocus
            placeholder="粘贴路径或网址，如 ~/Projects"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <label htmlFor="saved-name" className="sr-only">
            名称
          </label>
          <input
            id="saved-name"
            className="input"
            style={{ width: 150 }}
            placeholder="名称（可选）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary lg" type="submit">
            收藏
          </button>
        </form>
        <span className="inline" style={{ gap: 4 }}>
          <button className="btn ghost sm muted" type="button" onClick={() => pick(false)}>
            选择文件…
          </button>
          <button className="btn ghost sm muted" type="button" onClick={() => pick(true)}>
            选择文件夹…
          </button>
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="note">还没有收藏。收藏后在搜索框输入名称就能直接打开。</p>
      ) : (
        <ul className="list">
          {entries.map((e) => (
            <li key={e.path}>
              <span className="tile" aria-hidden="true">
                <PathIcon kind={e.kind} />
              </span>
              <span className="info">
                <span className="name">{e.name}</span>
                <span className="path">{e.path}</span>
              </span>
              <span className="hover-actions">
                <button className="btn ghost" type="button" onClick={() => openPath(e.path)}>
                  打开
                </button>
                <button className="btn ghost danger" type="button" onClick={() => remove(e.path)}>
                  移除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
