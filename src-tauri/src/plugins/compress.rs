//! Session-only compression queue. Originals and results never cross IPC as pixels.

use std::{
    collections::{HashSet, VecDeque},
    fs::{self, File, Metadata},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use image::{DynamicImage, ImageDecoder};
use img_parts::ImageICC;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_FILE: u64 = 128 * 1024 * 1024;
const MAX_DECODED: u64 = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Waiting,
    Running,
    Compressed,
    Unchanged,
    Skipped,
    Failed,
}

impl Status {
    fn terminal(self) -> bool {
        !matches!(self, Self::Waiting | Self::Running)
    }
    fn exportable(self) -> bool {
        matches!(self, Self::Compressed | Self::Unchanged)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub item_id: String,
    pub path: String,
    pub name: String,
    pub before: u64,
    pub after: Option<u64>,
    pub status: Status,
    pub version: u64,
    pub message: String,
    pub output_name: Option<String>,
    pub can_overwrite: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub batch_id: String,
    pub created_at: u64,
    pub quality: u8,
    pub to_webp: bool,
    pub items: Vec<Item>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    batch_id: String,
    #[serde(flatten)]
    item: Item,
}

#[derive(Clone, Debug, PartialEq)]
struct Stamp {
    len: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    identity: (u64, u64),
}
impl Stamp {
    fn of(md: &Metadata) -> Self {
        Self {
            len: md.len(),
            modified: md.modified().ok(),
            #[cfg(unix)]
            identity: {
                use std::os::unix::fs::MetadataExt;
                (md.dev(), md.ino())
            },
        }
    }
}

#[derive(Clone)]
struct Record {
    view: Item,
    source: PathBuf,
    snapshot: Option<PathBuf>,
    stamp: Option<Stamp>,
    output: Option<PathBuf>,
}
struct StoredBatch {
    view: Batch,
    records: Vec<Record>,
}
impl StoredBatch {
    fn snapshot(&self) -> Batch {
        Batch {
            items: self.records.iter().map(|r| r.view.clone()).collect(),
            ..self.view.clone()
        }
    }
}
#[derive(Default)]
struct Inner {
    batches: Vec<StoredBatch>,
    queue: VecDeque<String>,
    running: bool,
}

pub struct Engine {
    root: PathBuf,
    init_error: Option<String>,
    submissions: Mutex<()>,
    exports: Mutex<()>,
    inner: Mutex<Inner>,
    pool: rayon::ThreadPool,
}

fn io_error(e: impl std::fmt::Display) -> String {
    format!("文件操作失败：{e}")
}
fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}
pub fn supported(path: &Path) -> bool {
    matches!(extension(path).as_str(), "png" | "jpg" | "jpeg" | "webp")
}

/// Expand only the first directory level; keep bad direct inputs for per-row errors.
pub fn expand_paths(paths: &[String]) -> Vec<PathBuf> {
    let mut out = vec![];
    let mut seen = HashSet::new();
    let mut add = |p: PathBuf| {
        let p = p.canonicalize().unwrap_or(p);
        if seen.insert(p.clone()) {
            out.push(p);
        }
    };
    for path in paths {
        let p = PathBuf::from(super::expand_home(path));
        if p.is_dir() {
            let mut children: Vec<_> = fs::read_dir(&p)
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_file() && supported(p))
                .collect();
            children.sort();
            if children.is_empty() {
                add(p);
            } else {
                for child in children {
                    add(child);
                }
            }
        } else {
            add(p);
        }
    }
    out
}

fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(io_error)?;
    let md = file.metadata().map_err(io_error)?;
    if !md.is_file() {
        return Err("请选择普通图片文件".into());
    }
    if md.len() > MAX_FILE {
        return Err("图片超过 128 MiB，无法处理".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("图片超过 128 MiB，无法处理".into());
    }
    Ok(bytes)
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        Err("批次编号无效".into())
    } else {
        Ok(())
    }
}

impl Engine {
    pub fn new(root: PathBuf) -> Self {
        let cleanup = || -> Result<(), String> {
            if root.is_symlink() {
                fs::remove_file(&root).map_err(io_error)?;
            } else if root.exists() {
                fs::remove_dir_all(&root).map_err(io_error)?;
            }
            fs::create_dir_all(&root).map_err(io_error)
        };
        let init_error = cleanup().err();
        Self {
            root,
            init_error,
            submissions: Mutex::new(()),
            exports: Mutex::new(()),
            inner: Mutex::new(Inner::default()),
            pool: rayon::ThreadPoolBuilder::new()
                .num_threads(2)
                .thread_name(|i| format!("compress-{i}"))
                .build()
                .expect("compression thread pool"),
        }
    }

    fn list(&self) -> Vec<Batch> {
        self.inner
            .lock()
            .unwrap()
            .batches
            .iter()
            .map(StoredBatch::snapshot)
            .collect()
    }

