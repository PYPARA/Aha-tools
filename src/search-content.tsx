import { useCallback, useEffect, useRef, useState } from "react";
import {
  CloseIcon, PathIcon, imagePng, onFileDrop, pixelsFromBlob, readClipboardFiles, readClipboardImage,
  type PluginContent,
} from "./sdk";

function contentLabel(content: PluginContent): string {
  if (content.type === "image") return `${content.name} · ${content.image.width} × ${content.image.height}`;
  return content.paths.length === 1 ? content.paths[0].split("/").pop() || "文件" : `${content.paths.length} 个文件`;
}

export function ContentChip({ content, clear }: { content: PluginContent; clear: () => void }) {
  const [preview, setPreview] = useState<{ content: PluginContent; url: string }>();
  useEffect(() => {
    let disposed = false;
    let previewUrl: string | undefined;
    if (content.type === "image") void imagePng(content.image).then((blob) => {
      if (disposed) return;
      previewUrl = URL.createObjectURL(blob);
      setPreview({ content, url: previewUrl });
    }).catch(() => {});
    return () => { disposed = true; if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [content]);
  const url = preview?.content === content ? preview.url : undefined;
  return (
    <span className="content-chip" title={contentLabel(content)}>
      {url ? <img src={url} alt="粘贴的图片" /> : <PathIcon kind="file" size={24} />}
      <span>{contentLabel(content)}</span>
      <button type="button" className="icon-btn" aria-label="移除输入内容" onClick={clear}><CloseIcon /></button>
    </span>
  );
}

/** Explicit paste/drop only: opening the panel never silently consumes the clipboard. */
export function useSearchContent(enabled: boolean, reset: () => void, report: (error: string | null) => void) {
  const [content, setContent] = useState<PluginContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const task = useRef(0);
  const callbacks = useRef({ reset, report });
  callbacks.current = { reset, report };
  const clear = useCallback(() => {
    task.current++;
    setContent(null);
    setLoading(false);
    setDragging(false);
    callbacks.current.reset();
    callbacks.current.report(null);
  }, []);
  const acceptPaths = useCallback((paths: string[]) => {
    if (!paths.length) return;
    task.current++;
    setLoading(false);
    setContent({ type: "files", paths });
    callbacks.current.reset();
    callbacks.current.report(null);
  }, []);

  useEffect(() => {
    if (!enabled) { task.current++; setLoading(false); return; }
    let disposed = false;
    const subscription = onFileDrop(acceptPaths);
    void subscription.catch(() => { if (!disposed) callbacks.current.report("无法监听文件拖放，请重新打开搜索面板"); });
    return () => { disposed = true; task.current++; void subscription.then((off) => off()).catch(() => {}); };
  }, [enabled, acceptPaths]);

  const paste = async (event: React.ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files);
    const text = event.clipboardData.getData("text/plain");
    const intercepted = files.length > 0 || !text;
    if (intercepted) event.preventDefault();
    const id = ++task.current;
    if (intercepted) {
      setContent(null);
      setLoading(true);
      callbacks.current.reset();
      callbacks.current.report(null);
    }
    try {
      // Finder may offer both file URLs and a thumbnail: preserve the actual paths first.
      const paths = await readClipboardFiles();
      if (id !== task.current) return;
      if (paths.length) { acceptPaths(paths); return; }
      if (!intercepted) return; // Ordinary text keeps the browser's native paste behavior.
      if (files.length > 1) throw new Error("每次粘贴一张图片；多个文件可从访达拖入");
      const image = files[0]?.type.match(/^image\/(png|jpeg|webp)$/)
        ? await pixelsFromBlob(files[0]) : await readClipboardImage();
      if (id !== task.current) return;
      if (!image) throw new Error("剪贴板里没有可用的图片或文件");
      setContent({ type: "image", name: files[0]?.name && files[0].name !== "image.png" ? files[0].name : "粘贴的图片", image });
    } catch (error) {
      if (id === task.current && intercepted) callbacks.current.report(`粘贴失败：${String(error).replace(/^Error: /, "")}`);
    } finally {
      if (id === task.current) setLoading(false);
    }
  };

  const drop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    // Native paths arrive through onFileDrop; browser previews provide File objects.
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    const id = ++task.current;
    setContent(null);
    setLoading(true);
    callbacks.current.reset();
    callbacks.current.report(null);
    try {
      if (files.length !== 1) throw new Error("每次拖入一张图片");
      if (!/^image\/(png|jpeg|webp)$/.test(files[0].type)) throw new Error("浏览器预览支持 PNG、JPEG 和 WebP 图片；桌面端也支持文件路径");
      const image = await pixelsFromBlob(files[0]);
      if (id === task.current) setContent({ type: "image", name: files[0].name, image });
    } catch (error) {
      if (id === task.current) callbacks.current.report(String(error).replace(/^Error: /, ""));
    } finally { if (id === task.current) setLoading(false); }
  };

  return { content, loading, dragging, clear, paste, drop, setDragging };
}
