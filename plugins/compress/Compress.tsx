import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  CopyIcon, FileIcon, PageActions, Switch, confirmAction, invoke, isNative, onFileDrop,
  onHostEvent, openFileDialog, withPinned, type PluginViewProps,
} from "@ahatools/sdk";
import {
  batchAge, batchReducer, canExport, emptyState, formatBytes, parsePaths, summary,
  type CompressionBatch, type CompressionItem, type CompressionProgress, type ExportAction, type ExportResult,
} from "./model";

function ItemResult({ item }: { item: CompressionItem }) {
  if (item.status === "running") return <span className="compress-progress" role="progressbar" aria-label={`${item.name} 正在压缩`}><i /></span>;
  if (item.status === "compressed") return <span className="ok-text">节省 {Math.round((1 - (item.after ?? item.before) / item.before) * 100)}%</span>;
  if (item.status === "unchanged") return <span>已是最小，保留原图</span>;
  return <span className={item.status === "failed" ? "bad-text" : ""}>{item.message}</span>;
}

export default function Compress({ input, setStatus }: PluginViewProps) {
  const [state, dispatch] = useReducer(batchReducer, emptyState);
  const [selectedId, setSelectedId] = useState<string>();
  const [quality, setQuality] = useState(80);
  const [toWebp, setToWebp] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [exportErrors, setExportErrors] = useState<ExportResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const mounted = useRef(false);
  const inputStarted = useRef(false);
  const inputBatchId = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  const selecting = useRef(false);
  const selectedRef = useRef<string | undefined>(undefined);
  const optionsRef = useRef({ quality, toWebp });
  optionsRef.current = { quality, toWebp };
  const batch = state.batches.find((b) => b.batchId === selectedId) ?? state.batches[state.batches.length - 1];
  selectedRef.current = batch?.batchId;
  const totals = batch ? summary(batch) : null;

  useEffect(() => {
    if (batch) { setQuality(batch.quality); setToWebp(batch.toWebp); }
    setExportErrors([]);
  }, [batch?.batchId]);

  const addPaths = useCallback(async (paths: string[], batchId = crypto.randomUUID()) => {
    if (!paths.length) return;
    try {
      const result = await invoke<CompressionBatch>("compress_start", { batchId, paths, ...optionsRef.current });
      if (!mounted.current) return;
      dispatch({ type: "snapshots", batches: [result] }); setSelectedId(result.batchId);
      setNotice({ text: "" });
    } catch (e) { if (mounted.current) setNotice({ text: String(e), error: true }); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        const off = await onHostEvent<CompressionProgress>("compress-progress", (progress) => {
          if (!disposed) dispatch({ type: "progress", progress });
        });
        if (disposed) { off(); return; }
        stop = off;
        const batches = await invoke<CompressionBatch[]>("compress_list_batches");
        if (disposed) return;
        dispatch({ type: "snapshots", batches });
        if (input && !inputStarted.current) {
          const paths = parsePaths(input); inputStarted.current = true;
          void addPaths(paths, inputBatchId.current);
        }
      } catch (e) { if (!disposed) setNotice({ text: String(e), error: true }); }
    })();
    const dropped = onFileDrop((paths) => { if (!disposed) void addPaths(paths); });
    void dropped.catch(() => { if (!disposed) setNotice({ text: "无法监听拖放，请使用选择文件", error: true }); });
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      disposed = true; mounted.current = false; stop?.(); clearInterval(timer);
      void dropped.then((off) => off()).catch(() => {});
    };
  }, [input, addPaths]);

  useEffect(() => {
    setStatus(totals && batch ? `完成 ${totals.finished}/${batch.items.length} · 失败 ${totals.failed} · 跳过 ${totals.skipped}` : "支持 PNG、JPEG、WebP · 全部在本机处理");
  }, [totals?.finished, totals?.failed, totals?.skipped, batch?.items.length, setStatus]);

  const reprocess = async (newQuality: number, newWebp: boolean) => {
    setQuality(newQuality); setToWebp(newWebp);
    if (!batch || !totals?.done || submitting.current || (newQuality === batch.quality && newWebp === batch.toWebp)) return;
    submitting.current = true; setBusy(true);
    try {
      const result = await invoke<CompressionBatch>("compress_reprocess", { sourceBatchId: batch.batchId, batchId: crypto.randomUUID(), quality: newQuality, toWebp: newWebp });
      if (mounted.current) { dispatch({ type: "snapshots", batches: [result] }); setSelectedId(result.batchId); setNotice({ text: "已从原始图片建立新批次" }); }
    } catch (e) {
      if (mounted.current) { setQuality(batch.quality); setToWebp(batch.toWebp); setNotice({ text: String(e), error: true }); }
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };

  const exportItems = useCallback(async (action: ExportAction, items?: CompressionItem[]) => {
    if (!batch || submitting.current || (!items && !summary(batch).done)) return;
    const selected = items ?? batch.items.filter((i) => canExport(i) && (action !== "overwrite" || i.canOverwrite));
    if (!selected.length) return;
    submitting.current = true; setBusy(true); setExportErrors([]);
    const batchId = batch.batchId;
    try {
      if (action === "overwrite" && !await withPinned(() => confirmAction(`将覆盖 ${selected.length} 张原图。此操作无法撤销，是否继续？`))) return;
      const results = await invoke<ExportResult[]>("compress_export", { batchId, itemIds: selected.map((i) => i.itemId), action });
      if (!mounted.current || selectedRef.current !== batchId) return;
      const errors = results.filter((r) => r.error);
      const success = results.length - errors.length;
      setExportErrors(errors);
      const verb = action === "copy" ? "复制" : action === "save" ? "另存" : "覆盖";
      setNotice({ text: `已${verb} ${success} 张${errors.length ? `，失败 ${errors.length} 张` : action === "copy" ? "，可在访达中粘贴" : ""}`, error: errors.length > 0 });
    } catch (e) { if (mounted.current) setNotice({ text: String(e), error: true }); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }, [batch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !e.metaKey || e.altKey || e.ctrlKey || e.shiftKey || e.key.toLowerCase() !== "c") return;
      if (window.getSelection()?.toString() || (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable=true]"))) return;
      if (!batch || !summary(batch).done || !batch.items.some(canExport)) return;
      e.preventDefault(); void exportItems("copy");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [batch, exportItems]);

  const choose = async () => {
    if (selecting.current) return;
    selecting.current = true; setChoosing(true);
    try {
      const paths = await withPinned(() => openFileDialog({ multiple: true, title: "选择要压缩的图片", filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }] }));
      if (paths) await addPaths(Array.isArray(paths) ? paths : [paths]);
    } catch (e) { if (mounted.current) setNotice({ text: String(e), error: true }); }
    finally { selecting.current = false; if (mounted.current) setChoosing(false); }
  };
  const exported = batch?.items.filter(canExport) ?? [];
  const canBatchExport = !!totals?.done && exported.length > 0 && !busy;
  const overwriteCount = exported.filter((i) => i.canOverwrite).length;
  const errorsById = new Map(exportErrors.map((r) => [r.itemId, r.error]));

  return (
    <div className={`compress-view${dragging ? " compress-dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault(); setDragging(false);
        if (isNative()) return;
        if (e.dataTransfer.files.length) setNotice({ text: "浏览器预览请使用「选择文件」或开发假数据拖放；真实文件请在 AhaTools 中导入" });
      }}>
      <PageActions>
        <button type="button" className="btn" disabled={!canBatchExport || overwriteCount === 0} onClick={() => void exportItems("overwrite")}>覆盖原图</button>
        <button type="button" className="btn" disabled={!canBatchExport} onClick={() => void exportItems("save")}>另存到原目录</button>
        <button type="button" className="btn primary" disabled={!canBatchExport} onClick={() => void exportItems("copy")}><CopyIcon />复制所有 <span className="mono">⌘C</span></button>
      </PageActions>
      <p className="note compress-intro">结果先放在临时目录，原图不动；压缩输出会移除拍摄信息。</p>
      <div className="compress-toolbar">
        <div className="compress-history" aria-label="压缩批次">
          {state.batches.map((b) => <button type="button" className={b.batchId === batch?.batchId ? "on" : ""} key={b.batchId} aria-pressed={b.batchId === batch?.batchId}
            onClick={() => { setSelectedId(b.batchId); setNotice({ text: "" }); }}>{batchAge(b.createdAt, now)} · {b.items.length} 张{summary(b).done ? "" : " · 处理中"}</button>)}
          {!state.batches.length && <span className="note">本次运行暂无批次</span>}
        </div>
        <div className="compress-options">
          <label htmlFor="compress-quality">质量</label>
          <input id="compress-quality" type="range" min="1" max="100" value={quality} disabled={busy || (!!batch && !totals?.done)}
            onChange={(e) => setQuality(Number(e.target.value))} onPointerUp={(e) => void reprocess(Number(e.currentTarget.value), toWebp)}
            onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) void reprocess(Number(e.currentTarget.value), toWebp); }}
            onBlur={(e) => void reprocess(Number(e.currentTarget.value), toWebp)} />
          <output className="mono" htmlFor="compress-quality">{quality}</output>
          <span className="compress-webp"><span>转 WebP</span><Switch label="转 WebP" checked={toWebp} disabled={busy || (!!batch && !totals?.done)} onChange={(on) => void reprocess(quality, on)} /></span>
        </div>
      </div>
      {batch ? <>
        <div className="compress-table-wrap">
          <table className="table compress-table"><thead><tr><th scope="col">文件</th><th scope="col">原大小</th><th scope="col">压缩后</th><th scope="col">结果</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
            <tbody>{batch.items.map((item) => <tr key={item.itemId}>
              <td><span className="compress-filename" title={item.path}><FileIcon /><span>{item.name}</span></span>{item.outputName && item.outputName !== item.name && <span className="note compress-output">→ {item.outputName}</span>}</td>
              <td className="muted">{item.before ? formatBytes(item.before) : "—"}</td><td>{item.after === null ? "—" : formatBytes(item.after)}</td>
              <td className="compress-result"><ItemResult item={item} />{item.status === "unchanged" && <span className="note">原格式与拍摄信息未改变</span>}{errorsById.has(item.itemId) && <span className="note bad-text" role="alert">{errorsById.get(item.itemId)}</span>}</td>
              <td><button type="button" className="icon-btn sm" aria-label={`复制 ${item.name}`} title="复制这张文件" disabled={!canExport(item) || busy} onClick={() => void exportItems("copy", [item])}><CopyIcon /></button></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="compress-summary" aria-live="polite"><span>{totals?.done ? "本批已处理完毕" : `正在处理 ${totals?.finished}/${batch.items.length}`}</span><span>共节省 {formatBytes(totals?.saved ?? 0)}（{totals?.percent ?? 0}%）</span></div>
        {batch.toWebp && <p className="note">转换格式的结果仅可另存或复制；未缩小时保留原格式。</p>}
      </> : <div className="compress-empty"><FileIcon size={36} /><h2>让图片轻一点</h2><p className="note">拖入图片或文件夹，或选择文件开始。文件夹只处理第一层。</p></div>}
      <div className="compress-drop note">{batch ? "继续拖入图片或文件夹，或" : "PNG、JPEG、WebP ·"} <button type="button" className="btn ghost accent" disabled={choosing} onClick={() => void choose()}>选择文件…</button></div>
      {notice.text && <p className={`note ${notice.error ? "bad-text" : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    </div>
  );
}
