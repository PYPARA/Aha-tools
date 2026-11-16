use super::Entry;
use serde::Serialize;
use std::{sync::Mutex, time::Instant};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub token: String,
    pub expires_at: u64,
}
pub struct Pending {
    pub ticket: Ticket,
    pub entry: Entry,
    pub deadline: Instant,
}
pub static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
pub fn merge(entries: &mut Vec<Entry>, old: Entry) {
    if let Some(entry) = entries.iter_mut().find(|e| e.id == old.id) {
        entry.pinned |= old.pinned;
        if old.at > entry.at {
            let pin = entry.pinned;
            *entry = old;
            entry.pinned = pin;
        }
    } else {
        entries.push(old);
    }
    entries.sort_by(|a, b| b.at.cmp(&a.at));
}
#[cfg(test)]
mod tests {
    use super::*;
    fn entry(at: u64, pinned: bool) -> Entry {
        Entry {
            id: "same".into(),
            kind: crate::clipboard_watch::ClipKind::Text,
            text: "文字".into(),
            paths: vec![],
            image: None,
            app: Some("备忘录".into()),
            at,
            pinned,
            truncated: false,
        }
    }
    #[test]
    fn undo_merges_new_copy_without_losing_new_time_or_pin() {
        let mut entries = vec![entry(20, false)];
        merge(&mut entries, entry(10, true));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].at, 20);
        assert!(entries[0].pinned);
    }
    #[test]
    fn undo_restores_original_metadata_and_order() {
        let mut entries = vec![];
        merge(&mut entries, entry(10, true));
        assert_eq!(entries[0], entry(10, true));
    }
}
