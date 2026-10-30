import { useCallback, useEffect, useRef, useState } from "react";
import {
  CopyIcon, PageActions, QrCodeIcon, Spinner, invoke, onFileDrop, onPanelShown,
  openPath, readClipboardImage, writeClipboardText, type PluginViewProps, type RgbaImage,
} from "@ahatools/sdk";
import { hasTextSelection, imagePng, isEditingTarget, pixelsFromBlob } from "./image";
import { httpUrl, imageMime } from "./qr";
import type { ScanRequest, ScanResponse, ScanResult } from "./decode";

type Phase = "loading" | "empty" | "error" | "success" | "not-found";
interface Snapshot {
  phase: Phase;
  source: string;
  message: string;
  image?: { url: string; width: number; height: number };
  result?: ScanResult;
}

export default function Scan({ setStatus, openFeature, input }: PluginViewProps) {
  const [state, setState] = useState<Snapshot>({ phase: "loading", source: "剪贴板", message: "正在读取剪贴板…" });
  const [notice, setNotice] = useState({ text: "", error: false });
  const [dragging, setDragging] = useState(false);
  const task = useRef(0);
  const worker = useRef<Worker | null>(null);
  const previewUrl = useRef<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const w = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = ({ data }: MessageEvent<ScanResponse>) => {
      if (data.id !== task.current) return;
      setState((previous) => ({
        ...previous,
        phase: data.error ? "error" : data.result ? "success" : "not-found",
        message: data.error ?? (data.result ? "识别到 1 个二维码" : "图片中没有识别到二维码，请换一张清晰的图片"),
        result: data.result ?? undefined,
      }));
    };
    w.onerror = () => {
      if (mounted.current) setState((previous) => ({ ...previous, phase: "error", message: "识别失败，请重新读取图片", result: undefined }));
    };
    return () => {
      mounted.current = false;
      task.current++;
      w.terminate();
      worker.current = null;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    };
  }, []);

  const read = useCallback(async (source: string, load: () => Promise<RgbaImage | null>) => {
    const id = ++task.current;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setNotice({ text: "", error: false });
    setState({ phase: "loading", source, message: `正在读取${source === "剪贴板" ? "剪贴板" : "图片"}…` });
    try {
      const image = await load();
      if (id !== task.current) return;
      if (!image) {
        setState({ phase: "empty", source, message: "先截图或复制一张图片，也可以把图片拖进来" });
        return;
      }
      const blob = await imagePng(image);
      if (id !== task.current) return;
      const url = URL.createObjectURL(blob);
      previewUrl.current = url;
      setState({ phase: "loading", source, message: "正在识别二维码…", image: { url, width: image.width, height: image.height } });
      if (!worker.current) throw new Error("识别服务尚未就绪，请重试");
      const request: ScanRequest = { id, image };
      worker.current.postMessage(request, [image.rgba.buffer]);
    } catch (err) {
      if (id === task.current) setState((previous) => ({
        ...previous, phase: "error", message: `读取图片失败：${String(err)}`, result: undefined,
      }));
    }
  }, []);

  const reread = useCallback(() => read("剪贴板", readClipboardImage), [read]);

  const rejectFiles = useCallback((message: string) => {
    task.current++;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setNotice({ text: "", error: false });
    setState({ phase: "error", source: "拖入的图片", message });
  }, []);

  const readPaths = useCallback((paths: string[]) => {
    if (paths.length !== 1) { rejectFiles("每次拖入一张图片"); return; }
    const path = paths[0];
    const mime = imageMime(path);
    if (!mime) { rejectFiles("请选择 PNG、JPEG 或 WebP 图片"); return; }
    const name = path.split("/").pop() ?? "图片";
    void read(name, async () => pixelsFromBlob(new Blob([await invoke<ArrayBuffer>("qr_read_image", { path })], { type: mime })));
  }, [read, rejectFiles]);

  useEffect(() => {
    let supplied: string[] | undefined;
    try { const value = input ? JSON.parse(input) : null; if (Array.isArray(value?.paths)) supplied = value.paths.every((p: unknown) => typeof p === "string") ? value.paths : []; } catch { /* no file input */ }
    if (supplied) readPaths(supplied); else void reread();
    let disposed = false;
    const subscriptions = [onPanelShown(() => { if (supplied) readPaths(supplied); else void reread(); }), onFileDrop(readPaths)];
    for (const subscription of subscriptions) {
      subscription.catch(() => {
        if (!disposed) setNotice({ text: "无法监听图片拖放，请重新打开识别页面", error: true });
      });
    }
    return () => {
      disposed = true;
      subscriptions.forEach((s) => { void s.then((off) => off()).catch(() => {}); });
    };
  }, [reread, readPaths, input]);

  const result = state.result;
  const url = result ? httpUrl(result.text) : null;

  useEffect(() => {
    setStatus(state.phase === "loading" ? state.message : `读自${state.source}${url ? " · ↵ 打开链接" : result ? " · ⌘C 复制文字" : ""}`);
  }, [state.phase, state.message, state.source, url, result, setStatus]);

  const copy = useCallback(async () => {
    if (!result) return;
    const id = task.current;
    try {
      await writeClipboardText(result.text);
      if (mounted.current && task.current === id) setNotice({ text: "已复制识别文字", error: false });
    } catch (err) {
      if (mounted.current && task.current === id) setNotice({ text: `复制失败：${String(err)}`, error: true });
    }
  }, [result]);

  const openLink = useCallback(async () => {
    if (!url) return;
    const id = task.current;
    try { await openPath(url); }
    catch (err) {
      if (mounted.current && task.current === id) setNotice({ text: `打开链接失败：${String(err)}`, error: true });
    }
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "c" && result && !hasTextSelection()) {
        e.preventDefault(); void copy();
      } else if (e.key === "Enter" && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && url && !isEditingTarget(e.target)) {
        e.preventDefault(); void openLink();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, url, copy, openLink]);

  const dropFiles = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    // Browsers provide File objects; Tauri provides native paths through onFileDrop.
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    if (files.length !== 1) { rejectFiles("每次拖入一张图片"); return; }
    if (!imageMime(files[0].name)) { rejectFiles("请选择 PNG、JPEG 或 WebP 图片"); return; }
    void read(files[0].name, () => pixelsFromBlob(files[0]));
  };

  return (
    <div className={`qr-view qr-scan${dragging ? " qr-dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }} onDrop={dropFiles}>
      <PageActions><button type="button" className="btn" onClick={() => void reread()}>重新读取剪贴板</button></PageActions>
      <div className="qr-column qr-source-column">
        <span className="qr-label">{state.source === "剪贴板" ? "剪贴板里的图片" : "拖入的图片"}</span>
        <div className="qr-source-preview" aria-label="待识别的图片" aria-busy={state.phase === "loading"}>
          {state.image ? (
            <svg viewBox={`0 0 ${state.image.width} ${state.image.height}`} role="img" aria-label="图片与二维码识别位置">
              <rect width={state.image.width} height={state.image.height} fill="#fff" />
              <image href={state.image.url} width={state.image.width} height={state.image.height} />
              {result && <polygon className="qr-location" points={result.corners.map((p) => `${p.x},${p.y}`).join(" ")} vectorEffect="non-scaling-stroke" />}
            </svg>
          ) : (
            <div className="qr-source-placeholder"><QrCodeIcon size={32} /><span>把图片拖到这里</span><span className="note">PNG、JPEG、WebP</span></div>
          )}
        </div>
        <p className="note">也可以把图片拖进来</p>
      </div>
      <div className="qr-column qr-result-column" aria-live="polite">
        {state.phase === "loading" ? <Spinner label={state.message} /> : (
          <p className="qr-result-message" role={state.phase === "error" ? "alert" : undefined}>
            <span className={`dot ${result ? "ok" : state.phase === "error" ? "bad" : ""}`} />{state.message}
          </p>
        )}
        {result && <>
          <label htmlFor="qr-result" className="sr-only">识别内容</label>
          <textarea id="qr-result" className="qr-textarea qr-result-text mono" readOnly value={result.text} spellCheck={false} />
          <div className="qr-result-actions">
            {url && <button type="button" className="btn primary" onClick={() => void openLink()}>在浏览器中打开</button>}
            <button type="button" className={`btn${url ? "" : " primary"}`} onClick={() => void copy()}><CopyIcon />复制文字</button>
            <button type="button" className="btn ghost muted qr-regenerate" onClick={() => openFeature({ plugin: "qrcode", feature: "generate", input: result.text })}>生成同样的二维码</button>
          </div>
        </>}
        {!result && state.phase !== "loading" && <p className="note">截图或复制图片后，点击右上角重新读取。也可以直接拖入图片。</p>}
        {notice.text && <p className={`note ${notice.error ? "bad-text" : "ok-text"}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
      </div>
    </div>
  );
}
