//! One-way local disable. SCM carries fixed control codes, never user data.
//! Only administrator setup may clear the protected, restart-persistent latch.
use crate::{signin_files, HostError};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

pub(crate) const REQUEST: u32 = 128;
pub(crate) const CONFIRM: u32 = 129;
const PENDING: u32 = 997; // ERROR_IO_PENDING; request accepted, not durable yet.
const CONTENT: &[u8] = b"beacon-remote:sign-in-locally-disabled:v1\n";
const ENABLED: &[u8] = b"beacon-remote:sign-in-locally-enabled:v1\n";
fn enable_path(path: &Path) -> PathBuf {
    path.with_file_name("enabled.marker")
}

pub(crate) fn enable(path: &Path) -> Result<(), HostError> {
    enable_with_acl(path, signin_files::ENABLE_FILE)
}
fn enable_with_acl(path: &Path, acl: &str) -> Result<(), HostError> {
    signin_files::create(&enable_path(path), ENABLED, acl)
}
pub(crate) fn validate_enable(path: &Path) -> Result<(), HostError> {
    validate_enable_with_acl(path, signin_files::ENABLE_FILE)
}
fn validate_enable_with_acl(path: &Path, acl: &str) -> Result<(), HostError> {
    if signin_files::read(path, acl, ENABLED.len())? != ENABLED {
        return Err("Unexpected sign-in enable marker; it was preserved".into());
    }
    Ok(())
}
pub(crate) fn remove_enable(path: &Path) -> Result<(), HostError> {
    remove_enable_with_acl(path, signin_files::ENABLE_FILE)
}
fn remove_enable_with_acl(path: &Path, acl: &str) -> Result<(), HostError> {
    let marker = enable_path(path);
    if present(&marker)? {
        validate_enable_with_acl(&marker, acl)?;
        fs::remove_file(&marker)?;
    }
    // Never report a deletion that is still pending behind an open handle as
    // completed. Missing permission/read errors also fail closed.
    if present(&marker)? {
        return Err("Local sign-in disable is still pending".into());
    }
    Ok(())
}
pub(crate) fn blocked(path: &Path) -> Result<bool, HostError> {
    blocked_with_acl(path, signin_files::ENABLE_FILE)
}
fn blocked_with_acl(path: &Path, acl: &str) -> Result<bool, HostError> {
    let marker = enable_path(path);
    if present(path)? || !present(&marker)? {
        return Ok(true);
    }
    validate_enable_with_acl(&marker, acl)?;
    Ok(false)
}

pub(crate) fn present(path: &Path) -> Result<bool, HostError> {
    match fs::symlink_metadata(path) {
        // Even an incomplete or unexpected latch fails closed. Validation must
        // not turn corrupted state into permission to start a worker.
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

pub(crate) struct LocalRevoke {
    path: PathBuf,
    requested: AtomicBool,
    durable: AtomicBool,
}
impl LocalRevoke {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path,
            requested: AtomicBool::new(false),
            durable: AtomicBool::new(false),
        }
    }
    /// Handler work is atomic only: no disk/network waits on the SCM thread.
    /// REQUEST's success is not confirmation. Clients must wait for CONFIRM.
    pub(crate) fn control(&self, code: u32) -> Option<u32> {
        match code {
            REQUEST => {
                self.request();
                Some(0)
            }
            CONFIRM => Some(if self.durable.load(Ordering::Acquire) {
                0
            } else {
                PENDING
            }),
            _ => None,
        }
    }
    /// Only lowers authority. Also used after an authenticated worker reports
    /// an explicit local Disable action whose filesystem save failed.
    pub(crate) fn request(&self) {
        self.requested.store(true, Ordering::Release);
    }
    pub(crate) fn requested(&self) -> bool {
        self.requested.load(Ordering::Acquire)
    }
    pub(crate) fn pending(&self) -> Result<bool, HostError> {
        if self.requested() || blocked(&self.path)? {
            self.requested.store(true, Ordering::Release);
            return Ok(true);
        }
        Ok(false)
    }
    /// Call after worker exit or its authenticated media-cleanup confirmation.
    /// A failed write stays pending, never
    /// confirms success and must not let the supervisor resume sharing.
    pub(crate) fn persist(&self) -> Result<(), HostError> {
        self.persist_with_acl(signin_files::PUBLIC_FILE)
    }
    fn persist_with_acl(&self, acl: &str) -> Result<(), HostError> {
        if !self.requested.load(Ordering::Acquire) {
            return Err("Local sign-in disable was not requested".into());
        }
        if self.durable.load(Ordering::Acquire) {
            return Ok(());
        }
        signin_files::create(&self.path, CONTENT, acl)?;
        // Also flush an existing matching file after an interrupted write.
        fs::OpenOptions::new()
            .write(true)
            .open(&self.path)?
            .sync_all()?;
        self.durable.store(true, Ordering::Release);
        Ok(())
    }
}

