//! 剪贴板历史: what was copied, kept on this Mac so it can be pasted again. Off until
//! the user turns it on. Stored unencrypted in the data folder (owner-only access):
//! `clipboard/history.jsonl`, one entry per line so a damaged line loses only itself,
//! and `clipboard/<id>.png` for images.

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use objc2::rc::autoreleasepool;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{NSPasteboard, NSPasteboardItem};
use objc2_foundation::{NSArray, NSData, NSString, NSURL};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::clipboard_watch::{ClipKind, Pending};
use crate::config::{self, ClipboardHistory};

/// Longer text (a whole log file) isn't kept.
const MAX_TEXT_BYTES: usize = 512 * 1024;
/// The list sends this much of each text; the rest is fetched for the preview.
const PREVIEW_CHARS: usize = 400;
const MAX_IMAGE_PIXELS: u64 = 40_000_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub file: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub kind: ClipKind,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub image: Option<ImageInfo>,
    /// The app it was copied in.
    #[serde(default)]
    pub app: Option<String>,
    /// Seconds since the Unix epoch; the last time it was copied or used.
    pub at: u64,
    #[serde(default)]
    pub pinned: bool,
    /// Text cut to PREVIEW_CHARS in lists.
    #[serde(default, skip_deserializing)]
    pub truncated: bool,
}

/// What was read from the pasteboard, before it becomes an entry.
pub enum Content {
    Text(String),
    Files(Vec<String>),
    Image { png: Vec<u8>, width: u32, height: u32 },
}

impl Content {
    fn id(&self) -> String {
        let mut hash = Sha256::new();
        match self {
            Content::Text(t) => { hash.update(b"text\0"); hash.update(t.as_bytes()); }
            Content::Files(p) => { hash.update(b"files\0"); hash.update(p.join("\n").as_bytes()); }
            Content::Image { png, .. } => { hash.update(b"image\0"); hash.update(png); }
        }
        hash.finalize().iter().take(10).map(|b| format!("{b:02x}")).collect()
    }
}

static ENTRIES: Mutex<Option<Vec<Entry>>> = Mutex::new(None);

fn dir(app: &AppHandle) -> PathBuf {
    config::data_dir(app).join("clipboard")
}

fn index(app: &AppHandle) -> PathBuf {
    dir(app).join("history.jsonl")
}

/// Newest first. Lines that don't parse are skipped, not the whole history.
fn parse(text: &str) -> Vec<Entry> {
    text.lines().filter_map(|line| serde_json::from_str(line).ok()).collect()
}

fn with_entries<T>(app: &AppHandle, f: impl FnOnce(&mut Vec<Entry>) -> T) -> T {
    let mut guard = ENTRIES.lock().unwrap();
    let entries = guard.get_or_insert_with(|| fs::read_to_string(index(app)).map(|t| parse(&t)).unwrap_or_default());
    f(entries)
}

fn ensure_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = dir(app);
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建剪贴板历史目录：{e}"))?;
    let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    Ok(dir)
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    let _ = fs::remove_file(&tmp);
    let result = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)
        .and_then(|mut f| f.write_all(bytes))
        .and_then(|_| fs::rename(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|e| format!("无法保存剪贴板历史：{e}"))
}

fn save(app: &AppHandle, entries: &[Entry]) -> Result<(), String> {
    ensure_dir(app)?;
    let mut out = String::new();
    for e in entries {
        out.push_str(&serde_json::to_string(e).map_err(|e| e.to_string())?);
        out.push('\n');
    }
    write_private(&index(app), out.as_bytes())
}

/// Older than `max_days` or beyond `max_items` go, pinned ones stay. Returns what went.
fn prune(entries: &mut Vec<Entry>, cfg: &ClipboardHistory, now: u64) -> Vec<Entry> {
    let oldest = now.saturating_sub(u64::from(cfg.max_days) * 86_400);
    let mut kept = 0u32;
    let mut removed = vec![];
    entries.retain(|e| {
        if e.pinned {
            return true;
        }
        kept += 1;
        let keep = e.at >= oldest && kept <= cfg.max_items;
        if !keep {
            removed.push(e.clone());
        }
        keep
    });
    removed
}

