//! Read file URLs only after an explicit paste. Images use clipboard-manager.

use objc2::{ClassType, rc::autoreleasepool};
use objc2_app_kit::NSPasteboard;
use objc2_foundation::{NSArray, NSURL};

pub fn change_count() -> isize {
    autoreleasepool(|_| NSPasteboard::generalPasteboard().changeCount())
}

#[tauri::command]
pub fn clipboard_files() -> Vec<String> {
    autoreleasepool(|_| {
        let classes = NSArray::from_slice(&[NSURL::class()]);
        // NSURL implements NSPasteboardReading; only file URLs are accepted below.
        let objects = unsafe {
            NSPasteboard::generalPasteboard().readObjectsForClasses_options(&classes, None)
        };
        objects
            .into_iter()
            .flat_map(|objects| {
                objects
                    .iter()
                    .filter_map(|object| {
                        let url = object.downcast_ref::<NSURL>()?;
                        if !url.isFileURL() {
                            return None;
                        }
                        url.path().map(|path| path.to_string())
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    })
}