/// Installer-only operation after SCM/process stop. Ordinary repair/update
/// preserves the latch; only explicit administrator enable invokes this.
pub(crate) fn reset(path: &Path) -> Result<(), HostError> {
    reset_with_acl(path, signin_files::PUBLIC_FILE)
}
pub(crate) fn validate(path: &Path) -> Result<(), HostError> {
    if signin_files::read(path, signin_files::PUBLIC_FILE, CONTENT.len())? != CONTENT {
        return Err("Unexpected local sign-in disable state; it was preserved".into());
    }
    Ok(())
}
fn reset_with_acl(path: &Path, acl: &str) -> Result<(), HostError> {
    if present(path)? {
        if signin_files::read(path, acl, CONTENT.len())? != CONTENT {
            return Err("Unexpected local sign-in disable state; it was preserved".into());
        }
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disable_is_one_way_and_confirmed_only_after_persistence_and_survives_restart() {
        let root =
            std::env::temp_dir().join(format!("beacon-signin-revoke-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("disabled.latch");
        let sid = crate::availability::current_sid().unwrap();
        let acl = format!("O:{sid}G:{sid}D:P(A;;FA;;;{sid})");
        enable_with_acl(&path, &acl).unwrap();
        let state = LocalRevoke::new(path.clone());
        assert!(!blocked_with_acl(&path, &acl).unwrap());
        assert!(state.persist_with_acl(&acl).is_err());
        assert_eq!(state.control(CONFIRM), Some(PENDING));
        assert_eq!(state.control(REQUEST), Some(0));
        assert!(state.pending().unwrap());
        // No code can acknowledge persistence, clear the request or enable.
        for code in 0..=255 {
            if code != REQUEST && code != CONFIRM {
                assert_eq!(state.control(code), None);
            }
        }
        assert_eq!(state.control(CONFIRM), Some(PENDING));
        state.persist_with_acl(&acl).unwrap();
        assert_eq!(state.control(CONFIRM), Some(0));
        drop(state);
        let restarted = LocalRevoke::new(path.clone());
        assert!(restarted.pending().unwrap());
        assert_eq!(restarted.control(CONFIRM), Some(PENDING));
        restarted.persist_with_acl(&acl).unwrap();
        assert_eq!(restarted.control(CONFIRM), Some(0));
        drop(restarted);
        reset_with_acl(&path, &acl).unwrap();
        assert!(!blocked_with_acl(&path, &acl).unwrap());
        remove_enable_with_acl(&path, &acl).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn incomplete_or_unwritable_latch_never_reenables_or_confirms_disable() {
        let root = std::env::temp_dir().join(format!(
            "beacon-signin-revoke-failure-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&root).unwrap();
        let path = root.join("disabled.latch");
        let sid = crate::availability::current_sid().unwrap();
        let acl = format!("O:{sid}G:{sid}D:P(A;;FA;;;{sid})");
        // A partial/corrupt marker is not absence, and must not be overwritten.
        signin_files::create(&path, b"partial", &acl).unwrap();
        let restarted = LocalRevoke::new(path.clone());
        assert!(restarted.pending().unwrap());
        assert!(restarted.persist_with_acl(&acl).is_err());
        assert_eq!(restarted.control(CONFIRM), Some(PENDING));
        assert!(reset_with_acl(&path, &acl).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"partial");
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&root).unwrap();

        let absent = LocalRevoke::new(root.join("missing-parent/disabled.latch"));
        absent.control(REQUEST);
        assert!(absent.persist_with_acl(&acl).is_err());
        assert!(absent.pending().unwrap());
        assert_eq!(absent.control(CONFIRM), Some(PENDING));
    }

    #[test]
    fn removing_enable_marker_disables_a_stopped_supervisor_and_repair_cannot_reenable_it() {
        let root =
            std::env::temp_dir().join(format!("beacon-signin-offline-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("disabled.latch");
        let sid = crate::availability::current_sid().unwrap();
        let acl = format!("O:{sid}G:{sid}D:P(A;;FA;;;{sid})");
        enable_with_acl(&path, &acl).unwrap();
        assert!(!blocked_with_acl(&path, &acl).unwrap());
        // No supervisor, SCM notification or network is involved in this stop.
        remove_enable_with_acl(&path, &acl).unwrap();
        remove_enable_with_acl(&path, &acl).unwrap();
        let restarted = LocalRevoke::new(path.clone());
        assert!(restarted.pending().unwrap());
        restarted.persist_with_acl(&acl).unwrap();
        assert_eq!(restarted.control(CONFIRM), Some(0));
        drop(restarted);
        // Clearing only the secondary latch does not restore the missing marker.
        reset_with_acl(&path, &acl).unwrap();
        assert!(LocalRevoke::new(path.clone()).pending().unwrap());
        // Only the administrator installer calls enable, after stopping SCM.
        enable_with_acl(&path, &acl).unwrap();
        assert!(!blocked_with_acl(&path, &acl).unwrap());
        remove_enable_with_acl(&path, &acl).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
