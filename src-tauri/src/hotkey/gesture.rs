//! Pure right-button timing, shared by the event callback and its timer.
use std::time::{Duration, Instant};
#[derive(Clone, Copy, Debug)]
pub struct Gesture {
    origin: (f64, f64),
    down: Instant,
    fired: bool,
}
impl Gesture {
    pub fn new(origin: (f64, f64), down: Instant) -> Self {
        Self {
            origin,
            down,
            fired: false,
        }
    }
    pub fn fire(&mut self, now: Instant) -> bool {
        if self.fired || now.duration_since(self.down) < Duration::from_millis(400) {
            return false;
        }
        self.fired = true;
        true
    }
    pub fn fired(&self) -> bool {
        self.fired
    }
    pub fn moved(&self, p: (f64, f64)) -> bool {
        !self.fired && (self.origin.0 - p.0).hypot(self.origin.1 - p.1) > 6.
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn short_press_long_press_and_one_shot() {
        let now = Instant::now();
        let mut g = Gesture::new((10., 20.), now);
        assert!(!g.fire(now + Duration::from_millis(399)));
        assert!(!g.fired());
        assert!(g.fire(now + Duration::from_millis(400)));
        assert!(g.fired());
        assert!(!g.fire(now + Duration::from_secs(1)));
    }
    #[test]
    fn movement_threshold_preserves_drag() {
        let now = Instant::now();
        let mut g = Gesture::new((10., 20.), now);
        assert!(!g.moved((16., 20.)));
        assert!(g.moved((16.1, 20.)));
        g.fire(now + Duration::from_millis(400));
        assert!(!g.moved((100., 200.)));
    }
}
