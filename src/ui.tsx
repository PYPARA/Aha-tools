// Shared UI pieces for the panel and plugin views. Plugins get these via "@ahatools/sdk".
// Icons are 24-unit stroke paths drawn in currentColor.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

function Icon({ size = 16, width = 1.6, children }: { size?: number; width?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

export const SearchIcon = ({ size = 20 }: P) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
);
export const NoResultIcon = ({ size = 24 }: P) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5M8.5 11h5" />
  </Icon>
);
export const BackIcon = ({ size = 16 }: P) => (
  <Icon size={size}>
    <path d="M15 18l-6-6 6-6" />
  </Icon>
);
export const FolderIcon = ({ size = 16 }: P) => (
  <Icon size={size}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);
export const FileIcon = ({ size = 16 }: P) => (
  <Icon size={size}>
    <path d="M6 2h8l4 4v16H6z" />
    <path d="M14 2v4h4" />
  </Icon>
);
export const LinkIcon = ({ size = 16 }: P) => (
  <Icon size={size}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);
export const KeyboardIcon = ({ size = 16 }: P) => (
  <Icon size={size}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
  </Icon>
);
export const BookmarkIcon = ({ size = 16 }: P) => (
  <Icon size={size}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </Icon>
);
export const PuzzleIcon = ({ size = 16 }: P) => (
  <Icon size={size}>
    <path d="M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4H4a2 2 0 1 1 0-4h2V6h4z" />
  </Icon>
);
export const ShieldIcon = ({ size = 18 }: P) => (
  <Icon size={size}>
    <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
    <path d="M8.5 12l2.5 2.5 4.5-5" />
  </Icon>
);
export const ClockIcon = ({ size = 18 }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
export const SharedIcon = ({ size = 18 }: P) => (
  <Icon size={size}>
    <circle cx="8" cy="12" r="4" />
    <circle cx="16" cy="12" r="4" />
  </Icon>
);
export const GearIcon = ({ size = 16 }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
);
export const CloseIcon = ({ size = 14 }: P) => (
  <Icon size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const SlidersIcon = ({ size = 18 }: P) => (
  <Icon size={size}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);
export const ScreenshotIcon = ({ size = 16 }: P) => (
  <Icon size={size}>
    <path d="M7 3v14h14M3 7h14v14" />
  </Icon>
);
export const QrCodeIcon = ({ size = 18 }: P) => (
  <Icon size={size}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2v2M20 14v6h-6M17 17h.01" />
  </Icon>
);
export const CopyIcon = ({ size = 15 }: P) => (
  <Icon size={size}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Icon>
);
export const ChevronIcon = ({ size = 12 }: P) => (
  <Icon size={size} width={2}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);
export const GlobeIcon = ({ size = 16 }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z" />
  </Icon>
);
export const InfoIcon = ({ size = 22 }: P) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);
export const RefreshIcon = ({ size = 14 }: P) => (
  <Icon size={size}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </Icon>
);

export function Switch({
  checked,
  onChange,
  label,
  small,
  disabled,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  small?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className={small ? "switch sm" : "switch"}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

const iconCache = new Map<string, Promise<string | null>>();

/** An app's real icon, or a letter tile while loading / when it has none. */
export function AppIcon({ path, name, large }: { path: string; name: string; large?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!iconCache.has(path)) iconCache.set(path, invoke<string | null>("app_icon", { path }).catch(() => null));
    iconCache.get(path)!.then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [path]);
  if (src) return <img className={large ? "app-img lg" : "app-img"} src={src} alt="" aria-hidden="true" />;
  return (
    <span className={large ? "tile lg letter" : "tile letter"} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

interface WebIconData {
  src: string;
  fill: boolean;
}
const webIconCache = new Map<string, Promise<WebIconData | null>>();

/** A web app's site icon (fetched and cached by the backend), or a letter tile. */
export function WebIcon({ url, name, large }: { url: string; name: string; large?: boolean }) {
  const [icon, setIcon] = useState<WebIconData | null>(null);
  const [version, setVersion] = useState(0);
  // Sites that block plain downloads get their icon once their window has loaded.
  useEffect(() => {
    const un = listen<string>("webapp-icon", (e) => {
      if (e.payload !== url) return;
      webIconCache.delete(url);
      setVersion((v) => v + 1);
    });
    return () => {
      un.then((f) => f());
    };
  }, [url]);
  useEffect(() => {
    let live = true;
    if (!webIconCache.has(url))
      webIconCache.set(url, invoke<WebIconData | null>("webapp_icon", { url }).catch(() => null));
    webIconCache.get(url)!.then((i) => live && setIcon(i));
    return () => {
      live = false;
    };
  }, [url, version]);
  const tile = large ? "tile lg" : "tile";
  if (icon?.fill) return <img className={large ? "web-img lg" : "web-img"} src={icon.src} alt="" aria-hidden="true" />;
  return (
    <span className={icon ? tile : `${tile} letter`} aria-hidden="true">
      {icon ? <img className="web-img small" src={icon.src} alt="" /> : name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Follows 外观 in config.json: "system", "light" or "dark". Call once per window. */
export function useAppearance() {
  useEffect(() => {
    const apply = (c: { appearance?: string }) => {
      const t = c.appearance;
      if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
      else delete document.documentElement.dataset.theme;
    };
    invoke<{ appearance?: string }>("config_get").then(apply);
    const un = listen<{ appearance?: string }>("config-changed", (e) => apply(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);
}

/** Where a plugin page's header buttons go; set by the panel. */
export const PageActionsSlot = createContext<HTMLElement | null>(null);

/** Renders its children on the right of the plugin page header. */
export function PageActions({ children }: { children: ReactNode }) {
  const slot = useContext(PageActionsSlot);
  return slot ? createPortal(children, slot) : null;
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="spinner" role="status">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="var(--border)" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--accent)" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

export type PathKind = "folder" | "file" | "link";

/** Icon for a saved path, by the kind the backend reports. */
export function PathIcon({ kind, size }: { kind?: PathKind; size?: number }) {
  if (kind === "link") return <LinkIcon size={size} />;
  if (kind === "file") return <FileIcon size={size} />;
  return <FolderIcon size={size} />;
}

const MOD_SYMBOLS: [string, string][] = [
  ["control", "⌃"],
  ["alt", "⌥"],
  ["shift", "⇧"],
  ["super", "⌘"],
];
const MOD_ALIASES: Record<string, string> = { ctrl: "control", option: "alt", cmd: "super", command: "super", meta: "super" };
const KEY_LABELS: Record<string, string> = {
  Space: "Space", Enter: "↩", Escape: "esc", Tab: "⇥", Backspace: "⌫", ArrowUp: "↑", ArrowDown: "↓",
  ArrowLeft: "←", ArrowRight: "→", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[",
  BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
};

/** "Control+Alt+Shift+Super+Digit1" → "⌃⌥⇧⌘ 1", modifiers in macOS order. */
export function formatAccelerator(acc: string) {
  const parts = acc.split("+").filter(Boolean);
  const mods = new Set(parts.slice(0, -1).map((p) => MOD_ALIASES[p.toLowerCase()] ?? p.toLowerCase()));
  const key = parts[parts.length - 1] ?? "";
  const label = KEY_LABELS[key] ?? key.replace(/^Key/, "").replace(/^Digit/, "");
  const symbols = MOD_SYMBOLS.filter(([m]) => mods.has(m)).map(([, s]) => s).join("");
  return `${symbols} ${label}`.trim();
}

/**
 * A button that records a key combination as an accelerator string. While recording,
 * AhaTools' global hotkeys are paused so the combo reaches this page.
 */
export function HotkeyRecorder({
  value,
  onChange,
  placeholder = "点击录制",
  className = "",
  startRecording = false,
  onCancel,
}: {
  value: string;
  onChange: (accelerator: string) => void;
  placeholder?: string;
  className?: string;
  /** Start listening right away, e.g. after 「设为热键」. */
  startRecording?: boolean;
  /** Recording ended without a new combo. */
  onCancel?: () => void;
}) {
  const [recording, setRecording] = useState(startRecording);
  const button = useRef<HTMLButtonElement>(null);
  // Parents pass new closures every render; the listeners must not restart for that,
  // or recording would end and start again (re-registering every hotkey) mid-press.
  const handlers = useRef({ onChange, onCancel });
  handlers.current = { onChange, onCancel };

  useEffect(() => {
    if (!recording) return;
    invoke("hotkey_set_recording", { on: true });
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (e.key === "Escape" && plain) {
        setRecording(false);
        handlers.current.onCancel?.();
        return;
      }
      if (["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn"].includes(e.key)) return;
      const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(
        Boolean,
      );
      // A bare letter would fire while typing anywhere; only F-keys may go without modifiers.
      if (mods.length === 0 && !/^F\d+$/.test(e.code)) return;
      handlers.current.onChange([...mods, e.code].join("+"));
      setRecording(false);
    };
    // Clicking anywhere else cancels, like pressing esc.
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && button.current?.contains(e.target)) return;
      setRecording(false);
      handlers.current.onCancel?.();
    };
    // With 独占热键 on, the native key tap catches the combo before anything else can;
    // the keydown listener above is the fallback when the tap isn't installed.
    const subs = [
      listen<string>("hotkey-recorded", (e) => {
        handlers.current.onChange(e.payload);
        setRecording(false);
      }),
      listen("hotkey-recording-stopped", () => {
        setRecording(false);
        handlers.current.onCancel?.();
      }),
    ];
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      subs.forEach((u) => u.then((f) => f()));
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
      invoke("hotkey_set_recording", { on: false });
    };
  }, [recording]);

  const state = recording ? " recording" : value ? "" : " empty";
  return (
    <button
      ref={button}
      type="button"
      className={`key-btn${state} ${className}`}
      onClick={() => setRecording((r) => !r)}
      autoFocus={startRecording}
    >
      {recording ? "按下组合键…" : value ? formatAccelerator(value) : placeholder}
    </button>
  );
}
