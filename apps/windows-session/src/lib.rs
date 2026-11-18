//! Shared in-memory video conversion/encoding. Desktop authority belongs to
//! each caller; this library never captures a screen or injects input.
pub mod drive_exec;
pub mod drive_map;
#[cfg(windows)]
pub mod encoder;
pub mod pixels;
