import { useEffect, useState } from "react";
import { invoke, openPath, menuPoint, showContextMenu, type ContextMenuEntry } from "@ahatools/sdk";
import { isImageFile, when, type Entry } from "./model";

function ImagePreview({ id, path }: { id: string; path?: string }) {
  const [result, setResult] = useState<{ src: string } | { error: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setResult(null);
    void invoke<string>("clipboard_history_image", { id, path: path ?? null }).then((src) => {
      if (live) setResult(src ? { src } : { error: "图片已丢失，无法预览" });
    }).catch((e) => { if (live) setResult({ error: String(e).replace(/^Error:\s*/, "") }); });
    return () => { live = false; };
  }, [id, path, retry]);
  return <div className="clip-image-preview">
    {!result ? <p className="note" role="status">正在读取图片…</p>
      : "error" in result ? <div className="clip-preview-error" role="status">
        <p className="note">{result.error}</p>
        <button className="btn sm" type="button" onClick={() => setRetry((n) => n + 1)}>重试</button>
      </div>
        : <img src={result.src} alt={path ? `图片预览：${path.split("/").pop()}` : "复制的图片"}
          onError={() => setResult({ error: "图片无法显示，可能已损坏；可重试或打开原文件查看" })} />}
  </div>;
}

export default function Preview({ entry, onError, menu }: { entry: Entry; onError: (message: string) => void; menu: (path?: string) => ContextMenuEntry[] }) {
  const [full, setFull] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState(entry.paths[0] ?? "");
  const path = entry.paths.includes(selectedPath) ? selectedPath : entry.paths[0];
  const fileImage = entry.kind === "files" && !!path && isImageFile(path);
  useEffect(() => {
    if (!entry.truncated) return;
    let live = true;
    void invoke<Entry | null>("clipboard_history_get", { id: entry.id }).then((e) => {
      if (live) { setFull(e); if (!e) setError("这条记录已删除"); }
    }).catch((e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [entry.id, entry.truncated]);
  const fileMenu = (event: React.MouseEvent, target?: string) => {
    event.preventDefault(); event.stopPropagation();
    if (target) setSelectedPath(target);
    void showContextMenu(menu(target), onError, menuPoint(event));
  };
  const shown = full ?? entry;
  return <div className="clip-preview" data-history-preview data-context-menu tabIndex={0} onContextMenu={(event) => fileMenu(event)}>
    {entry.kind === "image" || fileImage ? <div className="clip-preview-media" data-context-menu tabIndex={0} onContextMenu={(event) => fileMenu(event, fileImage ? path : undefined)}>
      <ImagePreview key={`${entry.id}:${fileImage ? path : "image"}`} id={entry.id} path={fileImage ? path : undefined} />
    </div> : null}
    {entry.kind === "files" ? <>
      <ul className={`clip-files${fileImage ? " with-image" : ""}`} aria-label="记录中的文件">
        {entry.paths.map((p, index) => <li key={`${p}:${index}`} tabIndex={0} data-context-menu onContextMenu={(event) => fileMenu(event, p)}>
          <button type="button" className={`clip-file-path mono${p === path ? " selected" : ""}`}
            aria-pressed={p === path} title={p} onClick={() => setSelectedPath(p)}>{p}</button>
        </li>)}
      </ul>
      <div className="clip-file-actions">
        <span className="note">{fileImage ? "图片文件 · 复制和粘贴仍使用原文件" : `${entry.paths.length} 个文件`}</span>
        {path && <button type="button" className="btn ghost sm" onClick={() => void openPath(path).catch((e) => onError(String(e)))}>打开原文件</button>}
      </div>
    </> : entry.kind === "text" ? <pre className="clip-text">{shown.text}</pre> : null}
    {error && <p className="note bad-text" role="alert">{error}</p>}
    <p className="note">{entry.app ? `来自 ${entry.app} · ` : ""}{when(entry.at)}{entry.kind === "text" ? ` · ${Array.from(shown.text).length} 字` : ""}{entry.pinned ? " · 已固定" : ""}</p>
  </div>;
}
