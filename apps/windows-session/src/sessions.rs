//! Read-only listing of the Windows sessions on this computer (P2-5). The owner sees each session and its state
//! before anything is attached. Listing never connects, creates, logs off or disconnects a session.

/// One session as Windows reports it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Session {
    pub id: u32,
    pub name: String,
    pub state: &'static str,
}

fn state_name(value: i32) -> &'static str {
    // WTS_CONNECTSTATE_CLASS values as documented by Windows.
    match value {
        0 => "active",
        1 => "connected",
        2 => "connect-query",
        3 => "shadow",
        4 => "disconnected",
        5 => "idle",
        6 => "listening",
        7 => "reset",
        8 => "down",
        9 => "init",
        _ => "unknown",
    }
}

#[cfg(windows)]
pub fn list() -> Result<Vec<Session>, std::io::Error> {
    use windows_sys::Win32::System::RemoteDesktop::{
        WTSEnumerateSessionsW, WTSFreeMemory, WTS_SESSION_INFOW,
    };
    let mut info: *mut WTS_SESSION_INFOW = std::ptr::null_mut();
    let mut count: u32 = 0;
    // The local server is the null handle, and version 1 is the only defined layout.
    let ok = unsafe { WTSEnumerateSessionsW(std::ptr::null_mut(), 0, 1, &mut info, &mut count) };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let entries = unsafe { std::slice::from_raw_parts(info, count as usize) };
    let mut sessions = Vec::with_capacity(entries.len());
    for entry in entries {
        let name = if entry.pWinStationName.is_null() {
            String::new()
        } else {
            let mut length = 0usize;
            while unsafe { *entry.pWinStationName.add(length) } != 0 {
                length += 1;
            }
            String::from_utf16_lossy(unsafe {
                std::slice::from_raw_parts(entry.pWinStationName, length)
            })
        };
        sessions.push(Session {
            id: entry.SessionId,
            name,
            state: state_name(entry.State),
        });
    }
    unsafe { WTSFreeMemory(info.cast()) };
    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_documented_state_has_a_readable_name() {
        assert_eq!(state_name(0), "active");
        assert_eq!(state_name(4), "disconnected");
        assert_eq!(state_name(99), "unknown");
    }

    #[cfg(windows)]
    #[test]
    fn listing_the_sessions_of_this_computer_does_not_fail() {
        let sessions = list().expect("session enumeration should not fail");
        assert!(
            !sessions.is_empty(),
            "a running Windows computer has at least the console session"
        );
    }
}
