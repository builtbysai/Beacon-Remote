//! Challenge age is measured from send time, never reply receipt.
use std::{collections::VecDeque, time::Duration};

pub const MAX_AGE_MS: u64 = 3000;

pub fn remaining(issued: u64, now: u64) -> Option<Duration> {
    if issued == 0 {
        return None;
    }
    let age = now.checked_sub(issued)?;
    (age < MAX_AGE_MS).then(|| Duration::from_millis(MAX_AGE_MS - age))
}

#[derive(Default)]
pub struct Renewals {
    sequence: u64,
    pending: VecDeque<(String, u64)>,
}

impl Renewals {
    pub fn issue(&mut self, now: u64) -> String {
        self.sequence += 1;
        let nonce = self.sequence.to_string();
        self.pending.push_back((nonce.clone(), now.max(1)));
        while self.pending.len() > 4 {
            self.pending.pop_front();
        }
        nonce
    }

    pub fn acknowledge(&mut self, nonce: &str, now: u64) -> Option<u64> {
        let index = self
            .pending
            .iter()
            .position(|(expected, _)| expected == nonce)?;
        let issued = self.pending.remove(index)?.1;
        remaining(issued, now).map(|_| issued)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delayed_and_replayed_replies_cannot_extend_a_lease() {
        let mut renewals = Renewals::default();
        let challenge = renewals.issue(1000);
        let issued = renewals.acknowledge(&challenge, 3500).unwrap();
        assert_eq!(remaining(issued, 3500), Some(Duration::from_millis(500)));
        assert_eq!(remaining(issued, 4000), None);
        assert_eq!(renewals.acknowledge(&challenge, 3501), None);
        let stale = renewals.issue(5000);
        assert_eq!(renewals.acknowledge(&stale, 8000), None);
        assert_eq!(renewals.acknowledge("unknown", 8000), None);
        assert_eq!(remaining(0, 1), None);
        assert_eq!(remaining(100, 99), None);
    }

    #[test]
    fn reordered_replies_keep_the_newest_send_time() {
        let mut renewals = Renewals::default();
        let first = renewals.issue(1000);
        let second = renewals.issue(2000);
        let mut last = renewals.acknowledge(&second, 2500).unwrap();
        last = last.max(renewals.acknowledge(&first, 2600).unwrap());
        assert_eq!(remaining(last, 4999), Some(Duration::from_millis(1)));
        assert_eq!(remaining(last, 5000), None);
        let discarded = renewals.issue(3000);
        for now in [3100, 3200, 3300, 3400] {
            renewals.issue(now);
        }
        assert_eq!(renewals.acknowledge(&discarded, 3500), None);
    }
}
