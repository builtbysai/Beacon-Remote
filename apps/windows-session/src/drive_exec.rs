//! Runs one P1-4 drive command under an approved mapping. Every path goes through `Grant::resolve` first, so
//! nothing outside the mapped folder, nothing behind a link, and nothing writable on a read-only grant is
//! ever touched. The viewer's JSON is parsed by the caller; this module works on typed commands only.

use crate::drive_map::{is_reparse, Grant, Refusal};
use std::path::Path;
use std::time::Instant;

/// A file or folder inside a mapping, as the viewer sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

/// One operation against a mapping. Paths are viewer segments relative to the mapped folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    List {
        path: Vec<String>,
    },
    Stat {
        path: Vec<String>,
    },
    Read {
        path: Vec<String>,
        offset: u64,
        length: usize,
    },
    Write {
        path: Vec<String>,
        offset: u64,
        data: Vec<u8>,
    },
    Mkdir {
        path: Vec<String>,
    },
    Rename {
        from: Vec<String>,
        to: Vec<String>,
    },
    Delete {
        path: Vec<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reply {
    Entries(Vec<Entry>),
    Stat(Entry),
    Data(Vec<u8>),
    Done,
}

/// Largest single read or write the host performs, matching the protocol's bound.
pub const MAX_TRANSFER: usize = 1024 * 1024;

fn entry_for(path: &Path, name: String) -> Option<Entry> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if is_reparse(&meta) {
        return None;
    }
    Some(Entry {
        name,
        is_dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
    })
}

