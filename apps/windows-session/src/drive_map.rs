//! P1-4 host enforcement for a mapped local folder. The viewer names a path as bounded segments relative to
//! the folder the owner picked; this module decides whether that path may be touched. It never follows a
//! symbolic link, junction or other reparse point, never leaves the root, and refuses writes on a read-only
//! grant or after the grant has expired. It does no I/O beyond inspecting entries it is asked about.

use std::path::{Component, PathBuf};
use std::time::{Duration, Instant};

/// The rights the owner approved for a mapping. A write grant also allows reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rights {
    Read,
    Write,
}

/// A locally approved mapping. Created only after the owner picks the folder and approves on this computer.
#[derive(Clone, Debug)]
pub struct Grant {
    root: PathBuf,
    rights: Rights,
    expires_at: Instant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The path has a segment that is empty, traversal, a separator, a drive prefix, a control character,
    /// a reserved device name, or ends in a dot or space.
    UnsafePath,
    /// The path is deeper than the protocol allows.
    TooDeep,
    /// The path crosses a symbolic link, junction or other reparse point.
    ReparsePoint,
    /// The operation needs write access and the grant is read-only.
    ReadOnly,
    /// The grant has passed its expiry.
    Expired,
    /// The root could not be opened as a directory.
    RootMissing,
}

const MAX_DEPTH: usize = 32;

impl Grant {
    pub fn new(root: PathBuf, rights: Rights, lifetime: Duration, now: Instant) -> Option<Self> {
        let named = root.components().any(|c| matches!(c, Component::Normal(_)));
        if !named || !root.is_dir() {
            // A bare drive root or a missing folder is never mapped.
            return None;
        }
        Some(Self {
            root,
            rights,
            expires_at: now + lifetime,
        })
    }

    pub fn expired(&self, now: Instant) -> bool {
        now >= self.expires_at
    }

    /// Resolves a viewer path to a real path under the root, or says why it may not be used.
    pub fn resolve(
        &self,
        segments: &[String],
        write: bool,
        now: Instant,
    ) -> Result<PathBuf, Refusal> {
        if self.expired(now) {
            return Err(Refusal::Expired);
        }
        if write && self.rights == Rights::Read {
            return Err(Refusal::ReadOnly);
        }
        if segments.len() > MAX_DEPTH {
            return Err(Refusal::TooDeep);
        }
        let mut path = self.root.clone();
        for segment in segments {
            if !safe_segment(segment) {
                return Err(Refusal::UnsafePath);
            }
            path.push(segment);
            // Every component that exists must be a plain file or folder, not a link into elsewhere.
            if let Ok(meta) = std::fs::symlink_metadata(&path) {
                if is_reparse(&meta) {
                    return Err(Refusal::ReparsePoint);
                }
            }
        }
        // Lexical containment as a last check: nothing above can have produced a path outside the root.
        if !path.starts_with(&self.root)
            || path.components().any(|c| matches!(c, Component::ParentDir))
        {
            return Err(Refusal::UnsafePath);
        }
        Ok(path)
    }
}

/// One plain path segment: a name, not a traversal, separator, drive or device name.
pub fn safe_segment(segment: &str) -> bool {
    if segment.is_empty() || segment == "." || segment == ".." {
        return false;
    }
    if segment
        .chars()
        .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
    {
        return false;
    }
    if segment.ends_with('.') || segment.ends_with(' ') {
        return false;
    }
    let device = segment.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device.len() == 4
            && (device.starts_with("COM") || device.starts_with("LPT"))
            && device.as_bytes()[3].is_ascii_digit()
            && device.as_bytes()[3] != b'0');
    !reserved
}

#[cfg(windows)]
fn is_reparse(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_type().is_symlink() || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse(meta: &std::fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("beacon-drive-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("reports")).unwrap();
        root
    }

    fn segs(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|p| p.to_string()).collect()
    }

    #[test]
    fn only_plain_segments_under_the_root_resolve() {
        let root = temp_root("plain");
        let now = Instant::now();
        let grant = Grant::new(root.clone(), Rights::Read, Duration::from_secs(60), now).unwrap();
        assert_eq!(
            grant.resolve(&segs(&["reports", "q3.xlsx"]), false, now),
            Ok(root.join("reports").join("q3.xlsx"))
        );
        for bad in [
            segs(&[".."]),
            segs(&["a\\b"]),
            segs(&["C:"]),
            segs(&["CON"]),
            segs(&["name."]),
            segs(&["sp "]),
            segs(&["bad\u{0}"]),
            segs(&[""]),
        ] {
            assert_eq!(
                grant.resolve(&bad, false, now),
                Err(Refusal::UnsafePath),
                "{bad:?}"
            );
        }
        let deep = vec!["d".to_string(); 33];
        assert_eq!(grant.resolve(&deep, false, now), Err(Refusal::TooDeep));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn read_only_and_expired_grants_refuse_what_they_must() {
        let root = temp_root("rights");
        let now = Instant::now();
        let read = Grant::new(root.clone(), Rights::Read, Duration::from_secs(60), now).unwrap();
        assert_eq!(
            read.resolve(&segs(&["reports"]), true, now),
            Err(Refusal::ReadOnly)
        );
        assert!(read.resolve(&segs(&["reports"]), false, now).is_ok());
        let write = Grant::new(root.clone(), Rights::Write, Duration::from_secs(60), now).unwrap();
        assert!(write.resolve(&segs(&["reports"]), true, now).is_ok());
        let later = now + Duration::from_secs(61);
        assert_eq!(
            write.resolve(&segs(&["reports"]), false, later),
            Err(Refusal::Expired)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_bare_or_missing_root_is_never_mapped() {
        let now = Instant::now();
        assert!(Grant::new(
            PathBuf::from("C:\\"),
            Rights::Read,
            Duration::from_secs(60),
            now
        )
        .is_none());
        let missing = std::env::temp_dir().join("beacon-drive-definitely-missing-folder");
        assert!(Grant::new(missing, Rights::Read, Duration::from_secs(60), now).is_none());
    }

    #[test]
    fn a_link_inside_the_root_is_refused_when_the_platform_allows_creating_one() {
        let root = temp_root("link");
        let outside = temp_root("outside");
        let link = root.join("escape");
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(&outside, &link).is_ok();
        #[cfg(not(windows))]
        let made = std::os::unix::fs::symlink(&outside, &link).is_ok();
        if !made {
            eprintln!("skipping: this account cannot create symbolic links");
        } else {
            let now = Instant::now();
            let grant =
                Grant::new(root.clone(), Rights::Write, Duration::from_secs(60), now).unwrap();
            assert_eq!(
                grant.resolve(&segs(&["escape", "file.txt"]), true, now),
                Err(Refusal::ReparsePoint)
            );
        }
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }
}