/// A copy, newest first; copying the same thing again moves it to the top.
fn add(entries: &mut Vec<Entry>, entry: Entry) {
    let pinned = match entries.iter().position(|e| e.id == entry.id) {
        Some(i) => entries.remove(i).pinned,
        None => false,
    };
    entries.insert(0, Entry { pinned, ..entry });
}

fn delete_images(app: &AppHandle, removed: &[Entry], entries: &[Entry]) {
    let still: HashSet<&str> = entries.iter().filter_map(|e| e.image.as_ref().map(|i| i.file.as_str())).collect();
    for e in removed {
        if let Some(image) = &e.image {
            if !still.contains(image.file.as_str()) {
                let _ = fs::remove_file(dir(app).join(&image.file));
            }
        }
    }
}

fn read_text() -> Option<String> {
    autoreleasepool(|_| {
        NSPasteboard::generalPasteboard()
            .stringForType(&NSString::from_str("public.utf8-plain-text"))
            .map(|s| s.to_string())
    })
}

fn read_image(app: &AppHandle) -> Option<Content> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let image = app.clipboard().read_image().ok()?;
    let (width, height) = (image.width(), image.height());
    if u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS || width == 0 || height == 0 {
        return None;
    }
    let mut png = vec![];
    {
        let mut encoder = png::Encoder::new(&mut png, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(image.rgba()).ok()?;
    }
    Some(Content::Image { png, width, height })
}

/// Called by the clipboard watcher for each new copy, off the main thread.
pub fn record(app: &AppHandle, pending: Pending) {
    let cfg = config::load(app).clipboard_history;
    if !cfg.enabled || pending.bundle.as_deref().is_some_and(|b| cfg.excluded_apps.iter().any(|x| x == b)) {
        return;
    }
    // Copied over again since, or AhaTools' own write: skip this one.
    if crate::clipboard::change_count() != pending.count || crate::clipboard_watch::is_own(pending.count) {
        return;
    }
    let content = match pending.kind {
        ClipKind::Text => read_text().filter(|t| !t.trim().is_empty() && t.len() <= MAX_TEXT_BYTES).map(Content::Text),
        ClipKind::Files => Some(crate::clipboard::clipboard_files()).filter(|p| !p.is_empty()).map(Content::Files),
        ClipKind::Image => read_image(app),
    };
    let Some(content) = content else { return };
    if let Err(e) = store(app, content, pending.app, &cfg, crate::usage::now()) {
        eprintln!("[clipboard] {e}");
    }
}

fn store(app: &AppHandle, content: Content, source: Option<String>, cfg: &ClipboardHistory, now: u64) -> Result<(), String> {
    let id = content.id();
    let (kind, text, paths, image) = match content {
        Content::Text(t) => (ClipKind::Text, t, vec![], None),
        Content::Files(p) => (ClipKind::Files, String::new(), p, None),
        Content::Image { png, width, height } => {
            let file = format!("{id}.png");
            let path = ensure_dir(app)?.join(&file);
            if !path.exists() {
                write_private(&path, &png)?;
            }
            (ClipKind::Image, String::new(), vec![], Some(ImageInfo { file, width, height }))
        }
    };
    let entry = Entry { id, kind, text, paths, image, app: source, at: now, pinned: false, truncated: false };
    with_entries(app, |entries| {
        add(entries, entry);
        let removed = prune(entries, cfg, now);
        delete_images(app, &removed, entries);
        save(app, entries)
    })?;
    let _ = app.emit_to(crate::panel::LABEL, "clipboard-history-changed", ());
    Ok(())
}

