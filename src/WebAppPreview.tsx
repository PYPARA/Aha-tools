// Development-only visual proxy for the native window. It does not render in Tauri.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshIcon } from "./ui";
import "./webapp-preview.css";

interface Snapshot {
  name: string;
  url: string;
  reloads: number;
  offline: boolean;
  failed: boolean;
}

export default function WebAppPreview() {
  const [page, setPage] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const run = useCallback(async (command: string, args?: Record<string, unknown>) => {
    try { setPage(await invoke<Snapshot>(command, args)); setError(""); }
    catch (e) { setError(String(e)); }
  }, []);
  const reload = useCallback(() => void run("webapp_preview_reload"), [run]);
  useEffect(() => {
    const theme = new URLSearchParams(location.search).get("theme");
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    void run("webapp_preview_snapshot");
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault(); reload();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, reload]);
  return <main className="web-preview">
    <header className="web-preview-titlebar">
      <span className="web-preview-lights" aria-hidden="true"><i /><i /><i /></span>
      <span className="web-preview-name">{page?.name ?? "网页应用"}</span>
      <button type="button" className="web-preview-refresh" aria-label="刷新页面" title="刷新页面 ⌘R" onClick={reload}>
        <RefreshIcon size={16} />
      </button>
    </header>
    <section className="web-preview-page">
      <span className="note">网页内容区域（示意）</span>
      <h1>{page?.failed ? "暂时无法加载页面" : page?.url.endsWith("/articles/1") ? "示例文章" : "当前页面"}</h1>
      <p className="note">{page?.failed ? "请检查网络连接，再点击右上角刷新。" : "右上角可刷新当前页面，也可以按 ⌘R。"}</p>
      <p className="web-preview-url">{page?.url}</p>
      <div className="web-preview-fixtures">
        <button type="button" className="btn" onClick={() => void run("webapp_preview_navigate")}>打开示例子页面</button>
        <button type="button" className="btn" onClick={() => void run("webapp_preview_connection", { offline: !page?.offline })}>
          {page?.offline ? "恢复网络（模拟）" : "断开网络（模拟）"}
        </button>
      </div>
      <p className="note" role="status">已刷新 {page?.reloads ?? 0} 次 · {page?.offline ? "离线" : "已连接"}</p>
      {error && <p role="alert" className="bad-text">{error}</p>}
      <aside className="web-preview-disclaimer">开发预览：标题栏为样式示意，实际按钮由 macOS 绘制。Dock、全屏和真实登录状态需在 AhaTools 中确认。</aside>
    </section>
  </main>;
}
