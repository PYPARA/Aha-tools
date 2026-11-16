import { invoke, openPath, pathMenuEntries, saveFileDialog, withPinned, type ContextMenuEntry } from "@ahatools/sdk";
import { isImageFile, type Entry } from "./model";
export function historyMenu(entry: Entry, callbacks: { use: (entry: Entry, paste: boolean) => unknown; pin: (entry: Entry) => unknown; remove: (entry: Entry) => unknown }, path?: string): ContextMenuEntry[] {
  const paths = path ? [path] : entry.paths;
  const quantity = entry.kind === "files" && entry.paths.length > 1 ? ` ${entry.paths.length} 个文件` : "";
  const imagePath = path ?? (paths.length === 1 ? paths[0] : undefined);
  const image = entry.kind === "image" || !!imagePath && isImageFile(imagePath);
  const imageAction = async (action: "copy" | "save") => {
    await withPinned(async () => {
      const destination = action === "save" ? await saveFileDialog({ title: "保存图片副本", defaultPath: imagePath?.split("/").pop() ?? "剪贴板图片.png" }) : null;
      if (action === "save" && !destination) return;
      await invoke("clipboard_history_image_action", { id: entry.id, path: imagePath ?? null, action, destination });
    });
  };
  return [
    { id: "paste", text: `粘贴${quantity}`, action: () => callbacks.use(entry, true) },
    { id: "copy-entry", text: entry.kind === "files" ? quantity ? `复制${quantity}` : "复制文件" : entry.kind === "image" ? "复制图片" : "复制全部", action: () => callbacks.use(entry, false) },
    ...(entry.kind === "files" && paths.length === 1 ? [{ id: "open", text: "打开原文件", action: () => openPath(paths[0]) }] : []),
    ...(image ? [
      ...(entry.kind === "files" ? [{ id: "copy-image", text: "复制当前图片", action: () => imageAction("copy") }] : []),
      { id: "save-image", text: entry.kind === "image" ? "保存 PNG…" : "当前图片另存副本…", action: () => imageAction("save") },
    ] : []),
    ...pathMenuEntries(paths),
    { item: "Separator" },
    { id: "pin", text: entry.pinned ? "取消固定这条历史" : "固定这条历史", action: () => callbacks.pin(entry) },
    { id: "delete", text: "删除这条历史", action: () => callbacks.remove(entry) },
  ];
}
