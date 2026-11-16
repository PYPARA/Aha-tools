//! Explicitly opened windows, ordered least to most recently used.
//! Minimizing, app hiding (⌘H), and losing focus do not close a window here.

use tauri::WindowEvent;

#[derive(Default)]
pub(super) struct Session {
    open: Vec<String>,
    pub dock_visible: bool,
}

impl Session {
    pub const fn new() -> Self {
        Self {
            open: Vec::new(),
            dock_visible: false,
        }
    }

    /// Commit only a completed native transition, after releasing native API calls.
    pub fn visibility_completed(
        &mut self,
        id: &str,
        shown: bool,
        result: Result<(), String>,
    ) -> Result<(), String> {
        result?;
        if shown {
            self.opened(id);
        } else {
            self.closed(id);
        }
        Ok(())
    }

    pub fn opened(&mut self, id: &str) {
        self.closed(id);
        self.open.push(id.to_owned());
    }

    pub fn focused(&mut self, id: &str) {
        // A late focus notification must not resurrect an explicitly hidden window.
        if self.open.iter().any(|item| item == id) {
            self.opened(id);
        }
    }

    pub fn observe(&mut self, id: &str, event: &WindowEvent) {
        match event {
            WindowEvent::Focused(true) => self.focused(id),
            WindowEvent::Destroyed => self.closed(id),
            // Minimize / occlusion may change focus and size, but never the open set.
            _ => {}
        }
    }

    pub fn closed(&mut self, id: &str) {
        self.open.retain(|item| item != id);
    }

    pub fn recent(&self) -> Option<&str> {
        self.open.last().map(String::as_str)
    }

    pub fn wants_dock(&self) -> bool {
        !self.open.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dock_follows_explicit_window_lifetime() {
        let mut s = Session::default();
        assert!(!s.wants_dock());
        s.opened("deepseek");
        s.opened("kimi");
        s.closed("deepseek");
        assert!(s.wants_dock());
        assert_eq!(s.recent(), Some("kimi"));
        s.closed("kimi");
        assert!(!s.wants_dock());
        assert_eq!(s.recent(), None);
    }

    #[test]
    fn focus_order_and_removal_choose_a_live_window() {
        let mut s = Session::default();
        s.opened("deepseek");
        s.opened("kimi");
        s.focused("deepseek");
        assert_eq!(s.recent(), Some("deepseek"));
        s.closed("deepseek");
        s.focused("deepseek");
        s.focused("panel");
        assert_eq!(s.recent(), Some("kimi"));
        s.opened("kimi");
        s.closed("kimi");
        assert!(!s.wants_dock(), "reopening must not count a window twice");
    }

    #[test]
    fn minimizing_and_blurring_keep_windows_available_until_destroyed() {
        let mut s = Session::default();
        s.opened("deepseek");
        s.opened("kimi");
        s.observe("kimi", &WindowEvent::Focused(false));
        s.observe(
            "kimi",
            &WindowEvent::Resized(tauri::PhysicalSize::new(0, 0)),
        );
        s.observe("deepseek", &WindowEvent::Focused(false));
        assert!(s.wants_dock());
        assert_eq!(s.recent(), Some("kimi"));
        // Deleting the most recent window restores the next still-open one.
        s.observe("kimi", &WindowEvent::Destroyed);
        assert_eq!(s.recent(), Some("deepseek"));
        s.observe("deepseek", &WindowEvent::Destroyed);
        assert!(!s.wants_dock());
    }

    #[test]
    fn rapid_transitions_end_in_the_latest_state() {
        let mut s = Session::default();
        for _ in 0..30 {
            s.opened("deepseek");
            s.closed("deepseek");
        }
        assert!(!s.wants_dock());
        s.opened("kimi");
        s.closed("deepseek");
        assert!(s.wants_dock());
        assert_eq!(s.recent(), Some("kimi"));
    }

    #[test]
    fn failed_create_show_and_hide_preserve_actual_open_windows() {
        let mut s = Session::default();
        assert!(
            s.visibility_completed("failed", true, Err("创建失败".into()))
                .is_err()
        );
        assert!(!s.wants_dock());
        s.visibility_completed("deepseek", true, Ok(())).unwrap();
        assert!(
            s.visibility_completed("kimi", true, Err("显示失败".into()))
                .is_err()
        );
        assert_eq!(s.recent(), Some("deepseek"));
        assert!(
            s.visibility_completed("deepseek", false, Err("隐藏失败".into()))
                .is_err()
        );
        assert!(s.wants_dock());
        s.visibility_completed("deepseek", false, Ok(())).unwrap();
        assert!(!s.wants_dock());
    }
}
