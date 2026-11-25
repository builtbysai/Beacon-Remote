//! Fixed-purpose service SAS request. Never changes policy, loads a caller DLL,
//! borrows another login token, or synthesizes a Ctrl+Alt+Delete key chord.
use crate::{
    availability,
    signin_scope::{tick, TICKS_PER_MILLISECOND as T},
    signin_worker, HostError,
};
use serde::{Deserialize, Serialize};
use std::{
    os::windows::io::{AsRawHandle, BorrowedHandle},
    ptr::null_mut,
    sync::Mutex,
};
use windows_sys::Win32::{
    Foundation::{FreeLibrary, GetLastError, ERROR_NO_TOKEN, HMODULE},
    Security::{ImpersonateLoggedOnUser, RevertToSelf, TOKEN_QUERY},
    System::{
        LibraryLoader::{GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32},
        Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_SUBKEY_WOW6464KEY},
        Threading::{GetCurrentThread, OpenThreadToken},
    },
};

const WAIT: u64 = 5000 * T;
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Requested,
    PolicyUnavailable,
    Unavailable,
}
#[derive(Clone, Copy)]
pub(crate) struct Request {
    pub sequence: u64,
    pub deadline: u64,
}
#[derive(Default)]
struct State {
    request: Option<Request>,
    sent: bool,
    result: Option<(u64, Outcome)>,
    last: Option<u64>,
}
#[derive(Default)]
pub(crate) struct Mailbox(Mutex<State>);
impl Mailbox {
    pub(crate) fn enqueue(
        &self,
        sequence: u64,
        lease_deadline: u64,
        now: u64,
    ) -> Result<(), HostError> {
        let mut state = self.0.lock().map_err(|_| "Sign-in attention unavailable")?;
        if sequence == 0
            || lease_deadline <= now
            || state.request.is_some()
            || state.result.is_some()
            || state
                .last
                .is_some_and(|last| now.saturating_sub(last) < 2000 * T)
        {
            return Err("Sign-in attention request rejected".into());
        }
        state.request = Some(Request {
            sequence,
            deadline: lease_deadline.min(now.saturating_add(WAIT)),
        });
        state.sent = false;
        state.last = Some(now);
        Ok(())
    }
    pub(crate) fn take(&self, now: u64) -> Option<Request> {
        let mut state = self.0.lock().ok()?;
        let request = state.request?;
        if state.sent || now >= request.deadline {
            return None;
        }
        state.sent = true;
        Some(request)
    }
    pub(crate) fn finish(
        &self,
        sequence: u64,
        outcome: Outcome,
        now: u64,
    ) -> Result<(), HostError> {
        let mut state = self.0.lock().map_err(|_| "Sign-in attention unavailable")?;
        let request = state.request.ok_or("Unexpected sign-in attention result")?;
        if !state.sent || sequence != request.sequence || now >= request.deadline {
            return Err("Stale sign-in attention result".into());
        }
        state.request = None;
        state.result = Some((sequence, outcome));
        Ok(())
    }
    pub(crate) fn result(&self, now: u64) -> Option<(u64, Outcome)> {
        let mut state = self.0.lock().ok()?;
        if state.request.is_some_and(|request| now >= request.deadline) {
            let request = state.request.take()?;
            state.result = Some((request.sequence, Outcome::Unavailable));
        }
        state.result.take()
    }
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn permits_services(value: Option<u32>) -> bool {
    matches!(value, Some(1 | 3))
}
fn policy() -> bool {
    let mut value = 0u32;
    let mut size = std::mem::size_of_val(&value) as u32;
    let ok = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            wide(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System").as_ptr(),
            wide("SoftwareSASGeneration").as_ptr(),
            RRF_RT_REG_DWORD | RRF_SUBKEY_WOW6464KEY,
            null_mut(),
            std::ptr::from_mut(&mut value).cast(),
            &mut size,
        )
    } == 0;
    permits_services(ok.then_some(value))
}
struct Library(HMODULE);
impl Drop for Library {
    fn drop(&mut self) {
        unsafe {
            FreeLibrary(self.0);
        }
    }
}
struct Impersonation;
impl Drop for Impersonation {
    fn drop(&mut self) {
        // Continuing a network service with an unexpected thread identity is
        // unsafe. This follows Microsoft's RevertToSelf failure requirement.
        if unsafe { RevertToSelf() } == 0 {
            std::process::abort();
        }
    }
}
/// Called only from Session 0 with the retained token that this service created
/// for its own fixed worker. No process ID or user-supplied token is accepted.
pub(crate) fn request(
    token: BorrowedHandle<'_>,
    console: u32,
    deadline: u64,
    allowed: impl Fn() -> bool,
) -> Outcome {
    let live =
        || tick() < deadline && allowed() && signin_worker::locked_console() == Some(console);
    if availability::current_sid().ok().as_deref() != Some("S-1-5-18")
        || signin_worker::process_session().ok() != Some(0)
        || !live()
    {
        return Outcome::Unavailable;
    }
    // Do not replace or restore an arbitrary pre-existing thread impersonation.
    let mut existing = null_mut();
    if unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut existing) } != 0 {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(existing);
        }
        return Outcome::Unavailable;
    }
    if unsafe { GetLastError() } != ERROR_NO_TOKEN {
        return Outcome::Unavailable;
    }
    if !policy() {
        return Outcome::PolicyUnavailable;
    }
    let library = Library(unsafe {
        LoadLibraryExW(
            wide("sas.dll").as_ptr(),
            null_mut(),
            LOAD_LIBRARY_SEARCH_SYSTEM32,
        )
    });
    if library.0.is_null() {
        return Outcome::Unavailable;
    }
    let Some(address) = (unsafe { GetProcAddress(library.0, c"SendSAS".as_ptr().cast()) }) else {
        return Outcome::Unavailable;
    };
    // SendSAS selects the session of the impersonated token. This is our own
    // restricted SYSTEM worker token, never an interactive user's token.
    if !live() || unsafe { ImpersonateLoggedOnUser(token.as_raw_handle()) } == 0 {
        return Outcome::Unavailable;
    }
    let _identity = Impersonation;
    if !live() {
        return Outcome::Unavailable;
    }
    let send: unsafe extern "system" fn(i32) = unsafe { std::mem::transmute(address) };
    unsafe {
        send(0);
    }
    // The Windows API returns void: invocation is not delivery confirmation.
    Outcome::Requested
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_explicit_service_policy_is_allowed() {
        for denied in [None, Some(0), Some(2), Some(4), Some(u32::MAX)] {
            assert!(!permits_services(denied));
        }
        assert!(permits_services(Some(1)));
        assert!(permits_services(Some(3)));
    }
    #[test]
    fn bounded_mailbox_does_not_replay_or_accept_late_results() {
        let mailbox = Mailbox::default();
        let now = 10000 * T;
        mailbox.enqueue(7, now + 15000 * T, now).unwrap();
        assert!(mailbox.enqueue(8, now + 15000 * T, now).is_err());
        let request = mailbox.take(now).unwrap();
        assert_eq!(request.deadline, now + WAIT);
        assert!(mailbox.take(now).is_none());
        assert!(mailbox.finish(8, Outcome::Requested, now).is_err());
        assert!(mailbox.finish(7, Outcome::Requested, now + WAIT).is_err());
        assert!(matches!(
            mailbox.result(now + WAIT),
            Some((7, Outcome::Unavailable))
        ));
        assert!(mailbox.result(now + WAIT).is_none());
        assert!(mailbox.finish(7, Outcome::Requested, now + WAIT).is_err());
        mailbox.enqueue(8, now + WAIT + T, now + WAIT).unwrap();
        assert_eq!(mailbox.take(now + WAIT).unwrap().deadline, now + WAIT + T);
        mailbox
            .finish(8, Outcome::PolicyUnavailable, now + WAIT)
            .unwrap();
        assert!(matches!(
            mailbox.result(now + WAIT),
            Some((8, Outcome::PolicyUnavailable))
        ));
    }
    #[test]
    fn denied_request_never_loads_or_invokes_sas() {
        let token = unsafe {
            BorrowedHandle::borrow_raw(windows_sys::Win32::System::Threading::GetCurrentProcess())
        };
        assert!(matches!(
            request(token, 1, tick() + T, || false),
            Outcome::Unavailable
        ));
    }
}
