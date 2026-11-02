import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface SelectOption<Value extends string = string> {
  value: Value;
  label: string;
  description?: string;
  group?: string;
  keywords?: string;
  disabled?: boolean;
}

interface SelectProps<Value extends string> {
  id?: string;
  label: string;
  value: Value;
  options: readonly SelectOption<Value>[];
  onChange: (value: Value) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  /** A full-width menu row, e.g. the screenshot tool in the menu-bar window. */
  leadingLabel?: string;
}

const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
const matches = (option: SelectOption, query: string) => {
  const text = normalize([option.label, option.value, option.description, option.group, option.keywords].join(" "));
  return normalize(query).trim().split(/\s+/).every((word) => text.includes(word));
};

function DownIcon() {
  return <svg className="select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}

/** Shared by fixed choices, searchable action lists and editable model suggestions. */
function Picker<Value extends string>({
  id: suppliedId, label, value, options, onChange, placeholder = "请选择",
  searchPlaceholder = "搜索选项…", searchable, disabled = false, className = "", leadingLabel,
  mode = "select",
}: SelectProps<Value> & { mode?: "select" | "action" | "editable" }) {
  const generatedId = useId();
  const id = suppliedId ?? `select-${generatedId}`;
  const listId = `${id}-options`;
  const popupId = `${id}-popup`;
  const editable = mode === "editable";
  const action = mode === "action";
  const canSearch = !editable && (searchable ?? options.length > 8);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Value | null>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const positioned = position !== null;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | HTMLInputElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const typeahead = useRef({ text: "", at: 0 });
  const selected = options.find((option) => option.value === value);
  const entries = options.map((option, index) => ({ option, index })).filter(({ option }) => matches(option, query));
  const available = entries.filter(({ option }) => !option.disabled);
  const current = available.find(({ option }) => option.value === active);
  const activeId = open && current ? `${listId}-${current.index}` : undefined;
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = entry.option.group ?? "";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(entry);
  }
  const groupCount = [...groups.keys()].filter(Boolean).length;

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const show = (last = false) => {
    if (disabled || trigger.current?.matches(":disabled") || !options.length) return;
    setQuery("");
    typeahead.current = { text: "", at: 0 };
    const enabled = options.filter((option) => !option.disabled);
    setActive(editable ? null : selected && !selected.disabled ? selected.value : enabled[last ? enabled.length - 1 : 0]?.value ?? null);
    setPosition(null);
    setOpen(true);
  };
  const pick = (option: SelectOption<Value>) => {
    if (option.disabled) return;
    close(true);
    onChange(option.value);
  };
  const filter = (text: string) => {
    setQuery(text);
    setActive(editable ? null : options.find((option) => !option.disabled && matches(option, text))?.value ?? null);
  };
  const onKey = (event: KeyboardEvent) => {
    // Follow the APG combobox pattern; keep normal text editing and IME confirmation.
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || composing.current) return;
    if (event.key === "Tab") {
      // The search field lives in a portal: continue tabbing from the original control.
      if (canSearch) trigger.current?.focus({ preventScroll: true });
      close();
      event.stopPropagation();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    const inputFocused = event.target instanceof HTMLInputElement;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!available.length) return;
      const index = available.findIndex(({ option }) => option.value === active);
      const next = index < 0 ? (event.key === "ArrowDown" ? 0 : available.length - 1)
        : Math.max(0, Math.min(available.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      setActive(available[next].option.value);
    } else if ((event.key === "Home" || event.key === "End") && !inputFocused) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setActive(available[event.key === "Home" ? 0 : available.length - 1]?.option.value ?? null);
    } else if (event.key === "Enter" || (event.key === " " && !inputFocused)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (current) pick(current.option);
      else if (editable) close(true);
    } else if (!inputFocused && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const text = (Date.now() - typeahead.current.at < 700 ? typeahead.current.text : "") + event.key;
      typeahead.current = { text, at: Date.now() };
      const match = available.find(({ option }) => normalize(option.label).startsWith(normalize(text)));
      if (match) setActive(match.option.value);
    }
  };
  const handlers = useRef({ close, onKey });
  handlers.current = { close, onKey };

  useLayoutEffect(() => {
    if (!open || disabled) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      if (rect.bottom <= 0 || rect.top >= height || rect.right <= 0 || rect.left >= width) {
        handlers.current.close();
        return;
      }
      const popupWidth = Math.min(width - 16, Math.max(rect.width, action ? 280 : 240));
      const wanted = Math.min(340, 12 + entries.length * 36 + groupCount * 28 + (canSearch ? 44 : 0));
      const below = height - rect.bottom - 14;
      const above = rect.top - 14;
      const up = below < wanted && above > below;
      // Wider than its trigger: grow toward whichever side keeps one edge aligned with it.
      const alignRight = action || rect.left + popupWidth > width - 8;
      setPosition({
        width: popupWidth,
        left: Math.max(8, Math.min(alignRight ? rect.right - popupWidth : rect.left, width - popupWidth - 8)),
        ...(up ? { bottom: height - rect.top + 6 } : { top: rect.bottom + 6 }),
        maxHeight: Math.max(48, Math.min(340, up ? above : below)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (root.current) observer.observe(root.current);
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node && popup.current?.contains(event.target))) place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", scroll, true); };
  }, [open, disabled, entries.length, groupCount, canSearch, action]);

  useLayoutEffect(() => {
    if (open && canSearch && positioned) search.current?.focus({ preventScroll: true });
  }, [open, canSearch, positioned]);

  // Wait for placement: before it the list has no max height and cannot scroll.
  useLayoutEffect(() => {
    if (activeId && positioned) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, query, positioned]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !popup.current?.contains(event.target)) handlers.current.close();
    };
    const key = (event: KeyboardEvent) => handlers.current.onKey(event);
    const blur = () => handlers.current.close();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
    };
  }, [open]);

  const onTriggerKey = (event: ReactKeyboardEvent) => {
    if (open || event.nativeEvent.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || (!editable && (event.key === "Home" || event.key === "End"))) {
      event.preventDefault();
      event.stopPropagation();
      show(event.key === "ArrowUp" || event.key === "End");
    }
  };

  return (
    <div className={`select-control${editable ? " select-editable" : ""}${action ? " select-action" : ""}${leadingLabel ? " select-row" : ""} ${className}`} ref={root}>
      {editable ? <>
        <input id={id} ref={(node) => { trigger.current = node; }} className="select-input" role="combobox"
          aria-label={label} aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={activeId}
          autoComplete="off" spellCheck={false} placeholder={placeholder} value={value} disabled={disabled}
          onClick={() => { if (!open) show(); }} onKeyDown={onTriggerKey}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onChange={(event) => { filter(event.target.value); setOpen(options.length > 0); onChange(event.target.value as Value); }} />
        {options.length > 0 && <button type="button" className="select-toggle" tabIndex={-1} disabled={disabled} aria-label={`显示${label}选项`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => { if (open) close(true); else { trigger.current?.focus(); show(); } }}><DownIcon /></button>}
      </> : <button id={id} ref={(node) => { trigger.current = node; }} type="button" className="select-trigger"
        role={action ? undefined : "combobox"} aria-label={label} aria-haspopup={canSearch ? "dialog" : "listbox"}
        aria-expanded={open} aria-controls={open ? (canSearch ? popupId : listId) : undefined} aria-activedescendant={!canSearch ? activeId : undefined}
        disabled={disabled || !options.length} onKeyDown={onTriggerKey} onClick={() => { if (open) close(); else show(); }}>
        {leadingLabel && <span className="select-leading">{leadingLabel}</span>}
        <span className={`select-value${!selected ? " select-placeholder" : ""}`}>{action ? placeholder : selected?.label ?? placeholder}</span><DownIcon />
      </button>}
      {open && !disabled && createPortal(
        <div id={popupId} ref={popup} className={`select-popup${action ? " select-popup-actions" : ""}`} style={position ?? { visibility: "hidden" }}
          role={canSearch ? "dialog" : undefined} aria-label={canSearch ? `${label}选项` : undefined}>
          {canSearch && <div className="select-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
            <input ref={search} role="combobox" aria-label={`搜索${label}`} aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={activeId}
              placeholder={searchPlaceholder} value={query} autoComplete="off" spellCheck={false} onChange={(event) => filter(event.target.value)}
              onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
          </div>}
          <div id={listId} className="select-options" role="listbox" aria-label={label}>
            {[...groups].map(([group, items]) => <div key={group} role={group ? "group" : undefined} aria-label={group || undefined}>
              {group && <div className="select-group-label" aria-hidden="true">{group}</div>}
              {items.map(({ option, index }) => <div key={option.value} id={`${listId}-${index}`} role="option"
                aria-selected={option.value === active} aria-disabled={option.disabled || undefined} className="select-option" data-active={option.value === active || undefined}
                onPointerMove={(event) => { if (event.pointerType !== "touch" && !option.disabled) setActive(option.value); }}
                onMouseDown={(event) => event.preventDefault()} onClick={() => pick(option)}>
                <span className="select-option-copy"><span>{option.label}</span>{option.description && <span className="select-description">{option.description}</span>}</span>
                {!action && option.value === value && <svg className="select-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>}
              </div>)}
            </div>)}
            {!entries.length && <div className="select-empty" role="status">{editable ? "没有匹配的模型，可继续手动填写" : "没有匹配的选项"}</div>}
          </div>
          {canSearch && <span className="sr-only" role="status">{entries.length} 个选项</span>}
        </div>, document.body,
      )}
    </div>
  );
}

export function Select<Value extends string>(props: SelectProps<Value>) {
  return <Picker {...props} />;
}

export function Combobox(props: Omit<SelectProps<string>, "searchable" | "leadingLabel">) {
  return <Picker {...props} mode="editable" />;
}

export function ActionMenu<Value extends string>({ onPick, ...props }: Omit<SelectProps<Value>, "value" | "onChange" | "leadingLabel"> & { onPick: (value: Value) => void }) {
  return <Picker {...props} value={"" as Value} onChange={onPick} mode="action" searchable />;
}
