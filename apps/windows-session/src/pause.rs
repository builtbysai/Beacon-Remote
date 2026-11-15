//! Pause (ADR 0029): the person at the computer can stop the screen and input at once, without ending
//! the session. One helper process serves one session, so a single flag is enough. The Stop window
//! sets it; capture, input and the signaling notice to the viewer read it.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

static PAUSED: AtomicBool = AtomicBool::new(false);
static GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn generation() -> u64 {
    GENERATION.load(Ordering::Acquire)
}

pub fn is_paused() -> bool {
    PAUSED.load(Ordering::Acquire)
}
/// Returns the new state.
pub fn toggle() -> bool {
    let paused = !PAUSED.fetch_xor(true, Ordering::AcqRel);
    if paused {
        GENERATION.fetch_add(1, Ordering::AcqRel);
    }
    paused
}
