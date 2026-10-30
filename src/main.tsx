import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import MenuPopover from "./MenuPopover";
import SuperPanel from "./SuperPanel";

// Outside Tauri (a plain browser on the dev server), fake the backend so the UI can be previewed.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  await import("./dev-mock");
}

// No browser context menu (Reload, Inspect…) outside text fields, where copy / paste stays.
window.addEventListener("contextmenu", (e) => {
  if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault();
});

// Both windows load this page; the menu popover is opened as index.html?view=menu.
const view = new URLSearchParams(location.search).get("view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{view === "menu" ? <MenuPopover /> : view === "super" ? <SuperPanel /> : <App />}</React.StrictMode>,
);
