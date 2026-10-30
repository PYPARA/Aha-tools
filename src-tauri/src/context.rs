//! Capture before focusing AhaTools. Clipboard snapshots never cross IPC or touch disk.
use objc2::{runtime::ProtocolObject, sel};
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSWorkspace};
use objc2_foundation::{NSArray, NSData, NSObjectProtocol, NSString};
use serde::{Deserialize, Serialize};
use std::{ffi::c_void, path::Path, process::Command, thread, time::Duration};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Context {
    pub app_name: String,
    pub bundle_id: String,
    pub pid: i32,
    pub kind: String,
    pub paths: Vec<String>,
    pub dir: Option<String>,
    pub text: Option<String>,
    pub notice: Option<String>,
    pub permission: Option<String>,
}

pub fn front() -> Context {
    let mut ctx = Context {
        kind: "none".into(),
        ..Context::default()
    };
    if let Some(app) = NSWorkspace::sharedWorkspace().frontmostApplication() {
        ctx.app_name = app
            .localizedName()
            .map(|s| s.to_string())
            .unwrap_or_default();
        ctx.bundle_id = app
            .bundleIdentifier()
            .map(|s| s.to_string())
            .unwrap_or_default();
        ctx.pid = app.processIdentifier();
    }
    ctx
}
pub fn directory(paths: &[String]) -> Option<String> {
    if paths.len() == 1 && Path::new(&paths[0]).is_dir() {
        return Some(paths[0].clone());
    }
    let first = Path::new(paths.first()?).parent()?;
    paths
        .iter()
        .all(|p| Path::new(p).parent() == Some(first))
        .then(|| first.to_string_lossy().into_owned())
}
pub fn is_image(path: &str) -> bool {
    Path::new(path).extension().is_some_and(|s| {
        ["png", "jpg", "jpeg", "webp"].contains(&s.to_string_lossy().to_lowercase().as_str())
    })
}

pub fn capture(ctx: Context) -> Context {
    objc2::rc::autoreleasepool(|_| capture_inner(ctx))
}
fn capture_inner(mut ctx: Context) -> Context {
    if ctx.pid <= 0 || ctx.bundle_id == "com.ahatools.app" || ctx.pid == std::process::id() as i32 {
        return ctx;
    }
    if ctx.bundle_id == "com.apple.finder" {
        // JXA JSON keeps paths containing newlines and quotes intact. Finder properties are Apple events.
        let script = r#"const f = Application('Finder'); let p = f.selection().map(x => x.url());
if (!p.length) { try { p = [f.windows[0].target().url()]; } catch (_) { p = [f.desktop.url()]; } }
JSON.stringify(p.map(x => decodeURIComponent(x.replace(/^file:\/\//, ''))));"#;
        match finder_paths(script) {
            Ok(paths) => {
                ctx.paths = paths
                    .into_iter()
                    .filter(|p| Path::new(p).exists())
                    .collect();
                if !ctx.paths.is_empty() {
                    ctx.kind = "files".into();
                    ctx.dir = directory(&ctx.paths);
                }
            }
            Err(e) => {
                ctx.permission = Some("automation".into());
                ctx.notice = Some(e);
            }
        }
        return ctx;
    }
    if !crate::hotkey::tap::is_trusted() {
        ctx.permission = Some("accessibility".into());
        ctx.notice = Some("允许「辅助功能」后，可以读取选中文字".into());
        return ctx;
    }
    match selected_text(ctx.pid) {
        Selection::Text(text) => {
            if !text.is_empty() {
                ctx.kind = "text".into();
                ctx.text = Some(text);
            }
        }
        Selection::Secure => {}
        Selection::Unavailable => {
            if let Some(text) = copy_selection(ctx.pid) {
                if !text.is_empty() {
                    ctx.kind = "text".into();
                    ctx.text = Some(text);
                }
            }
        }
    }
    ctx
}

fn finder_paths(script: &str) -> Result<Vec<String>, String> {
    use std::{io::Read, process::Stdio, time::Instant};
    let mut child = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", script])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let output = child.stdout.take().unwrap();
    let reader = thread::spawn(move || {
        let mut bytes = vec![];
        output
            .take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let bytes = reader
                .join()
                .map_err(|_| "无法读取访达结果")?
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err(
                    "无法读取访达。请在系统设置 → 隐私与安全性 → 自动化中允许 AhaTools 控制访达"
                        .into(),
                );
            }
            if bytes.len() > 8 * 1024 * 1024 {
                return Err("选中的项目太多，请减少选择后重试".into());
            }
            return serde_json::from_slice(&bytes)
                .map_err(|_| "访达返回的项目无法读取，请重新选择".into());
        }
        if start.elapsed() > Duration::from_secs(10) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("读取访达超时。完成自动化授权后，请重新呼出面板".into());
        }
        thread::sleep(Duration::from_millis(20));
    }
}

type AX = *const c_void;
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AX;
    fn AXUIElementCopyAttributeValue(element: AX, attr: AX, value: *mut AX) -> i32;
    fn AXUIElementSetMessagingTimeout(element: AX, timeout: f32) -> i32;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: AX);
    fn CFGetTypeID(value: AX) -> usize;
    fn CFStringGetTypeID() -> usize;
}