    fn submit(
        self: &Arc<Self>,
        id: String,
        paths: Vec<String>,
        quality: u8,
        to_webp: bool,
        reprocess: Option<String>,
        notify: Arc<dyn Fn(Progress) + Send + Sync>,
    ) -> Result<Batch, String> {
        validate_id(&id)?;
        if !(1..=100).contains(&quality) {
            return Err("质量应为 1–100".into());
        }
        if let Some(e) = &self.init_error {
            return Err(format!("无法创建压缩缓存：{e}"));
        }
        let _submission = self.submissions.lock().unwrap();
        if let Some(b) = self
            .inner
            .lock()
            .unwrap()
            .batches
            .iter()
            .find(|b| b.view.batch_id == id)
        {
            return Ok(b.snapshot());
        }
        let dir = self.root.join(&id);
        let original_dir = dir.join("originals");
        fs::create_dir_all(&original_dir).map_err(io_error)?;
        fs::create_dir_all(dir.join("output")).map_err(io_error)?;
        let records = if let Some(source_id) = reprocess {
            let inner = self.inner.lock().unwrap();
            let old = inner
                .batches
                .iter()
                .find(|b| b.view.batch_id == source_id)
                .ok_or("原批次不存在")?;
            if old.records.iter().any(|r| !r.view.status.terminal()) {
                return Err("请等待当前批次完成".into());
            }
            old.records
                .iter()
                .enumerate()
                .map(|(i, r)| {
                    let mut record = r.clone();
                    record.view.item_id = i.to_string();
                    record.view.version = 0;
                    record.view.after = None;
                    record.view.output_name = None;
                    record.view.can_overwrite = false;
                    record.output = None;
                    if record.snapshot.is_some() {
                        record.view.status = Status::Waiting;
                        record.view.message = "等待中".into();
                    }
                    record
                })
                .collect::<Vec<_>>()
        } else {
            let expanded = expand_paths(&paths);
            if expanded.is_empty() {
                return Err("请选择图片文件或文件夹".into());
            }
            expanded
                .into_iter()
                .enumerate()
                .map(|(i, path)| {
                    let name = path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned();
                    let mut record = Record {
                        view: Item {
                            item_id: i.to_string(),
                            path: path.to_string_lossy().into_owned(),
                            name,
                            before: 0,
                            after: None,
                            status: Status::Waiting,
                            version: 0,
                            message: "等待中".into(),
                            output_name: None,
                            can_overwrite: false,
                        },
                        source: path.clone(),
                        snapshot: None,
                        stamp: None,
                        output: None,
                    };
                    if path.is_dir() {
                        record.view.status = Status::Skipped;
                        record.view.message = "文件夹中没有支持的图片，或无法读取文件夹".into();
                    } else if !supported(&path) {
                        record.view.status = Status::Skipped;
                        record.view.message = "不支持此格式，已跳过".into();
                    } else {
                        let snapshot = original_dir.join(format!("{i}.{}", extension(&path)));
                        let result = (|| {
                            let stamp = Stamp::of(&fs::metadata(&path).map_err(io_error)?);
                            let bytes = read_limited(&path)?;
                            if Stamp::of(&fs::metadata(&path).map_err(io_error)?) != stamp {
                                return Err("文件正在变化，请重新导入".into());
                            }
                            fs::write(&snapshot, &bytes).map_err(io_error)?;
                            record.view.before = bytes.len() as u64;
                            record.snapshot = Some(snapshot);
                            record.stamp = Some(stamp);
                            Ok::<_, String>(())
                        })();
                        if let Err(e) = result {
                            record.view.status = Status::Failed;
                            record.view.message = e;
                        }
                    }
                    record
                })
                .collect()
        };
        let batch = StoredBatch {
            view: Batch {
                batch_id: id.clone(),
                created_at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
                quality,
                to_webp,
                items: vec![],
            },
            records,
        };
        let snapshot = batch.snapshot();
        let start = {
            let mut inner = self.inner.lock().unwrap();
            inner.batches.push(batch);
            inner.queue.push_back(id);
            if inner.running {
                false
            } else {
                inner.running = true;
                true
            }
        };
        if start {
            let engine = self.clone();
            std::thread::spawn(move || engine.work(notify));
        }
        Ok(snapshot)
    }

    fn update(
        &self,
        batch_id: &str,
        index: usize,
        notify: &dyn Fn(Progress),
        f: impl FnOnce(&mut Record),
    ) {
        let event = {
            let mut inner = self.inner.lock().unwrap();
            let b = inner
                .batches
                .iter_mut()
                .find(|b| b.view.batch_id == batch_id)
                .unwrap();
            let record = &mut b.records[index];
            f(record);
            record.view.version += 1;
            Progress {
                batch_id: batch_id.into(),
                item: record.view.clone(),
            }
        };
        notify(event);
    }

