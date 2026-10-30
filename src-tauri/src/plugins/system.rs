//! macOS system UI plus on-device Vision OCR. No custom screenshot implementation.
use block2::RcBlock;
use objc2::AllocAnyThread;
use objc2_app_kit::{NSColor, NSColorSampler, NSColorSpace};
use objc2_foundation::{NSArray, NSString, NSURL};
use objc2_vision::{
    VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel,
};
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrJob {
    pub id: String,
    pub phase: String,
    pub text: String,
    pub copied: bool,
    pub message: String,
}
static JOB: Mutex<Option<OcrJob>> = Mutex::new(None);
static BUSY: AtomicBool = AtomicBool::new(false);
static COLOR_BUSY: AtomicBool = AtomicBool::new(false);
static NEXT: AtomicU64 = AtomicU64::new(1);
pub fn init(app: &AppHandle) {
    let _ = fs::remove_dir_all(cache(app));
}
fn cache(app: &AppHandle) -> PathBuf {
    app.path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("com.ahatools.app"))
        .join("ocr")
}
fn hide(app: &AppHandle) {
    crate::panel::hide(app);
    crate::popover::hide(app);
    crate::superpanel::hide(app);
}
pub fn run(app: &AppHandle, feature: &str) -> Result<Option<String>, String> {
    match feature {
        "ocr" => start_ocr(app).map(Some),
        "colorpicker" => {
            if objc2::runtime::AnyClass::get(c"NSColorSampler").is_none() {
                return Err("系统取色需要 macOS 10.15 或更新版本".into());
            }
            if COLOR_BUSY.swap(true, Ordering::SeqCst) {
                return Err("正在取色，请先选择或取消".into());
            }
            hide(app);
            let app = app.clone();
            let result = app.run_on_main_thread(move || {
                let block = RcBlock::new(move |color: *mut NSColor| {
                    COLOR_BUSY.store(false, Ordering::SeqCst);
                    if color.is_null() {
                        return;
                    }
                    let Some(rgb) =
                        (unsafe { &*color }).colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())
                    else {
                        crate::relay::notify("无法转换所选颜色");
                        return;
                    };
                    let byte = |c: f64| (c.clamp(0., 1.) * 255.).round() as u8;
                    let hex = format!(
                        "#{:02X}{:02X}{:02X}",
                        byte(rgb.redComponent()),
                        byte(rgb.greenComponent()),
                        byte(rgb.blueComponent())
                    );
                    match crate::context::write_text(&hex) {
                        Ok(()) => crate::relay::notify(&format!("已复制颜色 {hex}")),
                        Err(e) => crate::relay::notify(&e),
                    }
                });
                unsafe {
                    NSColorSampler::new().showSamplerWithSelectionHandler(&block);
                }
            });
            if let Err(e) = result {
                COLOR_BUSY.store(false, Ordering::SeqCst);
                return Err(e.to_string());
            }
            Ok(None)
        }
        "desktop" | "lock" => {
            hide(app);
            let feature = feature.to_string();
            std::thread::spawn(move || {
                if !crate::hotkey::tap::wait_released() {
                    crate::relay::notify("请松开快捷键后再试");
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
                let result = if feature == "desktop" {
                    desktop()
                } else {
                    crate::relay::press("Control+Super+KeyQ")
                };
                if let Err(e) = result {
                    crate::relay::notify(&e);
                }
            });
            Ok(None)
        }
        _ => Err("找不到这个系统动作".into()),
    }
}
fn desktop() -> Result<(), String> {
    unsafe {
        let handle = libc::dlopen(
            c"/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
                .as_ptr(),
            libc::RTLD_LAZY,
        );
        if !handle.is_null() {
            let symbol = libc::dlsym(handle, c"CoreDockSendNotification".as_ptr());
            if !symbol.is_null() {
                let send: unsafe extern "C" fn(*const std::ffi::c_void, *mut std::ffi::c_void) =
                    std::mem::transmute(symbol);
                let name = NSString::from_str("com.apple.showdesktop.awake");
                send((&*name as *const NSString).cast(), std::ptr::null_mut());
                libc::dlclose(handle);
                return Ok(());
            }
            libc::dlclose(handle);
        }
    }
    crate::relay::press("F11")
}
fn update(app: &AppHandle, job: OcrJob) {
    *JOB.lock().unwrap() = Some(job.clone());
    let _ = app.emit_to("panel", "system-ocr-updated", job);
}
fn start_ocr(app: &AppHandle) -> Result<String, String> {
    if objc2::runtime::AnyClass::get(c"VNRecognizeTextRequest").is_none() {
        return Err("截图识字需要 macOS 10.15 或更新版本".into());
    }
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err("正在截图识字，请先完成当前任务".into());
    }
    let id = NEXT.fetch_add(1, Ordering::Relaxed).to_string();
    let job = OcrJob {
        id: id.clone(),
        phase: "capture".into(),
        text: String::new(),
        copied: false,
        message: "请选择要识别的区域，按 Esc 取消".into(),
    };
    update(app, job.clone());
    hide(app);
    let app = app.clone();
    std::thread::spawn(move || {
        struct Guard;
        impl Drop for Guard {
            fn drop(&mut self) {
                BUSY.store(false, Ordering::SeqCst);
            }
        }
        let _guard = Guard;
        let mut job = job;
        let path = cache(&app).join(format!("{}.png", job.id));
        let task = (|| -> Result<bool, String> {
            if !crate::hotkey::tap::wait_released() {
                return Err("请松开快捷键后再试".into());
            }
            std::thread::sleep(Duration::from_millis(150));
            fs::create_dir_all(cache(&app)).map_err(|e| e.to_string())?;
            let status = Command::new("/usr/sbin/screencapture")
                .args(["-i", "-x"])
                .arg(&path)
                .status()
                .map_err(|e| format!("无法开始截图：{e}"))?;
            if !path.exists() {
                if !status.success() && !screen_allowed() {
                    return Err("无法截取屏幕。请在系统设置 → 隐私与安全性 → 屏幕与系统音频录制中允许 AhaTools，然后重试".into());
                }
                return Ok(false);
            }
            job.phase = "loading".into();
            job.message = "正在本机识别…".into();
            update(&app, job.clone());
            crate::panel::open_feature(&app, "system", "ocr", Some(job.id.clone()), true);
            job.text = objc2::rc::autoreleasepool(|_| recognize(&path))?;
            if job.text.trim().is_empty() {
                job.phase = "empty".into();
                job.message = "没有识别到文字，请选择清晰的文字区域".into();
            } else {
                job.phase = "success".into();
                match crate::context::write_text(&job.text) {
                    Ok(()) => {
                        job.copied = true;
                        job.message = "已复制识别文字".into();
                    }
                    Err(e) => job.message = e,
                }
            }
            Ok(true)
        })();
        let _ = fs::remove_file(&path);
        match task {
            Ok(true) => {}
            Ok(false) => {
                job.phase = "cancelled".into();
                job.message = "已取消截图，剪贴板内容保留".into();
            }
            Err(e) => {
                job.phase = "error".into();
                job.message = e.clone();
                crate::relay::notify(&e);
            }
        }
        update(&app, job);
    });
    Ok(id)
}
fn screen_allowed() -> bool {
    unsafe {
        let sym = libc::dlsym(
            libc::RTLD_DEFAULT,
            c"CGPreflightScreenCaptureAccess".as_ptr(),
        );
        if sym.is_null() {
            return true;
        }
        let check: unsafe extern "C" fn() -> bool = std::mem::transmute(sym);
        check()
    }
}
#[allow(deprecated)]
fn recognize(path: &std::path::Path) -> Result<String, String> {
    unsafe {
        let request = VNRecognizeTextRequest::new();
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        let supported = VNRecognizeTextRequest::supportedRecognitionLanguagesForTextRecognitionLevel_revision_error(VNRequestTextRecognitionLevel::Accurate,request.revision())
            .map_err(|e| format!("无法载入识字语言：{e}"))?;
        let languages: Vec<_> = ["zh-Hans", "en-US"]
            .iter()
            .filter(|s| supported.iter().any(|v| v.to_string() == **s))
            .map(|s| NSString::from_str(s))
            .collect();
        if languages.is_empty() {
            return Err("系统没有可用的中文或英文识字语言".into());
        }
        request.setRecognitionLanguages(&NSArray::from_retained_slice(&languages));
        request.setUsesLanguageCorrection(true);
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let handler = VNImageRequestHandler::initWithURL_options(
            VNImageRequestHandler::alloc(),
            &url,
            &objc2_foundation::NSDictionary::new(),
        );
        let requests = NSArray::from_slice(&[&*request as &VNRequest]);
        handler
            .performRequests_error(&requests)
            .map_err(|e| format!("识字失败：{e}"))?;
        let mut lines = vec![];
        if let Some(results) = request.results() {
            for observation in results.iter() {
                if let Some(top) = observation.topCandidates(1).firstObject() {
                    lines.push(top.string().to_string());
                }
            }
        }
        Ok(lines.join("\n"))
    }
}
#[tauri::command]
pub fn system_run(app: AppHandle, feature: String) -> Result<Option<String>, String> {
    run(&app, &feature)
}
#[tauri::command]
pub fn system_ocr_get(job_id: Option<String>) -> Option<OcrJob> {
    JOB.lock()
        .unwrap()
        .as_ref()
        .filter(|j| job_id.as_ref().is_none_or(|id| id == &j.id))
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires a macOS Vision runtime with available recognition models"]
    fn vision_fixture() {
        let text = objc2::rc::autoreleasepool(|_| {
            recognize(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/ocr.png"))
        })
        .unwrap();
        assert!(text.replace(' ', "").contains("AhaTools"), "{text}");
        assert!(text.contains("2026"), "{text}");
        assert!(text.contains("截图识字"), "{text}");
    }
}
