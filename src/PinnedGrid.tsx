import { useEffect, useImperativeHandle, useRef, useState, type ComponentProps, type ReactNode, type Ref } from "react";
import {
  DragDropProvider, useDragDropManager, useDragDropMonitor,
} from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { closestCenter, defaultCollisionDetection, type CollisionDetector } from "@dnd-kit/collision";
import { Accessibility, AutoScroller, Droppable, Feedback, KeyboardSensor, PointerActivationConstraints, PointerSensor, type DragStartEvent, type DragOverEvent, type DragEndEvent } from "@dnd-kit/dom";
import { invoke, type SearchItem } from "./sdk";
import { movePinned, pinKey, type Home } from "./pinned-sort";

const transition = { duration: 180, easing: "ease-out", idle: true };

/** The empty part of the last row is a forgiving way to move a pin to the end. */
const gridCollision: CollisionDetector = (args) => {
  const { droppable, dragOperation } = args;
  if (dragOperation.activatorEvent instanceof KeyboardEvent || !(droppable instanceof Droppable) || !isSortable(droppable)) return defaultCollisionDetection(args);
  const grid = droppable.element?.closest<HTMLElement>(".pinned-grid");
  if (!grid) return null;
  const { x, y } = dragOperation.position.current;
  const box = grid.getBoundingClientRect();
  const css = getComputedStyle(grid);
  const columns = css.gridTemplateColumns.split(" ").length;
  const count = grid.querySelectorAll("[data-pin-key]:not([data-dnd-placeholder])").length;
  const gap = parseFloat(css.columnGap) || 0;
  const rowGap = parseFloat(css.rowGap) || 0;
  const rowHeight = droppable.element?.clientHeight ?? 88;
  const columnWidth = (box.width - gap * (columns - 1)) / columns;
  const lastRow = Math.floor((count - 1) / columns);
  const lastColumn = (count - 1) % columns;
  if (y >= box.top + lastRow * (rowHeight + rowGap) && y <= box.bottom && x >= box.left && x <= box.right &&
      x > box.left + (lastColumn + 1) * (columnWidth + gap)) {
    return droppable.index === count - 1 ? closestCenter(args) : null;
  }
  return defaultCollisionDetection(args);
};
const sensors = [
  PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })] }),
  KeyboardSensor.configure({ keyboardCodes: { ...KeyboardSensor.defaults.keyboardCodes, start: ["Space"] } }),
];
const plugins: ComponentProps<typeof DragDropProvider>["plugins"] = (defaults) => [
  ...defaults,
  Feedback.configure({ dropAnimation: { duration: 180, easing: "ease-out" }, keyboardTransition: transition }),
  AutoScroller.configure({ acceleration: 12, threshold: { x: 0, y: .15 } }),
  Accessibility.configure({
    screenReaderInstructions: { draggable: "按空格键提起固定项，用方向键调整位置，再按空格或回车放下，按 Esc 取消。" },
    announcements: {
      dragstart: ({ operation }: DragStartEvent) => `已提起「${operation.source?.data.title ?? "固定项"}」，用方向键移动，Esc 取消。`,
      dragover: ({ operation }: DragOverEvent) => isSortable(operation.source) ? `移动到第 ${operation.source.index + 1} 个位置。` : undefined,
      dragend: ({ canceled }: DragEndEvent) => canceled ? "已取消排序。" : "已放下固定项。",
    },
  }),
];

export interface PinnedGridHandle {
  cancel: () => boolean;
  isSorting: () => boolean;
}

interface Props {
  ref: Ref<PinnedGridHandle>;
  items: SearchItem[];
  selected: number;
  offset: number;
  onSelect: (index: number) => void;
  onOpen: (item: SearchItem) => void;
  onContextMenu: (event: React.MouseEvent, item: SearchItem) => void;
  onReorder: (items: SearchItem[]) => void;
  onReload: (home: Home) => void;
  onReport: (message: string, error?: boolean) => void;
  renderIcon: (item: SearchItem) => ReactNode;
}