    fn work(&self, notify: Arc<dyn Fn(Progress) + Send + Sync>) {
        loop {
            let (id, quality, to_webp, jobs) = {
                let mut inner = self.inner.lock().unwrap();
                let Some(id) = inner.queue.pop_front() else {
                    inner.running = false;
                    return;
                };
                let b = inner
                    .batches
                    .iter()
                    .find(|b| b.view.batch_id == id)
                    .unwrap();
                (id, b.view.quality, b.view.to_webp, b.records.clone())
            };
            self.pool.install(|| {
                jobs.par_iter().enumerate().for_each(|(index, record)| {
                    if record.view.status.terminal() {
                        return;
                    }
                    self.update(&id, index, notify.as_ref(), |r| {
                        r.view.status = Status::Running;
                        r.view.message = "正在压缩…".into();
                    });
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        let bytes =
                            read_limited(record.snapshot.as_ref().ok_or("原始快照不存在")?)?;
                        let ext = extension(&record.source);
                        match encode(&bytes, &ext, quality, to_webp)? {
                            None => Ok(None),
                            Some(encoded) => {
                                let (output_bytes, out_ext, status) = if encoded.len() < bytes.len()
                                {
                                    (
                                        encoded,
                                        if to_webp {
                                            "webp".to_string()
                                        } else {
                                            ext.clone()
                                        },
                                        Status::Compressed,
                                    )
                                } else {
                                    (bytes, ext.clone(), Status::Unchanged)
                                };
                                let output_dir = self.root.join(&id).join("output");
                                let stem = record
                                    .source
                                    .file_stem()
                                    .unwrap_or_default()
                                    .to_string_lossy();
                                let output =
                                    write_unique(&output_dir, &stem, &out_ext, &output_bytes)?;
                                Ok(Some((
                                    output,
                                    output_bytes.len() as u64,
                                    status,
                                    out_ext == ext,
                                )))
                            }
                        }
                    }))
                    .unwrap_or_else(|_| Err("图片编码失败，请换一张图片重试".into()));
                    self.update(&id, index, notify.as_ref(), |r| match result {
                        Ok(Some((path, size, status, same_format))) => {
                            r.view.output_name =
                                path.file_name().map(|s| s.to_string_lossy().into_owned());
                            r.output = Some(path);
                            r.view.after = Some(size);
                            r.view.status = status;
                            r.view.can_overwrite = status == Status::Compressed && same_format;
                            r.view.message = if status == Status::Unchanged {
                                "已是最小，保留原图；拍摄信息未移除".into()
                            } else {
                                "已压缩，拍摄信息已移除".into()
                            };
                        }
                        Ok(None) => {
                            r.view.status = Status::Skipped;
                            r.view.message = "不支持动画图片，已跳过".into();
                        }
                        Err(e) => {
                            r.view.status = Status::Failed;
                            r.view.message = e;
                        }
                    });
                })
            });
        }
    }
}

fn pixels<D: ImageDecoder>(mut decoder: D) -> Result<(DynamicImage, Option<Vec<u8>>), String> {
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_DECODED);
    decoder.set_limits(limits).map_err(io_error)?;
    // Account for 8-bit RGB -> RGBA expansion as well as the decoder's native representation.
    let (w, h) = decoder.dimensions();
    if decoder.total_bytes() > MAX_DECODED || u64::from(w) * u64::from(h) * 4 > MAX_DECODED {
        return Err("图片解码内存超过 256 MiB，无法处理".into());
    }
    let orientation = decoder.orientation().map_err(io_error)?;
    let icc = decoder.icc_profile().map_err(io_error)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(io_error)?;
    image.apply_orientation(orientation);
    Ok((image, icc))
}

