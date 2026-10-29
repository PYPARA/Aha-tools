import { useCallback, useEffect, useRef, useState } from "react";
import {
  CopyIcon, PageActions, invoke, saveFileDialog, withPinned, writeClipboardImage,
  type PluginViewProps,
} from "@ahatools/sdk";
import { hasTextSelection, imagePng } from "./image";
import { generatePixels, generateSvg, type CorrectionLevel } from "./qr";

const levels: { value: CorrectionLevel; label: string }[] = [
  { value: "L", label: "低" }, { value: "M", label: "中" },
  { value: "Q", label: "较高" }, { value: "H", label: "高" },
];

export default function Generate({ input, setStatus, openFeature }: PluginViewProps) {
  const [text, setText] = useState(input ?? "");
  const [level, setLevel] = useState<CorrectionLevel>("M");
  const [preview, setPreview] = useState({ key: "", svg: "", error: "" });
  const [busy, setBusy] = useState<"copy" | "save" | null>(null);
  const [notice, setNotice] = useState({ text: "", error: false });
  const mounted = useRef(false);
  const working = useRef(false);
  const key = JSON.stringify([text, level]);
  const ready = Boolean(text && preview.key === key && preview.svg);
  const error = preview.key === key ? preview.error : "";

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let stale = false;
    setNotice({ text: "", error: false });
    if (!text) {
      setPreview({ key, svg: "", error: "" });
      return;
    }
    generateSvg(text, level).then(
      (svg) => { if (!stale) setPreview({ key, svg, error: "" }); },
      () => { if (!stale) setPreview({ key, svg: "", error: "内容太长，无法生成二维码。请缩短内容或降低容错等级。" }); },
    );
    return () => { stale = true; };
  }, [text, level, key]);

  useEffect(() => {
    setStatus(busy === "copy" ? "正在复制图片…" : busy === "save" ? "正在保存图片…" : "边输入边更新 · ⌘C 复制图片");
  }, [busy, setStatus]);

  const exportImage = useCallback(async (action: "copy" | "save") => {
    if (!ready || working.current) return;
    working.current = true;
    setBusy(action);
    setNotice({ text: "", error: false });
    try {
      const pixels = generatePixels(text, level);
      let saved = true;
      if (action === "copy") {
        await writeClipboardImage(pixels);
      } else {
        const bytes = Array.from(new Uint8Array(await (await imagePng(pixels)).arrayBuffer()));
        saved = await withPinned(async () => {
          const path = await saveFileDialog({
            title: "保存二维码", defaultPath: "二维码.png", filters: [{ name: "PNG 图片", extensions: ["png"] }],
          });
          if (!path) return false;
          await invoke("qr_save_png", { path, bytes });
          return true;
        });
      }
      if (mounted.current && saved) setNotice({ text: action === "copy" ? "已复制二维码图片" : "已保存 PNG 图片", error: false });
    } catch (err) {
      if (mounted.current) setNotice({ text: `${action === "copy" ? "复制失败" : "保存失败"}：${String(err)}`, error: true });
    } finally {
      working.current = false;
      if (mounted.current) setBusy(null);
    }
  }, [ready, text, level]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.defaultPrevented && !e.isComposing && e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey &&
          e.key.toLowerCase() === "c" && !hasTextSelection() && ready) {
        e.preventDefault();
        void exportImage("copy");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, exportImage]);

  return (
    <div className="qr-view qr-generate">
      <PageActions>
        <button type="button" className="btn" onClick={() => openFeature({ plugin: "qrcode", feature: "scan" })}>
          识别剪贴板里的二维码
        </button>
      </PageActions>
      <div className="qr-column qr-editor">
        <label className="qr-label" htmlFor="qr-content">内容</label>
        <textarea
          id="qr-content" className="qr-textarea" autoFocus spellCheck={false}
          placeholder="输入文字或网址，即时生成二维码" value={text} onChange={(e) => setText(e.target.value)}
        />
        <div className="qr-editor-foot">
          <span className="note">{Array.from(text).length} 个字符{input !== undefined && text === input ? " · 从搜索框带入" : ""}</span>
          <fieldset className="qr-correction">
            <legend className="sr-only">容错等级</legend>
            <span className="note" aria-hidden="true">容错</span>
            <div className="seg">
              {levels.map((l) => (
                <button type="button" key={l.value} aria-pressed={level === l.value}
                  onClick={() => setLevel(l.value)}>{l.label}</button>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
      <div className="qr-column qr-preview-column">
        <span className="qr-label">预览</span>
        <div className="qr-code-preview" aria-busy={Boolean(text && !ready && !error)}>
          {ready ? (
            <div className="qr-generated-svg" role="img" aria-label="生成的二维码" dangerouslySetInnerHTML={{ __html: preview.svg }} />
          ) : <span className="qr-preview-note">{error ? "暂时无法生成二维码" : text ? "正在生成…" : "输入内容后，二维码会出现在这里"}</span>}
        </div>
        <div className="qr-export-actions">
          <button type="button" className="btn primary" disabled={!ready || busy !== null} onClick={() => void exportImage("copy")}>
            <CopyIcon />{busy === "copy" ? "正在复制…" : "复制图片"}
          </button>
          <button type="button" className="btn" disabled={!ready || busy !== null} onClick={() => void exportImage("save")}>
            {busy === "save" ? "正在保存…" : "保存 PNG…"}
          </button>
        </div>
        <p className="note">二维码始终是白底黑码，深色模式下也方便扫描</p>
        {(error || notice.text) && <p role={error || notice.error ? "alert" : "status"} className={`note ${error || notice.error ? "bad-text" : "ok-text"}`}>{error || notice.text}</p>}
      </div>
    </div>
  );
}
