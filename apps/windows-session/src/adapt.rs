//! Picks the video quality for a session from what the network and this computer can sustain.
//!
//! A pure state machine: it is fed receiver reports (loss, round-trip time) and the time the encoder
//! spent per frame, and answers with a quality tier. Steps down quickly when the link or the CPU is
//! struggling, steps up slowly and one tier at a time so quality does not oscillate.
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tier {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u32,
}

/// Best first. The session starts at `START`, which matches the previous fixed configuration.
pub const TIERS: [Tier; 5] = [
    Tier {
        width: 1920,
        height: 1080,
        fps: 30,
        bitrate: 6_000_000,
    },
    Tier {
        width: 1280,
        height: 720,
        fps: 30,
        bitrate: 2_500_000,
    },
    Tier {
        width: 1280,
        height: 720,
        fps: 20,
        bitrate: 1_200_000,
    },
    Tier {
        width: 960,
        height: 540,
        fps: 15,
        bitrate: 600_000,
    },
    Tier {
        width: 640,
        height: 360,
        fps: 10,
        bitrate: 300_000,
    },
];
pub const START: usize = 1;

const GOOD_BEFORE_UPGRADE: Duration = Duration::from_secs(12);
const HOLD_AFTER_CHANGE: Duration = Duration::from_secs(4);

#[derive(Clone, Copy, Debug)]
pub struct Sample {
    /// Fraction of packets lost since the last report, 0.0 to 1.0.
    pub loss: f64,
    /// Round-trip time in seconds.
    pub rtt: f64,
}

pub struct Controller {
    tier: usize,
    changed: Instant,
    good_since: Option<Instant>,
    bad: u32,
}

impl Controller {
    pub fn new(now: Instant) -> Self {
        Self {
            tier: START,
            changed: now,
            good_since: None,
            bad: 0,
        }
    }

    #[cfg(test)]
    pub fn tier(&self) -> Tier {
        TIERS[self.tier]
    }

    fn move_to(&mut self, tier: usize, now: Instant) -> Option<Tier> {
        if tier == self.tier {
            return None;
        }
        self.tier = tier;
        self.changed = now;
        self.good_since = None;
        self.bad = 0;
        Some(TIERS[tier])
    }

    /// Network feedback. Returns the new tier when it changes.
    pub fn observe(&mut self, sample: Sample, now: Instant, allow_up: bool) -> Option<Tier> {
        let congested = sample.loss > 0.05 || sample.rtt > 0.45;
        let strained = sample.loss > 0.02 || sample.rtt > 0.25;
        if congested || strained {
            self.good_since = None;
            self.bad += if congested { 2 } else { 1 };
        } else {
            self.bad = self.bad.saturating_sub(1);
            self.good_since.get_or_insert(now);
        }
        if self.bad >= 2 && self.tier + 1 < TIERS.len() {
            // Severe loss drops two tiers at once; a pair of mild reports drops one.
            let step = if sample.loss > 0.12 { 2 } else { 1 };
            return self.move_to((self.tier + step).min(TIERS.len() - 1), now);
        }
        let clean = sample.loss < 0.01 && sample.rtt < 0.15;
        if clean
            && allow_up
            && self.tier > 0
            && now.duration_since(self.changed) >= HOLD_AFTER_CHANGE
            && self
                .good_since
                .is_some_and(|since| now.duration_since(since) >= GOOD_BEFORE_UPGRADE)
        {
            return self.move_to(self.tier - 1, now);
        }
        None
    }

    /// Encoding cost. `busy` is the average share of the frame interval spent converting and
    /// encoding. Above this the computer, not the network, is the limit, so quality steps down
    /// and the controller does not climb back into a tier it cannot sustain.
    pub fn observe_cost(&mut self, busy: f64, now: Instant) -> Option<Tier> {
        if busy > 0.85 && self.tier + 1 < TIERS.len() {
            return self.move_to(self.tier + 1, now);
        }
        None
    }

    /// True when moving up would put the encoder over budget at the higher tier's frame rate.
    pub fn may_upgrade_for_cost(&self, busy: f64) -> bool {
        if self.tier == 0 {
            return false;
        }
        let up = TIERS[self.tier - 1];
        let now = TIERS[self.tier];
        // Cost scales roughly with pixels and frame rate.
        let scale = (f64::from(up.width) * f64::from(up.height) * f64::from(up.fps))
            / (f64::from(now.width) * f64::from(now.height) * f64::from(now.fps));
        busy * scale < 0.7
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, seconds: u64) -> Instant {
        start + Duration::from_secs(seconds)
    }
    const GOOD: Sample = Sample {
        loss: 0.0,
        rtt: 0.04,
    };

    #[test]
    fn starts_at_the_previous_fixed_quality() {
        let controller = Controller::new(Instant::now());
        assert_eq!(controller.tier().width, 1280);
        assert_eq!(controller.tier().bitrate, 2_500_000);
    }

    #[test]
    fn steps_down_after_two_bad_reports_and_two_tiers_for_heavy_loss() {
        let t0 = Instant::now();
        let mut controller = Controller::new(t0);
        let mild = Sample {
            loss: 0.03,
            rtt: 0.1,
        };
        assert_eq!(controller.observe(mild, at(t0, 2), true), None);
        assert_eq!(controller.observe(mild, at(t0, 4), true), Some(TIERS[2]));
        let heavy = Sample {
            loss: 0.2,
            rtt: 0.1,
        };
        assert_eq!(controller.observe(heavy, at(t0, 6), true), Some(TIERS[4]));
        assert_eq!(
            controller.observe(heavy, at(t0, 8), true),
            None,
            "already lowest"
        );
    }

    #[test]
    fn steps_up_slowly_one_tier_at_a_time_and_only_when_clean() {
        let t0 = Instant::now();
        let mut controller = Controller::new(t0);
        for second in 0..11 {
            assert_eq!(controller.observe(GOOD, at(t0, second), true), None);
        }
        assert_eq!(controller.observe(GOOD, at(t0, 13), true), Some(TIERS[0]));
        // Nothing above the best tier.
        assert_eq!(controller.observe(GOOD, at(t0, 40), true), None);
    }

    #[test]
    fn a_bad_report_resets_the_climb() {
        let t0 = Instant::now();
        let mut controller = Controller::new(t0);
        for second in 0..8 {
            controller.observe(GOOD, at(t0, second), true);
        }
        let blip = Sample {
            loss: 0.03,
            rtt: 0.1,
        };
        controller.observe(blip, at(t0, 9), true);
        assert_eq!(controller.observe(GOOD, at(t0, 14), true), None);
        assert_eq!(controller.observe(GOOD, at(t0, 20), true), None);
        assert_eq!(controller.observe(GOOD, at(t0, 27), true), Some(TIERS[0]));
    }

    #[test]
    fn an_overloaded_computer_steps_down_and_blocks_costly_upgrades() {
        let t0 = Instant::now();
        let mut controller = Controller::new(t0);
        assert_eq!(controller.observe_cost(0.5, t0), None);
        assert_eq!(controller.observe_cost(0.95, t0), Some(TIERS[2]));
        // 1280x720@20 busy 0.6 would be 0.6 * 1.5 = 0.9 of a frame at 720p30.
        assert!(!controller.may_upgrade_for_cost(0.6));
        assert!(controller.may_upgrade_for_cost(0.3));
    }
}
