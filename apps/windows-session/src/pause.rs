//! Pause (ADR 0029): the person at the computer can stop the screen and input at once, without ending
//! the session. One helper process serves one session, so a single flag is enough. The Stop window
//! sets it; capture, input and the signaling notice to the viewer read it.
use std::sync::atomic::{AtomicBool, Ordering};

static PAUSED: AtomicBool = AtomicBool::new(false);

pub fn is_paused() -> bool {
    PAUSED.load(Ordering::Acquire)
}
/// Returns the new state.
pub fn toggle() -> bool {
    !PAUSED.fetch_xor(true, Ordering::AcqRel)
}