fn encode(bytes: &[u8], ext: &str, quality: u8, to_webp: bool) -> Result<Option<Vec<u8>>, String> {
    let actual = image::guess_format(bytes).map_err(|_| "图片格式无效或文件已损坏".to_string())?;
    let expected = match ext {
        "png" => image::ImageFormat::Png,
        "jpg" | "jpeg" => image::ImageFormat::Jpeg,
        _ => image::ImageFormat::WebP,
    };
    if actual != expected {
        return Err("文件扩展名与图片格式不符，请修正后重试".into());
    }
    let (image, icc) = match actual {
        image::ImageFormat::Png => {
            let decoder =
                image::codecs::png::PngDecoder::new(Cursor::new(bytes)).map_err(io_error)?;
            if decoder.is_apng().map_err(io_error)? {
                return Ok(None);
            }
            pixels(decoder)?
        }
        image::ImageFormat::WebP => {
            let decoder =
                image::codecs::webp::WebPDecoder::new(Cursor::new(bytes)).map_err(io_error)?;
            if decoder.has_animation() {
                return Ok(None);
            }
            pixels(decoder)?
        }
        image::ImageFormat::Jpeg => {
            pixels(image::codecs::jpeg::JpegDecoder::new(Cursor::new(bytes)).map_err(io_error)?)?
        }
        _ => return Err("不支持此格式".into()),
    };
    if to_webp || actual == image::ImageFormat::WebP {
        let rgba = image.to_rgba8();
        let encoded = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height())
            .encode_simple(false, f32::from(quality))
            .map_err(|e| format!("WebP 编码失败：{e:?}"))?;
        let mut container =
            img_parts::webp::WebP::from_bytes(encoded.to_vec().into()).map_err(io_error)?;
        container.set_icc_profile(icc.map(Into::into));
        return Ok(Some(container.encoder().bytes().to_vec()));
    }
    if actual == image::ImageFormat::Jpeg {
        let rgb = image.to_rgb8();
        let mut compressor = mozjpeg::Compress::new(mozjpeg::ColorSpace::JCS_RGB);
        compressor.set_size(rgb.width() as usize, rgb.height() as usize);
        compressor.set_quality(f32::from(quality));
        compressor.set_progressive_mode();
        let mut writer = compressor.start_compress(Vec::new()).map_err(io_error)?;
        writer.write_scanlines(rgb.as_raw()).map_err(io_error)?;
        let mut container =
            img_parts::jpeg::Jpeg::from_bytes(writer.finish().map_err(io_error)?.into())
                .map_err(io_error)?;
        container.set_icc_profile(icc.map(Into::into));
        return Ok(Some(container.encoder().bytes().to_vec()));
    }
    let rgba = image.to_rgba8();
    let mut quantizer = imagequant::new();
    quantizer.set_quality(0, quality).map_err(io_error)?;
    let rgba_pixels: Vec<_> = rgba
        .pixels()
        .map(|p| imagequant::RGBA::new(p[0], p[1], p[2], p[3]))
        .collect();
    let mut input = quantizer
        .new_image(
            rgba_pixels,
            rgba.width() as usize,
            rgba.height() as usize,
            0.0,
        )
        .map_err(io_error)?;
    let mut result = quantizer.quantize(&mut input).map_err(io_error)?;
    let (palette, indices) = result.remapped(&mut input).map_err(io_error)?;
    let mut png_bytes = vec![];
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, rgba.width(), rgba.height());
        encoder.set_color(png::ColorType::Indexed);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_palette(
            palette
                .iter()
                .flat_map(|p| [p.r, p.g, p.b])
                .collect::<Vec<_>>(),
        );
        encoder.set_trns(palette.iter().map(|p| p.a).collect::<Vec<_>>());
        encoder
            .write_header()
            .map_err(io_error)?
            .write_image_data(&indices)
            .map_err(io_error)?;
    }
    let has_icc = icc.is_some();
    let mut container = img_parts::png::Png::from_bytes(png_bytes.into()).map_err(io_error)?;
    container.set_icc_profile(icc.map(Into::into));
    // These chunks affect rendering, unlike EXIF/text/time chunks. Copy them without copying private metadata.
    let source = img_parts::png::Png::from_bytes(bytes.to_vec().into()).map_err(io_error)?;
    let color_chunks: Vec<_> = source
        .chunks()
        .iter()
        .filter(|c| {
            matches!(&c.kind(), b"gAMA" | b"cHRM" | b"sRGB" | b"cICP")
                && !(has_icc && c.kind() == *b"sRGB")
        })
        .cloned()
        .collect();
    container.chunks_mut().splice(1..1, color_chunks);
    let options = oxipng::Options::from_preset(2);
    oxipng::optimize_from_memory(&container.encoder().bytes(), &options)
        .map(Some)
        .map_err(io_error)
}

fn write_unique(dir: &Path, stem: &str, ext: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    for n in 1..=100_000 {
        let name = if n == 1 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem}.{n}.{ext}")
        };
        let path = dir.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                    let _ = fs::remove_file(&path);
                    return Err(io_error(e));
                }
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(io_error(e)),
        }
    }
    Err("同名文件过多，请清理后重试".into())
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ExportAction {
    Copy,
    Save,
    Overwrite,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    item_id: String,
    path: Option<String>,
    error: Option<String>,
}

fn overwrite(record: &Record, output: &Path) -> Result<PathBuf, String> {
    let check = || -> Result<Metadata, String> {
        let md = fs::symlink_metadata(&record.source).map_err(io_error)?;
        if !md.is_file() || Some(Stamp::of(&md)) != record.stamp {
            return Err("原文件已变化，请重新导入后再覆盖".into());
        }
        if read_limited(&record.source)?
            != read_limited(record.snapshot.as_ref().ok_or("原始快照不存在")?)?
        {
            return Err("原文件已变化，请重新导入后再覆盖".into());
        }
        Ok(md)
    };
    let md = check()?;
    if md.permissions().readonly() {
        return Err("原文件为只读，无法覆盖".into());
    }
    let mut temp = tempfile::NamedTempFile::new_in(record.source.parent().ok_or("原目录不存在")?)
        .map_err(io_error)?;
    let mut input = File::open(output).map_err(io_error)?;
    std::io::copy(&mut input, temp.as_file_mut()).map_err(io_error)?;
    temp.as_file()
        .set_permissions(md.permissions())
        .map_err(io_error)?;
    temp.as_file().sync_all().map_err(io_error)?;
    check()?;
    temp.persist(&record.source).map_err(io_error)?;
    Ok(record.source.clone())
}

