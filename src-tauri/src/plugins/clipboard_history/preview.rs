//! Read only the selected history item's image; never alter the file or clipboard.
use std::{fs, io::{Cursor, Read}, path::{Component, Path, PathBuf}};

use base64::Engine;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};

use super::{ClipKind, Entry, MAX_IMAGE_PIXELS};

const MAX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_EDGE: u32 = 1600;

pub(super) fn source(entry: &Entry, cache: &Path, selected: Option<&str>) -> Result<PathBuf, String> {
    match entry.kind {
        ClipKind::Image => {
            let file = &entry.image.as_ref().ok_or("图片记录已失效")?.file;
            let mut parts = Path::new(file).components();
            if !matches!(parts.next(), Some(Component::Normal(_))) || parts.next().is_some() {
                return Err("图片记录已失效".into());
            }
            Ok(cache.join(file))
        }
        ClipKind::Files => {
            let path = selected.or_else(|| entry.paths.first().map(String::as_str)).ok_or("没有可预览的文件")?;
            if !entry.paths.iter().any(|p| p == path) { return Err("文件不属于这条记录".into()); }
            Ok(PathBuf::from(crate::plugins::expand_home(path)))
        }
        ClipKind::Text => Err("这条记录不是图片或文件".into()),
    }
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    let describe = |e: std::io::Error| match e.kind() {
        std::io::ErrorKind::NotFound => "图片文件已移动或删除，无法预览".into(),
        std::io::ErrorKind::PermissionDenied => "没有权限读取图片，请在访达中检查文件权限".into(),
        _ => format!("无法读取图片：{e}"),
    };
    let meta = fs::metadata(path).map_err(describe)?;
    if !meta.is_file() { return Err("该路径不是图片文件".into()); }
    if meta.len() > MAX_BYTES { return Err("图片超过 64 MB，请打开原文件查看".into()); }
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(describe)?.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(describe)?;
    if bytes.len() as u64 > MAX_BYTES { return Err("图片超过 64 MB，请打开原文件查看".into()); }
    Ok(bytes)
}

pub(super) fn full(entry: &Entry, cache: &Path, selected: Option<&str>) -> Result<DynamicImage, String> {
    let path = source(entry, cache, selected)?;
    let bytes = read(&path)?;
    let format = image::guess_format(&bytes).map_err(|_| "无法识别图片，文件可能已损坏；可打开原文件查看")?;
    if !matches!(format, ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP) {
        return Err("暂不支持此格式的预览，支持 PNG、JPEG 和 WebP；可打开原文件查看".into());
    }
    let mut reader = ImageReader::with_format(Cursor::new(&bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let error = |e| format!("图片无法解码，可能已损坏：{e}");
    let mut decoder = reader.into_decoder().map_err(error)?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err("图片尺寸过大或无效，请打开原文件查看".into());
    }
    let orientation = decoder.orientation().map_err(error)?;
    let mut decoded = DynamicImage::from_decoder(decoder).map_err(error)?;
    decoded.apply_orientation(orientation);
    Ok(decoded)
}

pub(super) fn load(entry: &Entry, cache: &Path, selected: Option<&str>) -> Result<String, String> {
    let thumbnail = full(entry, cache, selected)?.thumbnail(MAX_EDGE, MAX_EDGE);
    let mut out = Cursor::new(Vec::new());
    thumbnail.write_to(&mut out, ImageFormat::Png).map_err(|e| format!("无法生成预览：{e}"))?;
    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::ImageInfo;

    fn file_entry(path: &Path) -> Entry {
        Entry { id: "test".into(), kind: ClipKind::Files, text: String::new(), paths: vec![path.to_string_lossy().into()],
            image: None, app: None, at: 0, pinned: false, truncated: false }
    }

    #[test]
    fn file_images_preview_without_changing_the_saved_file_entry() {
        let dir = tempfile::tempdir().unwrap();
        for (ext, format) in [("png", ImageFormat::Png), ("jpg", ImageFormat::Jpeg), ("webp", ImageFormat::WebP)] {
            let path = dir.path().join(format!("中文 ' 图片.{ext}"));
            DynamicImage::new_rgb8(1800, 900).save_with_format(&path, format).unwrap();
            let original = fs::read(&path).unwrap();
            let entry = file_entry(&path);
            assert_eq!(full(&entry, dir.path(), Some(path.to_str().unwrap())).unwrap().width(), 1800);
            let data = load(&entry, dir.path(), None).unwrap();
            let png = base64::engine::general_purpose::STANDARD.decode(data.strip_prefix("data:image/png;base64,").unwrap()).unwrap();
            let thumbnail = image::load_from_memory(&png).unwrap();
            assert_eq!((thumbnail.width(), thumbnail.height()), (1600, 800));
            assert_eq!(fs::read(&path).unwrap(), original);
            assert_eq!(entry.kind, ClipKind::Files);
            assert_eq!(entry.image, None);
        }
    }

    #[test]
    fn selected_path_must_belong_to_history_and_cache_paths_cannot_escape() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("第一张.png");
        let second = dir.path().join("第二张.png");
        let mut entry = file_entry(&path);
        entry.paths.push(second.to_string_lossy().into());
        assert_eq!(source(&entry, dir.path(), second.to_str()).unwrap(), second);
        assert!(source(&entry, dir.path(), Some("/别的文件.png")).unwrap_err().contains("不属于"));
        entry.kind = ClipKind::Image;
        entry.image = Some(ImageInfo { file: "cache.png".into(), width: 1, height: 1 });
        assert_eq!(source(&entry, dir.path(), None).unwrap(), dir.path().join("cache.png"));
        entry.image.as_mut().unwrap().file = "../outside.png".into();
        assert!(source(&entry, dir.path(), None).is_err());
    }

    #[test]
    fn missing_corrupt_unsupported_and_oversized_files_report_errors() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("图片.png");
        let entry = file_entry(&path);
        assert!(load(&entry, dir.path(), None).unwrap_err().contains("移动或删除"));
        fs::write(&path, b"bad image").unwrap();
        assert!(load(&entry, dir.path(), None).unwrap_err().contains("损坏"));
        fs::write(&path, b"GIF89a").unwrap();
        assert!(load(&entry, dir.path(), None).unwrap_err().contains("暂不支持"));
        fs::File::create(&path).unwrap().set_len(MAX_BYTES + 1).unwrap();
        assert!(load(&entry, dir.path(), None).unwrap_err().contains("64 MB"));
        assert!(load(&file_entry(dir.path()), dir.path(), None).unwrap_err().contains("不是图片文件"));
    }
}
