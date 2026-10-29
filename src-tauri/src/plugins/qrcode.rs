//! QR encoding and decoding stay in the frontend. Only selected files cross IPC.

use std::{fs, path::Path};

fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| format!("无法读取图片：{e}"))
}

fn save_png(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("无法保存：图片不是 PNG 格式".into());
    }
    fs::write(path, bytes).map_err(|e| format!("无法保存 PNG 图片：{e}"))
}

#[tauri::command]
pub async fn qr_read_image(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_image(Path::new(&path)).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| format!("无法读取图片：{e}"))?
}

#[tauri::command]
pub async fn qr_save_png(path: String, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_png(Path::new(&path), &bytes))
        .await
        .map_err(|e| format!("无法保存 PNG 图片：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    const PNG: &[u8] = include_bytes!("../../../tests/fixtures/qrcode.png");
    static NEXT: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "ahatools-qr-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn saved_png_round_trips_and_can_replace_an_existing_file() {
        let dir = TestDir::new();
        let path = dir.0.join("二维码.png");
        fs::write(&path, b"old contents").unwrap();
        save_png(&path, PNG).unwrap();
        assert_eq!(read_image(&path).unwrap(), PNG);
    }

    #[test]
    fn invalid_image_does_not_overwrite_an_existing_file() {
        let dir = TestDir::new();
        let path = dir.0.join("二维码.png");
        fs::write(&path, PNG).unwrap();
        assert!(
            save_png(&path, b"not png")
                .unwrap_err()
                .contains("PNG 格式")
        );
        assert_eq!(fs::read(&path).unwrap(), PNG);
    }

    #[test]
    fn missing_files_directories_and_unwritable_targets_return_errors() {
        let dir = TestDir::new();
        assert!(
            read_image(&dir.0.join("不存在.png"))
                .unwrap_err()
                .contains("无法读取图片")
        );
        assert!(read_image(&dir.0).is_err());
        assert!(save_png(&dir.0, PNG).unwrap_err().contains("无法保存"));
        assert!(save_png(&dir.0.join("missing/image.png"), PNG).is_err());
    }
}