impl Engine {
    fn export(
        &self,
        id: &str,
        item_ids: &[String],
        action: ExportAction,
        clipboard: impl Fn(&[PathBuf]) -> Result<(), String>,
    ) -> Result<Vec<ExportResult>, String> {
        let _export = self.exports.lock().unwrap();
        let records = {
            let inner = self.inner.lock().unwrap();
            let batch = inner
                .batches
                .iter()
                .find(|b| b.view.batch_id == id)
                .ok_or("批次不存在")?;
            let unique: HashSet<_> = item_ids.iter().collect();
            if unique.is_empty()
                || unique.len() != item_ids.len()
                || unique
                    .iter()
                    .any(|id| !batch.records.iter().any(|r| &r.view.item_id == *id))
            {
                return Err("请选择有效的结果".into());
            }
            if item_ids.len() > 1 && batch.records.iter().any(|r| !r.view.status.terminal()) {
                return Err("请等待当前批次完成".into());
            }
            batch
                .records
                .iter()
                .filter(|r| unique.contains(&r.view.item_id))
                .cloned()
                .collect::<Vec<_>>()
        };
        let mut copy_paths = vec![];
        let mut results: Vec<ExportResult> = records
            .iter()
            .map(|record| {
                let result = (|| {
                    if !record.view.status.exportable() {
                        return Err("此文件没有可用的压缩结果".into());
                    }
                    let output = record
                        .output
                        .as_ref()
                        .filter(|p| p.is_file())
                        .ok_or("缓存文件不存在，请重新导入")?;
                    match action {
                        ExportAction::Copy => {
                            copy_paths.push(output.clone());
                            Ok(output.clone())
                        }
                        ExportAction::Save => {
                            let dir = record.source.parent().ok_or("原目录不存在")?;
                            let stem = format!(
                                "{}.min",
                                record
                                    .source
                                    .file_stem()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                            );
                            write_unique(dir, &stem, &extension(output), &read_limited(output)?)
                        }
                        ExportAction::Overwrite => {
                            if !record.view.can_overwrite {
                                return Err("只可覆盖已缩小且格式未改变的图片".into());
                            }
                            overwrite(record, output)
                        }
                    }
                })();
                match result {
                    Ok(path) => ExportResult {
                        item_id: record.view.item_id.clone(),
                        path: Some(path.to_string_lossy().into_owned()),
                        error: None,
                    },
                    Err(error) => ExportResult {
                        item_id: record.view.item_id.clone(),
                        path: None,
                        error: Some(error),
                    },
                }
            })
            .collect();
        if action == ExportAction::Copy && !copy_paths.is_empty() {
            if let Err(error) = clipboard(&copy_paths) {
                for result in &mut results {
                    if result.error.is_none() {
                        result.error = Some(error.clone());
                        result.path = None;
                    }
                }
            }
        }
        Ok(results)
    }
}

#[cfg(target_os = "macos")]
fn copy_files(paths: &[PathBuf]) -> Result<(), String> {
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboard, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSString, NSURL};
    // Native file URLs handle spaces, quotes and non-ASCII names without shell interpolation.
    let urls: Vec<_> = paths
        .iter()
        .map(|p| NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy())))
        .collect();
    let objects: Vec<&ProtocolObject<dyn NSPasteboardWriting>> = urls
        .iter()
        .map(|url| ProtocolObject::from_ref(&**url))
        .collect();
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    if pasteboard.writeObjects(&NSArray::from_slice(&objects)) {
        Ok(())
    } else {
        Err("无法将图片文件写入剪贴板".into())
    }
}
#[cfg(not(target_os = "macos"))]
fn copy_files(_: &[PathBuf]) -> Result<(), String> {
    Err("文件复制仅支持 macOS".into())
}

pub fn init(app: &AppHandle) {
    let root = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("com.ahatools.app"))
        .join("compress");
    app.manage(Arc::new(Engine::new(root)));
}

fn notifier(app: AppHandle) -> Arc<dyn Fn(Progress) + Send + Sync> {
    Arc::new(move |event| {
        let _ = app.emit("compress-progress", event);
    })
}

