import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import MenuPopover from "./MenuPopover";
import SuperPanel from "./SuperPanel";
import { installContextMenus } from "./path-actions";

// Outside Tauri (a plain browser on the dev server), fake the backend so the UI can be previewed.
const browserPreview = import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);
if (browserPreview) {
  await import("./dev-mock");
}

installContextMenus();

// Both windows load this page; the menu popover is opened as index.html?view=menu.
const view = new URLSearchParams(location.search).get("view");
// A visual stand-in for AppKit chrome, never shipped or used in a native web window.
const WebAppPreview = browserPreview && view === "webapp-preview"
  ? (await import("./WebAppPreview")).default : null;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{WebAppPreview ? <WebAppPreview /> : view === "menu" ? <MenuPopover /> : view === "super" ? <SuperPanel /> : <App />}</React.StrictMode>,
);