function PinnedItem({ item, index, selected, disabled, onSelect, onOpen, onContextMenu, renderIcon }: {
  item: SearchItem;
  index: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  renderIcon: Props["renderIcon"];
}) {
  const { ref } = useSortable({
    id: pinKey(item), index, group: "pinned", type: "pinned", accept: "pinned",
    data: { title: item.title }, transition, disabled, collisionDetector: gridCollision,
  });
  return (
    <button ref={ref} type="button" data-pin-index={index} data-pin-key={pinKey(item)}
      className={`grid-item pinned-item${selected ? " selected" : ""}`} aria-roledescription="可排序的固定项"
      onClick={onOpen} onMouseMove={onSelect} onContextMenu={onContextMenu} title={item.subtitle}>
      <span className="pinned-content">{renderIcon(item)}<span className="label">{item.title}</span></span>
    </button>
  );
}

function Items({ ref, items, selected, offset, onSelect, onOpen, onContextMenu, onReorder, onReload, onReport, renderIcon }: Props) {
  const manager = useDragDropManager();
  const grid = useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = useState(false);
  const [saving, setSaving] = useState(false);
  const snapshot = useRef(items);
  const savingRef = useRef(false);
  const blockClickUntil = useRef(0);
  const mounted = useRef(false);

  useImperativeHandle(ref, () => ({
    cancel: () => {
      if (!manager || manager.dragOperation.status.idle) return false;
      if (manager.dragOperation.status.dragging) manager.actions.stop({ canceled: true });
      return true;
    },
    isSorting: () => Boolean(manager && !manager.dragOperation.status.idle),
  }), [manager]);

  useEffect(() => {
    mounted.current = true;
    const cancel = () => { if (manager?.dragOperation.status.dragging) manager.actions.stop({ canceled: true }); };
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      mounted.current = false;
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      cancel();
    };
  }, [manager]);

  useDragDropMonitor({
    onBeforeDragStart: (event) => { if (savingRef.current) event.preventDefault(); },
    onDragStart: ({ operation }) => {
      snapshot.current = items;
      setSorting(true);
      const index = items.findIndex((item) => pinKey(item) === operation.source?.id);
      onSelect(offset + index);
    },
    onDragEnd: async (event) => {
      setSorting(false);
      blockClickUntil.current = performance.now() + 180;
      const { source } = event.operation;
      if (!isSortable(source) || event.canceled) return;
      const { initialIndex, index } = source;
      if (initialIndex === index) return;
      const reordered = movePinned(snapshot.current, initialIndex, index);
      const item = reordered[index];
      if (!item) return;
      // Render the final order immediately; the native write must not hold up the drop.
      onReorder(reordered);
      onSelect(offset + index);
      savingRef.current = true;
      setSaving(true);
      try {
        const next = await invoke<Home>("usage_reorder_pinned", { item, before: reordered[index + 1] ?? null });
        if (!mounted.current) return;
        onReload(next);
        onReport("已保存固定项顺序");
      } catch (error) {
        if (!mounted.current) return;
        onReport(`保存排序失败：${String(error)}`, true);
        try {
          const next = await invoke<Home>("usage_home");
          if (mounted.current) onReload(next);
        } catch {
          if (mounted.current) onReorder(snapshot.current);
        }
      } finally {
        savingRef.current = false;
        if (mounted.current) setSaving(false);
      }
    },
  });

  return (
    <div ref={grid} className="grid pinned-grid" aria-label="已固定，可拖拽排序" data-sorting={sorting || undefined}>
      {items.map((item, index) => (
        <PinnedItem key={pinKey(item)} item={item} index={index} selected={offset + index === selected} disabled={saving}
          onSelect={() => { if (!sorting) onSelect(offset + index); }}
          onOpen={() => { if (!sorting && performance.now() >= blockClickUntil.current) onOpen(item); }}
          onContextMenu={(event) => { if (sorting) event.preventDefault(); else onContextMenu(event, item); }} renderIcon={renderIcon} />
      ))}
    </div>
  );
}

export function PinnedGrid(props: Props) {
  return <DragDropProvider sensors={sensors} plugins={plugins}><Items {...props} /></DragDropProvider>;
}
