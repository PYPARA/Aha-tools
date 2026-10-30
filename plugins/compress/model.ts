export type ItemStatus = "waiting" | "running" | "compressed" | "unchanged" | "skipped" | "failed";
export interface CompressionItem {
  itemId: string;
  path: string;
  name: string;
  before: number;
  after: number | null;
  status: ItemStatus;
  version: number;
  message: string;
  outputName: string | null;
  canOverwrite: boolean;
}
export interface CompressionBatch {
  batchId: string;
  createdAt: number;
  quality: number;
  toWebp: boolean;
  items: CompressionItem[];
}
export type CompressionProgress = CompressionItem & { batchId: string };
export type ExportAction = "copy" | "save" | "overwrite";
export interface ExportResult { itemId: string; path: string | null; error: string | null }
export interface BatchState {
  batches: CompressionBatch[];
  pending: Record<string, CompressionItem[]>;
}
export const emptyState: BatchState = { batches: [], pending: {} };
export const isDone = (item: CompressionItem) => item.status !== "waiting" && item.status !== "running";
export const canExport = (item: CompressionItem) => item.status === "compressed" || item.status === "unchanged";

function mergeItems(current: CompressionItem[], updates: CompressionItem[]) {
  const map = new Map(current.map((item) => [item.itemId, item]));
  for (const item of updates) {
    const old = map.get(item.itemId);
    if (!old || item.version > old.version) map.set(item.itemId, item);
  }
  return [...map.values()];
}

/** Snapshots can arrive after events; item versions make both arrival orders safe. */
export function batchReducer(state: BatchState, action: { type: "snapshots"; batches: CompressionBatch[] } | { type: "progress"; progress: CompressionProgress }): BatchState {
  if (action.type === "progress") {
    const { batchId, ...item } = action.progress;
    if (!state.batches.some((b) => b.batchId === batchId)) {
      return { ...state, pending: { ...state.pending, [batchId]: mergeItems(state.pending[batchId] ?? [], [item]) } };
    }
    return { ...state, batches: state.batches.map((b) => b.batchId === batchId ? { ...b, items: mergeItems(b.items, [item]) } : b) };
  }
  const map = new Map(state.batches.map((b) => [b.batchId, b]));
  const pending = { ...state.pending };
  for (const batch of action.batches) {
    const old = map.get(batch.batchId);
    const items = mergeItems(old?.items ?? [], [...batch.items, ...(pending[batch.batchId] ?? [])]);
    map.set(batch.batchId, { ...batch, items });
    delete pending[batch.batchId];
  }
  return { batches: [...map.values()].sort((a, b) => a.createdAt - b.createdAt), pending };
}

export function parsePaths(input?: string): string[] {
  if (!input) return [];
  try {
    const value: unknown = JSON.parse(input);
    if (Array.isArray(value) && value.length > 0 && value.every((p) => typeof p === "string" && p.length > 0)) return value;
  } catch { /* Text entered after the command is not a file list. */ }
  throw new Error("文件列表无效，请拖入图片或选择文件");
}

export function summary(batch: CompressionBatch) {
  const finished = batch.items.filter(isDone).length;
  const failed = batch.items.filter((i) => i.status === "failed").length;
  const skipped = batch.items.filter((i) => i.status === "skipped").length;
  const usable = batch.items.filter(canExport);
  const before = usable.reduce((n, i) => n + i.before, 0);
  const after = usable.reduce((n, i) => n + (i.after ?? i.before), 0);
  return { finished, failed, skipped, saved: before - after, percent: before ? Math.round((before - after) / before * 100) : 0, done: finished === batch.items.length };
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function batchAge(createdAt: number, now: number) {
  const mins = Math.max(0, Math.floor((now - createdAt) / 60_000));
  return mins === 0 ? "刚刚" : mins < 60 ? `${mins} 分钟前` : `${Math.floor(mins / 60)} 小时前`;
}
