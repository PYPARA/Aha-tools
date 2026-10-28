import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import MenuPopover from "./MenuPopover";

// Outside Tauri (a plain browser on the dev server), fake the backend so the UI can be previewed.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  await import("./dev-mock");
}

// Both windows load this page; the menu popover is opened as index.html?view=menu.
const isMenu = new URLSearchParams(location.search).get("view") === "menu";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isMenu ? <MenuPopover /> : <App />}</React.StrictMode>,
);
