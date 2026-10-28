# AhaTools

A lightweight macOS menu-bar toolbox (Tauri 2 + Rust + React). It replaces the pieces of uTools and eul I actually use.

## Run

```bash
bun install
bun run tauri dev
```

- Menu bar: live ↑/↓ network speed; click it for a popover with the speed graph and switches.
- `⌥Space`: search panel. Type to find apps (English or Chinese names) and saved paths; type `热键` or `收藏` to open plugin features.
- Settings: type `设置` in the panel (or ⌘, / the popover). Hotkeys, screenshot tool and forwarding apply immediately; stored in `~/Library/Application Support/com.ahatools.app/config.json`.

## Layout

```
src-tauri/src/
  lib.rs          app setup, tray menu
  netspeed.rs     menu-bar speed (sysctl NET_RT_IFLIST2, en* interfaces only)
  panel.rs        search panel window: toggle, hide on blur, pin
  hotkey/         hotkey router (binding → Action) and occupancy probe
  plugins/        manifest registry, search aggregation, native plugin code
src/
  App.tsx         search panel UI
  sdk.ts          host API for plugin views, imported as "@ahatools/sdk"
  views.ts        registry of built-in plugin views
plugins/<id>/
  plugin.json     manifest: id, name, features (code, explain, cmds), searchProvider
  *.tsx           views, one per feature
```

## Adding a plugin

1. Create `plugins/<id>/plugin.json`. Each feature's `cmds` are the search keywords.
2. Write a view per feature in `plugins/<id>/<View>.tsx`. Import host APIs only from `@ahatools/sdk`.
3. Register it in `src/views.ts` as `"<id>/<feature code>"`.
4. Add the manifest to `BUILTIN_MANIFESTS` in `src-tauri/src/plugins/mod.rs`.
5. If it needs native code, add `src-tauri/src/plugins/<id>.rs` and register its commands in `lib.rs`. If it should contribute results to every search, implement `SearchProvider` and set `"searchProvider": true`.

## Status, roadmap and handoff

See [docs/HANDOFF.md](docs/HANDOFF.md): what's done, how to ship a release build, known issues, planned features and how to work on the code.