enum Selection {
    Text(String),
    Secure,
    Unavailable,
}
fn selected_text(pid: i32) -> Selection {
    unsafe {
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return Selection::Unavailable;
        }
        AXUIElementSetMessagingTimeout(app, 0.2);
        let mut focused = std::ptr::null();
        let attr = NSString::from_str("AXFocusedUIElement");
        let status =
            AXUIElementCopyAttributeValue(app, (&*attr as *const NSString).cast(), &mut focused);
        CFRelease(app);
        if status != 0 || focused.is_null() {
            return Selection::Unavailable;
        }
        AXUIElementSetMessagingTimeout(focused, 0.2);
        let get = |name: &str| -> Option<String> {
            let attr = NSString::from_str(name);
            let mut value = std::ptr::null();
            if AXUIElementCopyAttributeValue(
                focused,
                (&*attr as *const NSString).cast(),
                &mut value,
            ) != 0
                || value.is_null()
            {
                return None;
            }
            let result = (CFGetTypeID(value) == CFStringGetTypeID())
                .then(|| (&*(value as *const NSString)).to_string());
            CFRelease(value);
            result
        };
        let result = if get("AXSubrole").as_deref() == Some("AXSecureTextField") {
            Selection::Secure
        } else {
            get("AXSelectedText")
                .map(Selection::Text)
                .unwrap_or(Selection::Unavailable)
        };
        CFRelease(focused);
        result
    }
}

pub fn write_text(text: &str) -> Result<(), String> {
    let board = NSPasteboard::generalPasteboard();
    board.clearContents();
    if board.setString_forType(
        &NSString::from_str(text),
        &NSString::from_str("public.utf8-plain-text"),
    ) {
        Ok(())
    } else {
        Err("无法写入剪贴板，请检查系统的剪贴板访问权限".into())
    }
}

