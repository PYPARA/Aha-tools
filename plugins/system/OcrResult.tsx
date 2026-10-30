import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CopyIcon, PageActions, RefreshIcon, Spinner, invoke, openPath, writeClipboardText, type PluginViewProps } from "@ahatools/sdk";
interface Job { id: string; phase: "capture" | "loading" | "success" | "empty" | "cancelled" | "error"; text: string; copied: boolean; message: string }
export default function OcrResult({ input, setStatus }: PluginViewProps) {
  const [job, setJob] = useState<Job | null>(null);
  const [notice, setNotice] = useState("");
  const [starting, setStarting] = useState(false);
  const current = useRef(input);
  const currentJob = useRef(job); currentJob.current = job;
  useEffect(() => {
    let live = true; current.current = input;
    const sub = listen<Job>("system-ocr-updated", (e) => { if (live && (!current.current || e.payload.id === current.current)) setJob(e.payload); });
    void sub.then(() => invoke<Job | null>("system_ocr_get", { jobId: input ?? null })).then((value) => { if (live) setJob(value); });
    return () => { live = false; void sub.then((off) => off()); };
  }, [input]);
  useEffect(() => { setStatus(notice || job?.message || "识字结果只在本次运行中保留"); }, [job, notice, setStatus]);
  const copy = async () => {
    const text = currentJob.current?.text; if (!text) return;
    try { await writeClipboardText(text); setNotice("已复制识别文字"); } catch (e) { setNotice(`复制失败：${String(e)}`); }
  };
  const copyRef = useRef(copy); copyRef.current = copy;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
        const target = e.target;
        if (target instanceof HTMLTextAreaElement && target.selectionStart !== target.selectionEnd) return;
        e.preventDefault(); void copyRef.current();
      }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const restart = async () => {
    setStarting(true); setNotice("");
    try { const id = await invoke<string>("system_run", { feature: "ocr" }); current.current = id; setJob(await invoke<Job>("system_ocr_get", { jobId: id })); }
    catch (e) { setNotice(String(e)); } finally { setStarting(false); }
  };
  const busy = starting || job?.phase === "capture" || job?.phase === "loading";
  return <div className="ocr-result">
    <PageActions><button type="button" className="btn" disabled={busy} onClick={() => void restart()}><RefreshIcon />重新截图</button>
      <button type="button" className="btn primary" disabled={!job?.text} onClick={() => void copy()}><CopyIcon />复制全部</button></PageActions>
    <div className="ocr-meta" role="status">{busy ? <Spinner label={job?.message ?? "正在开始截图…"} /> : <span>{notice || job?.message || "选择屏幕上的文字区域，识别后自动复制"}</span>}<span>全程在本机完成</span></div>
    {job?.text ? <textarea className="ocr-text" aria-label="识别文字" readOnly value={job.text} /> : <div className="ocr-empty"><FeatureIconPlaceholder />
      <h2>{job?.phase === "empty" ? "没有识别到文字" : job?.phase === "error" ? "识别未完成" : busy ? "正在处理截图" : "把画面中的文字留下来"}</h2>
      <p className="note">{job?.message ?? "点击「重新截图」，框选清晰的中文或英文。"}</p>
      {!busy && <button type="button" className="btn" onClick={() => void restart()}>开始截图识字</button>}
      {job?.phase === "error" && <button type="button" className="btn ghost" onClick={() => void openPath("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")}>打开屏幕录制设置</button>}
    </div>}
  </div>;
}
function FeatureIconPlaceholder() { return <span className="ocr-mark" aria-hidden="true">文</span>; }
