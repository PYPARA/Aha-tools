import type { SearchItem } from "./sdk";

export interface Home { recent: SearchItem[]; pinned: SearchItem[] }

export function pinKey(item: SearchItem): string {
  const action = item.action.type === "feature" ? { type: "feature", feature: item.action.feature } : item.action;
  return `${item.plugin}:${JSON.stringify(action)}`;
}

export function movePinned(items: SearchItem[], from: number, to: number): SearchItem[] {
  const reordered = [...items];
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return reordered;
  const [item] = reordered.splice(from, 1);
  reordered.splice(to, 0, item);
  return reordered;
}
