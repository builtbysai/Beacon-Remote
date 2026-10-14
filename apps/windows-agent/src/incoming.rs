//! A connection request reaching this computer, for the host window's tray notification.
//!
//! The session code announces each request it hands to the session helper; the host window polls and shows one
//! Windows notification. Nothing here decides anything: the consent window (or trusted access) still does.
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Incoming {
    /// Who is asking: the account's email, or a short label for a guest. Untrusted text; shown, never acted on.
    pub controller: String,
    /// The computer will ask the person to allow it (otherwise trusted access lets it connect).
    pub needs_approval: bool,
    /// Keyboard and mouse control was asked for, not just viewing.
    pub control: bool,
}

static COUNT: AtomicU64 = AtomicU64::new(0);
static LAST: Mutex<Option<Incoming>> = Mutex::new(None);

pub fn announce(request: Incoming) {
    if let Ok(mut last) = LAST.lock() {
        *last = Some(request);
        COUNT.fetch_add(1, Ordering::AcqRel);
    }
}

/// How many requests have been announced so far; a window starts from here so it does not replay old ones.
pub fn mark() -> u64 {
    COUNT.load(Ordering::Acquire)
}

/// The newest request not yet seen by this caller, advancing `seen`. Older ones that arrived in between are skipped.
pub fn next(seen: &mut u64) -> Option<Incoming> {
    let count = COUNT.load(Ordering::Acquire);
    if count == *seen {
        return None;
    }
    *seen = count;
    LAST.lock().ok().and_then(|last| last.clone())
}

/// The name as shown in a notification: control characters dropped, at most 60 characters.
pub fn display_name(raw: &str) -> String {
    let clean: String = raw.chars().filter(|c| !c.is_control()).collect();
    let clean = clean.trim();
    if clean.is_empty() {
        return "Someone".into();
    }
    if clean.chars().count() > 60 {
        format!("{}…", clean.chars().take(59).collect::<String>())
    } else {
        clean.into()
    }
}

/// The notification's title and text (Windows limits them to 63 and 255 characters).
pub fn notice(request: &Incoming) -> (String, String) {
    let what = if request.control {
        "to see and control this computer"
    } else {
        "to see this computer"
    };
    let name = display_name(&request.controller);
    if request.needs_approval {
        (
            "Request to connect".into(),
            format!(
                "{name} is asking {what}. Allow or decline in the Beacon Remote request window."
            ),
        )
    } else {
        (
            "Connecting by trusted access".into(),
            format!("{name} is connecting {what}. No approval is needed because of your trusted access setting. You can stop sharing in the Beacon Remote window."),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(approval: bool, control: bool) -> Incoming {
        Incoming {
            controller: "owner@example.test".into(),
            needs_approval: approval,
            control,
        }
    }

    #[test]
    fn a_request_is_seen_once_and_older_ones_are_skipped() {
        let mut seen = COUNT.load(Ordering::Acquire);
        assert_eq!(next(&mut seen), None);
        announce(request(true, false));
        announce(request(false, true));
        assert_eq!(next(&mut seen), Some(request(false, true)));
        assert_eq!(next(&mut seen), None);
    }

    #[test]
    fn the_notice_says_who_what_and_whether_approval_is_needed() {
        let (title, body) = notice(&request(true, true));
        assert!(
            title.contains("Request")
                && body.contains("owner@example.test")
                && body.contains("control")
        );
        assert!(body.contains("Allow or decline"));
        let (title, body) = notice(&request(false, false));
        assert!(
            title.contains("trusted")
                && !body.contains("control this")
                && body.contains("trusted access")
        );
        assert!(title.chars().count() <= 63 && body.chars().count() <= 255);
    }

    #[test]
    fn names_are_cleaned_and_bounded() {
        assert_eq!(display_name("  a\u{7}b\nc  "), "abc");
        assert_eq!(display_name("\u{1b}\u{7}"), "Someone");
        let long = "x".repeat(200);
        assert_eq!(display_name(&long).chars().count(), 60);
        let (_, body) = notice(&Incoming {
            controller: long,
            needs_approval: true,
            control: true,
        });
        assert!(body.chars().count() <= 255);
    }
}
