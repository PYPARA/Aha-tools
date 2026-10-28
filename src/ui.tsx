// Shared UI pieces for the panel and plugin views. Plugins get these via "@aha/sdk".
// Icons are 24-unit stroke paths drawn in currentColor.

import type { ReactNode } from "react";

function Icon({ size = 16, width = 2, children }: { size?: number; width?: number; children: ReactNode }) {
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
  <Icon size={size} width={2.2}>
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
export const RefreshIcon = ({ size = 14 }: P) => (
  <Icon size={size}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </Icon>
);

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
