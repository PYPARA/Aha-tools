// Mirrors src-tauri/src/plugins/clipboard_history.rs.

export type ClipKind = "text" | "image" | "files";
export interface Entry {
  id: string;
  kind: ClipKind;
  text: string;
  paths: string[];
  image: { file: string; width: number; height: number } | null;
  app: string | null;
  /** Seconds since the Unix epoch. */
  at: number;
  pinned: boolean;
  /** `text` is cut short in the list; the preview fetches the rest. */
  truncated: boolean;
}
export type Filter = "all" | ClipKind;

export const FILTERS: [Filter, string][] = [["all", "全部"], ["text", "文字"], ["image", "图片"], ["files", "文件"]];

/** Pinned first, then newest; filtered by kind and by words in the text, paths or app. */
export function visibleEntries(entries: Entry[], filter: Filter, query: string): Entry[] {
  const q = query.trim().toLowerCase();
  return entries
    .filter((e) => filter === "all" || e.kind === filter)
    .filter((e) => !q || e.text.toLowerCase().includes(q) || e.paths.some((p) => p.toLowerCase().includes(q)) || (e.app ?? "").toLowerCase().includes(q))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at);
}

/** One line for the list. */
export function title(e: Entry) {
  if (e.kind === "image") return e.image ? `图片 · ${e.image.width} × ${e.image.height}` : "图片";
  if (e.kind === "files") {
    const names = e.paths.map((p) => p.replace(/\/$/, "").split("/").pop());
    return names.length > 1 ? `${names[0]} 等 ${names.length} 个文件` : names[0] ?? "文件";
  }
  return e.text.replace(/\s+/g, " ").trim();
}

/** 「刚刚」「3 分钟前」「昨天 14:05」「11月3日」 */
export function when(at: number, now = Date.now() / 1000) {
  const ago = Math.max(0, now - at);
  if (ago < 60) return "刚刚";
  if (ago < 3600) return `${Math.floor(ago / 60)} 分钟前`;
  const date = new Date(at * 1000);
  const today = new Date(now * 1000);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `昨天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
