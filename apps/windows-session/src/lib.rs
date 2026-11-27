//! Shared in-memory video conversion/encoding. Desktop authority belongs to
//! each caller; this library never captures a screen or injects input.
#[cfg(windows)]
pub mod attach_policy;
pub mod display_layout;
pub mod drive_exec;
pub mod drive_map;
#[cfg(windows)]
pub mod drive_wire;
#[cfg(windows)]
pub mod encoder;
pub mod peripheral_forward;
pub mod peripheral_policy;
pub mod pixels;
pub mod print_jobs;
pub mod print_session;
#[cfg(windows)]
pub mod print_submit;
#[cfg(windows)]
pub mod printers;
#[cfg(windows)]
pub mod sessions;
pub mod ui_protocol;
pub mod ui_tree;