type Items = Vec<Vec<(String, Vec<u8>)>>;
#[derive(Clone, Debug, PartialEq)]
struct Snapshot {
    count: isize,
    items: Items,
}
trait Clipboard {
    fn count(&self) -> isize;
    fn items(&self) -> Option<Items>;
    fn put(&self, items: Items, expected: isize) -> bool;
}
impl Clipboard for NSPasteboard {
    fn count(&self) -> isize {
        self.changeCount()
    }
    fn items(&self) -> Option<Items> {
        if self.respondsToSelector(sel!(accessBehavior))
            && self.accessBehavior() == objc2_app_kit::NSPasteboardAccessBehavior::AlwaysDeny
        {
            return None;
        }
        let items = match self.pasteboardItems() {
            Some(items) => items,
            None if self.types().is_none_or(|t| t.is_empty()) => return Some(vec![]),
            None => return None,
        };
        let mut result = vec![];
        let mut size = 0usize;
        for item in items.iter() {
            let mut formats = vec![];
            for kind in item.types().iter() {
                if kind.to_string().to_ascii_lowercase().contains("promise") {
                    return None;
                }
                let data = item.dataForType(&kind)?;
                size += data.len();
                if size > 64 * 1024 * 1024 {
                    return None;
                }
                formats.push((kind.to_string(), data.to_vec()));
            }
            result.push(formats);
        }
        Some(result)
    }
    fn put(&self, items: Items, expected: isize) -> bool {
        let mut native = vec![];
        for formats in items {
            let item = NSPasteboardItem::new();
            for (kind, bytes) in formats {
                if !item.setData_forType(&NSData::with_bytes(&bytes), &NSString::from_str(&kind)) {
                    return false;
                }
            }
            native.push(item);
        }
        let objects: Vec<_> = native
            .iter()
            .map(|i| ProtocolObject::from_ref(&**i))
            .collect();
        let array = NSArray::from_slice(&objects);
        if self.count() != expected {
            return false;
        }
        self.clearContents();
        native.is_empty() || self.writeObjects(&array)
    }
}
fn snapshot(board: &impl Clipboard) -> Option<Snapshot> {
    let count = board.count();
    let items = board.items()?;
    (board.count() == count).then_some(Snapshot { count, items })
}
fn restore(board: &impl Clipboard, snap: Snapshot, expected: isize) -> bool {
    if board.count() != expected {
        return false;
    }
    board.put(snap.items, expected)
}
static COPY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn copy_selection(pid: i32) -> Option<String> {
    let _guard = COPY_LOCK.lock().ok()?;
    if !crate::hotkey::tap::wait_released() || front().pid != pid {
        return None;
    }
    let board = NSPasteboard::generalPasteboard();
    let snap = snapshot(&*board)?;
    let before = snap.count;
    if board.changeCount() != before || front().pid != pid {
        return None;
    }
    crate::relay::press("Super+KeyC").ok()?;
    let mut changed = None;
    for _ in 0..15 {
        thread::sleep(Duration::from_millis(10));
        if board.changeCount() != before {
            changed = Some(board.changeCount());
            break;
        }
    }
    let count = changed?;
    let text = board
        .stringForType(&NSString::from_str("public.utf8-plain-text"))
        .map(|s| s.to_string());
    // Another writer wins: only restore the generation just read.
    if board.changeCount() == count {
        restore(&*board, snap, count);
    }
    (front().pid == pid).then_some(text).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    struct Fake {
        generation: Cell<isize>,
        data: RefCell<Option<Items>>,
        race: Cell<bool>,
    }
    impl Clipboard for Fake {
        fn count(&self) -> isize {
            self.generation.get()
        }
        fn items(&self) -> Option<Items> {
            if self.race.get() {
                self.generation.set(self.count() + 1);
            }
            self.data.borrow().clone()
        }
        fn put(&self, items: Items, expected: isize) -> bool {
            if self.count() != expected {
                return false;
            }
            self.data.replace(Some(items));
            self.generation.set(self.count() + 1);
            true
        }
    }
    #[test]
    #[ignore = "requires access to the macOS pasteboard service"]
    fn native_private_pasteboard_round_trips_multiple_formats() {
        objc2::rc::autoreleasepool(|_| {
            let board = NSPasteboard::pasteboardWithUniqueName();
            let items = vec![
                vec![
                    ("public.utf8-plain-text".into(), b"plain".to_vec()),
                    ("public.html".into(), b"<b>plain</b>".to_vec()),
                ],
                vec![(
                    "public.file-url".into(),
                    b"file:///tmp/test%20file".to_vec(),
                )],
            ];
            assert!(board.put(items.clone(), board.count()));
            let snap = snapshot(&*board).unwrap();
            assert_eq!(snap.items, items);
            assert!(board.put(vec![], board.count()));
            let expected = board.count();
            assert!(restore(&*board, snap, expected));
            assert_eq!(snapshot(&*board).unwrap().items, items);
            unsafe {
                let _: () = objc2::msg_send![&*board, releaseGlobally];
            }
        });
    }
    #[test]
    fn clipboard_preserves_every_item_and_format_and_yields_to_new_writer() {
        let original = vec![
            vec![
                ("public.png".into(), vec![1, 2, 3]),
                ("public.html".into(), b"<b>text</b>".to_vec()),
            ],
            vec![("public.file-url".into(), b"file:///tmp/a".to_vec())],
        ];
        let board = Fake {
            generation: Cell::new(1),
            data: RefCell::new(Some(original.clone())),
            race: Cell::new(false),
        };
        let snap = snapshot(&board).unwrap();
        board.put(
            vec![vec![("public.text".into(), b"selection".to_vec())]],
            board.count(),
        );
        assert!(restore(&board, snap.clone(), 2));
        assert_eq!(board.data.borrow().as_ref(), Some(&original));
        board.put(vec![], board.count());
        assert!(!restore(&board, snap, 2));
        assert_eq!(board.data.borrow().as_ref(), Some(&vec![]));
        board.race.set(true);
        assert!(snapshot(&board).is_none());
        board.race.set(false);
        board.data.replace(None);
        assert!(snapshot(&board).is_none());
    }
    #[test]
    fn multi_selection_needs_common_parent() {
        assert_eq!(
            directory(&["/tmp/a".into(), "/tmp/b".into()]),
            Some("/tmp".into())
        );
        assert_eq!(directory(&["/tmp/a".into(), "/var/b".into()]), None);
        assert_eq!(directory(&[]), None);
        assert!(is_image("/tmp/图.WEBP"));
        assert!(!is_image("/tmp/a.gif"));
    }
}