/// Removes old entries at startup, when nothing was copied for a while.
pub fn init(app: &AppHandle) {
    let cfg = config::load(app).clipboard_history;
    if !index(app).exists() {
        return;
    }
    let _ = with_entries(app, |entries| {
        let removed = prune(entries, &cfg, crate::usage::now());
        delete_images(app, &removed, entries);
        if removed.is_empty() { Ok(()) } else { save(app, entries) }
    });
}

#[tauri::command]
pub fn clipboard_history_list(app: AppHandle) -> Vec<Entry> {
    with_entries(&app, |entries| {
        entries
            .iter()
            .map(|e| {
                let mut e = e.clone();
                if e.text.chars().count() > PREVIEW_CHARS {
                    e.text = e.text.chars().take(PREVIEW_CHARS).collect();
                    e.truncated = true;
                }
                e
            })
            .collect()
    })
}

#[tauri::command]
pub fn clipboard_history_get(app: AppHandle, id: String) -> Option<Entry> {
    with_entries(&app, |entries| entries.iter().find(|e| e.id == id).cloned())
}

/// The image as a data URL for the preview.
#[tauri::command]
pub async fn clipboard_history_image(app: AppHandle, id: String) -> Option<String> {
    let file = with_entries(&app, |entries| entries.iter().find(|e| e.id == id).and_then(|e| e.image.clone()))?.file;
    let bytes = fs::read(dir(&app).join(file)).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn write_entry(app: &AppHandle, entry: &Entry) -> Result<(), String> {
    let done = autoreleasepool(|_| -> Result<bool, String> {
        let board = NSPasteboard::generalPasteboard();
        let items: Vec<_> = match entry.kind {
            ClipKind::Text => return Ok(false),
            ClipKind::Files => entry
                .paths
                .iter()
                .map(|p| {
                    let item = NSPasteboardItem::new();
                    let url = NSURL::fileURLWithPath(&NSString::from_str(p));
                    let text = url.absoluteString().map(|s| s.to_string()).unwrap_or_default();
                    item.setString_forType(&NSString::from_str(&text), &NSString::from_str("public.file-url"));
                    item
                })
                .collect(),
            ClipKind::Image => {
                let file = entry.image.as_ref().ok_or("图片已丢失")?;
                let bytes = fs::read(dir(app).join(&file.file)).map_err(|_| "图片已丢失，无法再次使用".to_string())?;
                let item = NSPasteboardItem::new();
                item.setData_forType(&NSData::with_bytes(&bytes), &NSString::from_str("public.png"));
                vec![item]
            }
        };
        let objects: Vec<_> = items.iter().map(|i| ProtocolObject::from_ref(&**i)).collect();
        board.clearContents();
        Ok(board.writeObjects(&NSArray::from_slice(&objects)))
    })?;
    if entry.kind == ClipKind::Text {
        return crate::context::write_text(&entry.text);
    }
    if !done {
        return Err("无法写入剪贴板".into());
    }
    crate::clipboard_watch::mark_own();
    Ok(())
}

/// Puts an entry back on the clipboard; with `paste`, also pastes it into the app that
/// was in front before the panel (needs 辅助功能, otherwise it's only copied).
#[tauri::command]
pub async fn clipboard_history_use(app: AppHandle, id: String, paste: bool) -> Result<String, String> {
    let entry = with_entries(&app, |entries| {
        let i = entries.iter().position(|e| e.id == id)?;
        let mut entry = entries.remove(i);
        entry.at = crate::usage::now();
        entries.insert(0, entry.clone());
        Some(entry)
    })
    .ok_or("这条记录已删除")?;
    write_entry(&app, &entry)?;
    with_entries(&app, |entries| save(&app, entries))?;
    if !paste {
        return Ok("已复制".into());
    }
    crate::panel::hide(&app);
    if !crate::hotkey::tap::is_trusted() {
        return Ok("已复制，按 ⌘V 粘贴（允许「辅助功能」后可直接粘贴）".into());
    }
    // Let the previous app take focus back before the keystroke.
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    crate::relay::press("Super+KeyV")?;
    Ok("已粘贴".into())
}

#[tauri::command]
pub fn clipboard_history_pin(app: AppHandle, id: String, pinned: bool) -> Result<(), String> {
    with_entries(&app, |entries| {
        if let Some(e) = entries.iter_mut().find(|e| e.id == id) {
            e.pinned = pinned;
        }
        save(&app, entries)
    })
}

#[tauri::command]
pub fn clipboard_history_delete(app: AppHandle, id: String) -> Result<(), String> {
    with_entries(&app, |entries| {
        let removed: Vec<Entry> = entries.iter().filter(|e| e.id == id).cloned().collect();
        entries.retain(|e| e.id != id);
        delete_images(&app, &removed, entries);
        save(&app, entries)
    })
}

/// Everything except pinned entries, unless `pinned_too`.
#[tauri::command]
pub fn clipboard_history_clear(app: AppHandle, pinned_too: bool) -> Result<(), String> {
    with_entries(&app, |entries| {
        let (gone, kept): (Vec<Entry>, Vec<Entry>) = entries.drain(..).partition(|e| pinned_too || !e.pinned);
        *entries = kept;
        delete_images(&app, &gone, entries);
        save(&app, entries)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(id: &str, at: u64) -> Entry {
        Entry { id: id.into(), kind: ClipKind::Text, text: id.into(), paths: vec![], image: None, app: None, at, pinned: false, truncated: false }
    }
    fn cfg(max_items: u32, max_days: u32) -> ClipboardHistory {
        ClipboardHistory { enabled: true, max_items, max_days, ..ClipboardHistory::default() }
    }
    fn ids(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|e| e.id.as_str()).collect()
    }

    #[test]
    fn copying_again_moves_to_the_top_and_keeps_the_pin() {
        let mut entries = vec![text("b", 2), text("a", 1)];
        entries[1].pinned = true;
        add(&mut entries, text("a", 3));
        assert_eq!(ids(&entries), ["a", "b"]);
        assert!(entries[0].pinned);
        assert_eq!(entries[0].at, 3);
        add(&mut entries, text("c", 4));
        assert_eq!(ids(&entries), ["c", "a", "b"]);
    }

    #[test]
    fn pruning_keeps_pins_and_drops_old_or_extra_entries() {
        let day = 86_400;
        let mut entries = vec![text("new", 100 * day), text("mid", 99 * day), text("old", 50 * day), text("pinned-old", 10 * day)];
        entries[3].pinned = true;
        let removed = prune(&mut entries, &cfg(500, 30), 100 * day);
        assert_eq!(ids(&removed), ["old"]);
        assert_eq!(ids(&entries), ["new", "mid", "pinned-old"]);
        let removed = prune(&mut entries, &cfg(1, 30), 100 * day);
        assert_eq!(ids(&removed), ["mid"]);
        assert_eq!(ids(&entries), ["new", "pinned-old"]);
    }

    #[test]
    fn a_damaged_line_loses_only_itself() {
        let good = serde_json::to_string(&text("a", 1)).unwrap();
        let other = serde_json::to_string(&text("b", 2)).unwrap();
        let entries = parse(&format!("{good}\n{{broken\n\n{other}\n"));
        assert_eq!(ids(&entries), ["a", "b"]);
        // Older files without newer fields still load.
        let old = r#"{"id":"x","kind":"files","paths":["/tmp/a"],"at":5}"#;
        assert_eq!(parse(old)[0].paths, ["/tmp/a"]);
    }

    #[test]
    fn same_content_same_id_and_kinds_never_collide() {
        assert_eq!(Content::Text("hi".into()).id(), Content::Text("hi".into()).id());
        assert_ne!(Content::Text("hi".into()).id(), Content::Files(vec!["hi".into()]).id());
        assert_eq!(Content::Text("hi".into()).id().len(), 20);
    }
}
