# AhaTools

A lightweight macOS menu-bar toolbox (Tauri 2 + Rust + React). It replaces the pieces of uTools and eul I actually use.

## Run

```bash
bun install
bun run tauri dev
```

- Menu bar: live ↓/↑ network speed; click it for the menu.
- `⌥Space`: search panel. Type to find apps (English or Chinese names) and saved paths; type `热键` or `收藏` to open plugin features.
- Config: `~/Library/Application Support/com.aha.tools/config.json` (hotkeys, net speed on/off). Restart after editing.

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
  sdk.ts          host API for plugin views, imported as "@aha/sdk"
  views.ts        registry of built-in plugin views
plugins/<id>/
  plugin.json     manifest: id, name, features (code, explain, cmds), searchProvider
  *.tsx           views, one per feature
```

## Adding a plugin

1. Create `plugins/<id>/plugin.json`. Each feature's `cmds` are the search keywords.
2. Write a view per feature in `plugins/<id>/<View>.tsx`. Import host APIs only from `@aha/sdk`.
3. Register it in `src/views.ts` as `"<id>/<feature code>"`.
4. Add the manifest to `BUILTIN_MANIFESTS` in `src-tauri/src/plugins/mod.rs`.
5. If it needs native code, add `src-tauri/src/plugins/<id>.rs` and register its commands in `lib.rs`. If it should contribute results to every search, implement `SearchProvider` and set `"searchProvider": true`.

## Known limits

- The hotkey probe only sees exclusive Carbon registrations and macOS system shortcuts. Apps that register non-exclusively (Aha itself, many Electron apps) or through event taps show as "未发现占用".
- The tray title uses the system font, so its width can shift slightly as numbers change.