#[tauri::command]
pub async fn compress_start(
    app: AppHandle,
    engine: State<'_, Arc<Engine>>,
    batch_id: String,
    paths: Vec<String>,
    quality: u8,
    to_webp: bool,
) -> Result<Batch, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.submit(batch_id, paths, quality, to_webp, None, notifier(app))
    })
    .await
    .map_err(io_error)?
}
#[tauri::command]
pub async fn compress_reprocess(
    app: AppHandle,
    engine: State<'_, Arc<Engine>>,
    source_batch_id: String,
    batch_id: String,
    quality: u8,
    to_webp: bool,
) -> Result<Batch, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.submit(
            batch_id,
            vec![],
            quality,
            to_webp,
            Some(source_batch_id),
            notifier(app),
        )
    })
    .await
    .map_err(io_error)?
}
#[tauri::command]
pub async fn compress_list_batches(engine: State<'_, Arc<Engine>>) -> Result<Vec<Batch>, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.list())
        .await
        .map_err(io_error)
}
#[tauri::command]
pub async fn compress_export(
    app: AppHandle,
    engine: State<'_, Arc<Engine>>,
    batch_id: String,
    item_ids: Vec<String>,
    action: ExportAction,
) -> Result<Vec<ExportResult>, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.export(&batch_id, &item_ids, action, move |paths| {
            let paths = paths.to_vec();
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            app.run_on_main_thread(move || {
                let _ = tx.send(copy_files(&paths));
            })
            .map_err(io_error)?;
            rx.recv().map_err(io_error)?
        })
    })
    .await
    .map_err(io_error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;
    use img_parts::ImageEXIF;
    use std::{sync::mpsc, time::Duration};

    fn png_fixture() -> Vec<u8> {
        let mut bytes = vec![];
        let mut encoder = png::Encoder::new(&mut bytes, 48, 24);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::NoCompression);
        encoder.set_source_gamma(png::ScaledFloat::new(0.45455));
        encoder
            .add_text_chunk("GPS".into(), "private location".into())
            .unwrap();
        let pixels: Vec<u8> = (0..48 * 24)
            .flat_map(|i| {
                if i % 2 == 0 {
                    [200, 50, 30, 0]
                } else {
                    [30, 50, 200, 255]
                }
            })
            .collect();
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&pixels)
            .unwrap();
        bytes
    }
    fn setup() -> (tempfile::TempDir, Arc<Engine>, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("图片 ' 空格.png");
        fs::write(&input, png_fixture()).unwrap();
        let engine = Arc::new(Engine::new(dir.path().join("cache/compress")));
        (dir, engine, input)
    }
    fn start(engine: &Arc<Engine>, id: &str, paths: &[PathBuf], webp: bool) -> Batch {
        engine
            .submit(
                id.into(),
                paths
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect(),
                80,
                webp,
                None,
                Arc::new(|_| {}),
            )
            .unwrap()
    }
    fn wait(engine: &Engine, id: &str) -> Batch {
        for _ in 0..500 {
            if let Some(batch) = engine.list().into_iter().find(|b| b.batch_id == id) {
                if batch.items.iter().all(|i| i.status.terminal()) {
                    return batch;
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("compression did not finish");
    }

    #[test]
    fn png_smaller_transparent_same_size_and_metadata_stripped() {
        let source = png_fixture();
        let output = encode(&source, "png", 80, false).unwrap().unwrap();
        assert!(output.len() < source.len());
        let decoded = image::load_from_memory(&output).unwrap().to_rgba8();
        assert_eq!(decoded.dimensions(), (48, 24));
        assert_eq!(decoded.get_pixel(0, 0)[3], 0);
        assert_eq!(decoded.get_pixel(1, 0)[3], 255);
        let container = img_parts::png::Png::from_bytes(output.into()).unwrap();
        assert!(container.chunk_by_type(*b"tEXt").is_none());
        assert!(container.chunk_by_type(*b"gAMA").is_some());
    }

    #[test]
    fn jpeg_orientation_private_metadata_removed_and_icc_preserved() {
        let img = image::RgbImage::from_pixel(48, 24, image::Rgb([100, 80, 200]));
        let mut bytes = vec![];
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 95)
            .encode_image(&img)
            .unwrap();
        let mut container = img_parts::jpeg::Jpeg::from_bytes(bytes.into()).unwrap();
        let mut exif = vec![
            b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
        ];
        exif.extend_from_slice(b"GPS private metadata");
        container.set_exif(Some(exif.into()));
        // Container round-trip tests do not interpret the profile, so a marker is sufficient.
        container.set_icc_profile(Some(b"test color profile".to_vec().into()));
        let output = encode(&container.encoder().bytes(), "jpg", 80, false)
            .unwrap()
            .unwrap();
        assert_eq!(
            image::load_from_memory(&output).unwrap().dimensions(),
            (24, 48)
        );
        let container = img_parts::jpeg::Jpeg::from_bytes(output.into()).unwrap();
        assert!(container.exif().is_none());
        assert_eq!(
            container.icc_profile().unwrap().as_ref(),
            b"test color profile"
        );
    }

    #[test]
    fn webp_alpha_dimensions_and_icc_round_trip() {
        let mut container = img_parts::png::Png::from_bytes(png_fixture().into()).unwrap();
        container.set_icc_profile(Some(b"test color profile".to_vec().into()));
        let output = encode(&container.encoder().bytes(), "png", 80, true)
            .unwrap()
            .unwrap();
        let decoded = image::load_from_memory(&output).unwrap().to_rgba8();
        assert_eq!(decoded.dimensions(), (48, 24));
        assert_eq!(decoded.get_pixel(0, 0)[3], 0);
        let webp = img_parts::webp::WebP::from_bytes(output.clone().into()).unwrap();
        assert_eq!(webp.icc_profile().unwrap().as_ref(), b"test color profile");
        assert!(encode(&output, "webp", 70, false).unwrap().is_some());
    }

    #[test]
    fn animated_png_corrupt_mismatch_and_limits() {
        let mut bytes = vec![];
        let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_animated(1, 0).unwrap();
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[0, 0, 0, 255])
            .unwrap();
        assert!(encode(&bytes, "png", 80, false).unwrap().is_none());
        assert!(encode(b"corrupt", "png", 80, false).is_err());
        assert!(
            encode(&png_fixture(), "jpg", 80, false)
                .unwrap_err()
                .contains("扩展名")
        );
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("large.png");
        File::create(&file).unwrap().set_len(MAX_FILE + 1).unwrap();
        assert!(read_limited(&file).unwrap_err().contains("128 MiB"));
        let mut huge = img_parts::png::Png::from_bytes(png_fixture().into()).unwrap();
        let mut ihdr = huge.chunks()[0].contents().to_vec();
        ihdr[..4].copy_from_slice(&9000u32.to_be_bytes());
        ihdr[4..8].copy_from_slice(&9000u32.to_be_bytes());
        huge.chunks_mut()[0] = img_parts::png::PngChunk::new(*b"IHDR", ihdr.into());
        assert!(
            encode(&huge.encoder().bytes(), "png", 80, false)
                .unwrap_err()
                .contains("256 MiB")
        );

        let config = webp::WebPConfig::new().unwrap();
        let mut animation = webp::AnimEncoder::new(1, 1, &config);
        let red = [255, 0, 0, 255];
        let blue = [0, 0, 255, 255];
        animation.add_frame(webp::AnimFrame::from_rgba(&red, 1, 1, 0));
        animation.add_frame(webp::AnimFrame::from_rgba(&blue, 1, 1, 100));
        assert!(
            encode(&animation.try_encode().unwrap(), "webp", 80, false)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn first_level_only_deduplicates_and_handles_uppercase() {
        let (dir, engine, path) = setup();
        let folder = dir.path().join("source");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("A.PNG"), png_fixture()).unwrap();
        fs::write(folder.join("ignore.svg"), b"svg").unwrap();
        fs::create_dir(folder.join("nested")).unwrap();
        fs::write(folder.join("nested/B.png"), png_fixture()).unwrap();
        let paths = expand_paths(&[
            folder.to_string_lossy().into_owned(),
            folder.join("A.PNG").to_string_lossy().into_owned(),
        ]);
        assert_eq!(paths, vec![folder.join("A.PNG").canonicalize().unwrap()]);
        start(
            &engine,
            "x",
            &[path, folder.join("ignore.svg"), folder.join("missing.png")],
            false,
        );
        let result = wait(&engine, "x");
        assert_eq!(
            result.items.iter().map(|i| i.status).collect::<Vec<_>>(),
            vec![Status::Compressed, Status::Skipped, Status::Failed]
        );
    }

    #[test]
    fn source_unchanged_duplicate_submit_and_reprocess_from_snapshot() {
        let (_dir, engine, path) = setup();
        let original = fs::read(&path).unwrap();
        let md = Stamp::of(&fs::metadata(&path).unwrap());
        start(&engine, "first", std::slice::from_ref(&path), false);
        let first = wait(&engine, "first");
        start(&engine, "first", std::slice::from_ref(&path), false);
        assert_eq!(engine.list().len(), 1);
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(Stamp::of(&fs::metadata(&path).unwrap()), md);
        fs::remove_file(&path).unwrap();
        engine
            .submit(
                "second".into(),
                vec![],
                50,
                true,
                Some("first".into()),
                Arc::new(|_| {}),
            )
            .unwrap();
        let second = wait(&engine, "second");
        assert_eq!(second.items[0].status, Status::Compressed);
        assert!(!second.items[0].can_overwrite);
        assert_eq!(engine.list()[0].items[0].after, first.items[0].after);
        assert_eq!(engine.list().len(), 2);
        assert!(
            engine
                .submit(
                    "../escape".into(),
                    vec![],
                    80,
                    false,
                    None,
                    Arc::new(|_| {})
                )
                .is_err()
        );
    }

    #[test]
    fn output_collisions_exports_atomic_replace_and_source_changes() {
        let (dir, engine, path) = setup();
        let other = dir.path().join("other");
        fs::create_dir(&other).unwrap();
        let same = other.join(path.file_name().unwrap());
        fs::copy(&path, &same).unwrap();
        start(&engine, "first", &[path.clone(), same.clone()], false);
        let result = wait(&engine, "first");
        assert_ne!(result.items[0].output_name, result.items[1].output_name);
        let ids = vec!["0".into(), "1".into()];
        let copied = engine
            .export("first", &ids, ExportAction::Copy, |paths| {
                assert_eq!(paths.len(), 2);
                assert!(paths.iter().all(|p| p.is_file()));
                Ok(())
            })
            .unwrap();
        assert!(copied.iter().all(|r| r.error.is_none()));
        let saved1 = engine
            .export("first", &ids, ExportAction::Save, |_| Ok(()))
            .unwrap();
        let saved2 = engine
            .export("first", &ids, ExportAction::Save, |_| Ok(()))
            .unwrap();
        assert_ne!(saved1[0].path, saved2[0].path);
        assert!(saved2[0].path.as_ref().unwrap().ends_with(".min.2.png"));
        fs::write(&same, b"user changed this").unwrap();
        let results = engine
            .export("first", &ids, ExportAction::Overwrite, |_| Ok(()))
            .unwrap();
        assert!(results[0].error.is_none());
        assert!(results[1].error.as_ref().unwrap().contains("已变化"));
        assert_eq!(fs::read(&same).unwrap(), b"user changed this");
        assert_eq!(
            fs::metadata(&path).unwrap().len(),
            result.items[0].after.unwrap()
        );
        let failed_clipboard = engine
            .export("first", &ids, ExportAction::Copy, |_| {
                Err("剪贴板不可用".into())
            })
            .unwrap();
        assert!(
            failed_clipboard
                .iter()
                .all(|r| r.error.is_some() && r.path.is_none())
        );
    }

    #[test]
    fn unchanged_preserves_original_bytes_format_and_metadata() {
        let (_dir, engine, path) = setup();
        let tiny = include_bytes!("../../../tests/fixtures/qrcode.png");
        fs::write(&path, tiny).unwrap();
        start(&engine, "small", std::slice::from_ref(&path), false);
        let result = wait(&engine, "small");
        // An already optimized 1x1 PNG is smaller than a newly quantized palette PNG.
        let smallest = image::RgbaImage::from_pixel(1, 1, image::Rgba([0, 0, 0, 255]));
        let mut raw = Cursor::new(vec![]);
        smallest
            .write_to(&mut raw, image::ImageFormat::Png)
            .unwrap();
        let mut options = oxipng::Options::from_preset(2);
        options.force = true;
        let bytes = oxipng::optimize_from_memory(raw.get_ref(), &options).unwrap();
        fs::write(&path, &bytes).unwrap();
        start(&engine, "tiny", std::slice::from_ref(&path), false);
        let fallback = wait(&engine, "tiny");
        assert_eq!(fallback.items[0].status, Status::Unchanged);
        assert!(!fallback.items[0].can_overwrite);
        assert!(fallback.items[0].message.contains("拍摄信息未移除"));
        let copied = engine
            .export("tiny", &["0".into()], ExportAction::Copy, |paths| {
                assert_eq!(fs::read(&paths[0]).unwrap(), bytes);
                Ok(())
            })
            .unwrap();
        assert!(copied[0].error.is_none());
        assert_eq!(result.items.len(), 1);
    }

    #[test]
    fn batches_fifo_events_monotonic_and_startup_only_clears_own_cache() {
        let (dir, engine, path) = setup();
        let (tx, rx) = mpsc::channel();
        let notify: Arc<dyn Fn(Progress) + Send + Sync> = Arc::new(move |p| {
            tx.send(p).unwrap();
        });
        for id in ["first", "second"] {
            engine
                .submit(
                    id.into(),
                    vec![path.to_string_lossy().into_owned()],
                    80,
                    false,
                    None,
                    notify.clone(),
                )
                .unwrap();
        }
        wait(&engine, "second");
        let events: Vec<_> = (0..4)
            .map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap())
            .collect();
        assert_eq!(
            events
                .iter()
                .map(|p| (p.batch_id.as_str(), p.item.version))
                .collect::<Vec<_>>(),
            vec![("first", 1), ("first", 2), ("second", 1), ("second", 2)]
        );
        drop(engine);
        fs::write(dir.path().join("cache/keep"), b"other cache").unwrap();
        let new = Engine::new(dir.path().join("cache/compress"));
        assert!(new.list().is_empty());
        assert!(dir.path().join("cache/keep").exists());
        assert!(!dir.path().join("cache/compress/first").exists());
    }

    #[test]
    fn ten_images_at_most_two_workers_and_readonly_overwrite() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let (dir, engine, path) = setup();
        let inputs: Vec<_> = (0..10)
            .map(|i| {
                let next = dir.path().join(format!("图 {i}.png"));
                fs::copy(&path, &next).unwrap();
                next
            })
            .collect();
        let originals: Vec<_> = inputs
            .iter()
            .map(|p| (fs::read(p).unwrap(), Stamp::of(&fs::metadata(p).unwrap())))
            .collect();
        let live = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let active = live.clone();
        let max = peak.clone();
        let notify = Arc::new(move |p: Progress| {
            if p.item.status == Status::Running {
                max.fetch_max(active.fetch_add(1, Ordering::SeqCst) + 1, Ordering::SeqCst);
            } else {
                active.fetch_sub(1, Ordering::SeqCst);
            }
        });
        engine
            .submit(
                "ten".into(),
                inputs
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect(),
                80,
                false,
                None,
                notify,
            )
            .unwrap();
        let batch = wait(&engine, "ten");
        assert_eq!(batch.items.len(), 10);
        assert!(batch.items.iter().all(|i| i.status == Status::Compressed));
        assert!(peak.load(Ordering::SeqCst) <= 2);
        for (p, (bytes, stamp)) in inputs.iter().zip(originals) {
            assert_eq!(fs::read(p).unwrap(), bytes);
            assert_eq!(Stamp::of(&fs::metadata(p).unwrap()), stamp);
        }
        let mut perms = fs::metadata(&inputs[0]).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&inputs[0], perms).unwrap();
        let result = engine
            .export("ten", &["0".into()], ExportAction::Overwrite, |_| Ok(()))
            .unwrap();
        assert!(result[0].error.as_ref().unwrap().contains("只读"));
    }
}