pub fn execute(grant: &Grant, command: &Command, now: Instant) -> Result<Reply, Refusal> {
    use std::io::{Read, Seek, SeekFrom, Write};
    match command {
        Command::List { path } => {
            let folder = grant.resolve(path, false, now)?;
            let read = std::fs::read_dir(&folder).map_err(|_| Refusal::UnsafePath)?;
            let mut entries: Vec<Entry> = read
                .filter_map(|item| item.ok())
                .filter_map(|item| {
                    let name = item.file_name().to_string_lossy().into_owned();
                    entry_for(&item.path(), name)
                })
                .collect();
            entries.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(Reply::Entries(entries))
        }
        Command::Stat { path } => {
            let target = grant.resolve(path, false, now)?;
            let name = path.last().cloned().unwrap_or_default();
            entry_for(&target, name)
                .map(Reply::Stat)
                .ok_or(Refusal::UnsafePath)
        }
        Command::Read {
            path,
            offset,
            length,
        } => {
            if *length > MAX_TRANSFER {
                return Err(Refusal::TooLarge);
            }
            let target = grant.resolve(path, false, now)?;
            let mut file = std::fs::File::open(&target).map_err(|_| Refusal::UnsafePath)?;
            file.seek(SeekFrom::Start(*offset))
                .map_err(|_| Refusal::UnsafePath)?;
            let mut buffer = vec![0u8; *length];
            let mut filled = 0;
            while filled < buffer.len() {
                let read = file
                    .read(&mut buffer[filled..])
                    .map_err(|_| Refusal::UnsafePath)?;
                if read == 0 {
                    break;
                }
                filled += read;
            }
            buffer.truncate(filled);
            Ok(Reply::Data(buffer))
        }
        Command::Write { path, offset, data } => {
            if data.len() > MAX_TRANSFER {
                return Err(Refusal::TooLarge);
            }
            let target = grant.resolve(path, true, now)?;
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(false)
                .open(&target)
                .map_err(|_| Refusal::UnsafePath)?;
            file.seek(SeekFrom::Start(*offset))
                .map_err(|_| Refusal::UnsafePath)?;
            file.write_all(data).map_err(|_| Refusal::UnsafePath)?;
            Ok(Reply::Done)
        }
        Command::Mkdir { path } => {
            let target = grant.resolve(path, true, now)?;
            std::fs::create_dir(&target).map_err(|_| Refusal::UnsafePath)?;
            Ok(Reply::Done)
        }
        Command::Rename { from, to } => {
            let source = grant.resolve(from, true, now)?;
            let destination = grant.resolve(to, true, now)?;
            // Never overwrite silently: a rename onto an existing name is refused.
            if destination.exists() {
                return Err(Refusal::UnsafePath);
            }
            std::fs::rename(&source, &destination).map_err(|_| Refusal::UnsafePath)?;
            Ok(Reply::Done)
        }
        Command::Delete { path } => {
            if path.is_empty() {
                // The mapped folder itself is never deleted.
                return Err(Refusal::UnsafePath);
            }
            let target = grant.resolve(path, true, now)?;
            let meta = std::fs::symlink_metadata(&target).map_err(|_| Refusal::UnsafePath)?;
            if meta.is_dir() {
                std::fs::remove_dir(&target).map_err(|_| Refusal::UnsafePath)?;
            } else {
                std::fs::remove_file(&target).map_err(|_| Refusal::UnsafePath)?;
            }
            Ok(Reply::Done)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drive_map::Rights;
    use std::path::PathBuf;
    use std::time::Duration;

    fn setup(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("beacon-drive-exec-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::fs::write(root.join("hello.txt"), b"hello world").unwrap();
        root
    }

    fn segs(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|p| p.to_string()).collect()
    }

    #[test]
    fn list_read_and_stat_work_inside_the_mapping() {
        let root = setup("read");
        let now = Instant::now();
        let grant = Grant::new(root.clone(), Rights::Read, Duration::from_secs(60), now).unwrap();
        let Ok(Reply::Entries(entries)) = execute(&grant, &Command::List { path: vec![] }, now)
        else {
            panic!("list failed");
        };
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["docs", "hello.txt"]);
        assert!(entries[0].is_dir);
        let read = execute(
            &grant,
            &Command::Read {
                path: segs(&["hello.txt"]),
                offset: 6,
                length: 100,
            },
            now,
        );
        assert_eq!(read, Ok(Reply::Data(b"world".to_vec())));
        let stat = execute(
            &grant,
            &Command::Stat {
                path: segs(&["hello.txt"]),
            },
            now,
        );
        assert_eq!(
            stat,
            Ok(Reply::Stat(Entry {
                name: "hello.txt".into(),
                is_dir: false,
                size: 11
            }))
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn writes_need_write_rights_and_stay_bounded() {
        let root = setup("write");
        let now = Instant::now();
        let read_only =
            Grant::new(root.clone(), Rights::Read, Duration::from_secs(60), now).unwrap();
        let write = Command::Write {
            path: segs(&["new.txt"]),
            offset: 0,
            data: b"x".to_vec(),
        };
        assert_eq!(execute(&read_only, &write, now), Err(Refusal::ReadOnly));
        let grant = Grant::new(root.clone(), Rights::Write, Duration::from_secs(60), now).unwrap();
        assert_eq!(execute(&grant, &write, now), Ok(Reply::Done));
        assert_eq!(std::fs::read(root.join("new.txt")).unwrap(), b"x");
        let huge = Command::Write {
            path: segs(&["big"]),
            offset: 0,
            data: vec![0; MAX_TRANSFER + 1],
        };
        assert_eq!(execute(&grant, &huge, now), Err(Refusal::TooLarge));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_never_overwrites_and_delete_never_removes_the_root() {
        let root = setup("rename");
        let now = Instant::now();
        let grant = Grant::new(root.clone(), Rights::Write, Duration::from_secs(60), now).unwrap();
        let clash = Command::Rename {
            from: segs(&["hello.txt"]),
            to: segs(&["docs"]),
        };
        assert_eq!(execute(&grant, &clash, now), Err(Refusal::UnsafePath));
        assert!(root.join("hello.txt").exists());
        let moved = Command::Rename {
            from: segs(&["hello.txt"]),
            to: segs(&["docs", "hi.txt"]),
        };
        assert_eq!(execute(&grant, &moved, now), Ok(Reply::Done));
        assert!(root.join("docs").join("hi.txt").exists());
        assert_eq!(
            execute(&grant, &Command::Delete { path: vec![] }, now),
            Err(Refusal::UnsafePath)
        );
        assert_eq!(
            execute(
                &grant,
                &Command::Delete {
                    path: segs(&["docs"])
                },
                now
            ),
            Err(Refusal::UnsafePath)
        );
        assert_eq!(
            execute(
                &grant,
                &Command::Delete {
                    path: segs(&["docs", "hi.txt"])
                },
                now
            ),
            Ok(Reply::Done)
        );
        assert_eq!(
            execute(
                &grant,
                &Command::Delete {
                    path: segs(&["docs"])
                },
                now
            ),
            Ok(Reply::Done)
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
