//! Authority local to one worker/console/lease. No ordinary desktop grant can
//! construct this scope. IPC expiry uses machine uptime, not reply arrival time.
use crate::{availability, signin_worker, HostError};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use windows_sys::Win32::System::WindowsProgramming::QueryInterruptTimePrecise;

pub(crate) const TICKS_PER_MILLISECOND: u64 = 10_000;
pub(crate) fn tick() -> u64 {
    let mut value = 0;
    unsafe {
        QueryInterruptTimePrecise(&mut value);
    }
    value
}
pub(crate) fn bounded_deadline(deadline: u64, now: u64) -> bool {
    deadline
        .checked_sub(now)
        .is_some_and(|left| (1..=15_000 * TICKS_PER_MILLISECOND).contains(&left))
}
struct State {
    lease: String,
    instance: String,
    console: u32,
    deadline: u64,
    ended: bool,
    peer: bool,
}
/// Opaque worker authority. Creation is restricted to authenticated service IPC.
/// This is not a network token, a Windows login or permission to use another desktop.
pub struct SignInScope {
    state: Mutex<State>,
    local_stop: Arc<AtomicBool>,
    pub(crate) attention: crate::signin_attention::Mailbox,
}
pub(crate) struct ScopeOwner(pub Option<Arc<SignInScope>>);
impl Drop for ScopeOwner {
    fn drop(&mut self) {
        if let Some(scope) = &self.0 {
            scope.stop();
        }
    }
}
impl SignInScope {
    pub(crate) fn new(
        lease: String,
        instance: String,
        console: u32,
        deadline: u64,
        local_stop: Arc<AtomicBool>,
    ) -> Result<Arc<Self>, HostError> {
        Self::new_at(lease, instance, console, deadline, local_stop, tick())
    }
    fn new_at(
        lease: String,
        instance: String,
        console: u32,
        deadline: u64,
        local_stop: Arc<AtomicBool>,
        now: u64,
    ) -> Result<Arc<Self>, HostError> {
        let valid_id = |value: &str| uuid::Uuid::parse_str(value).is_ok_and(|id| !id.is_nil());
        if !valid_id(&lease)
            || !valid_id(&instance)
            || console == 0
            || console == u32::MAX
            || !bounded_deadline(deadline, now)
            || local_stop.load(Ordering::Acquire)
        {
            return Err("Invalid sign-in scope".into());
        }
        Ok(Arc::new(Self {
            state: Mutex::new(State {
                lease,
                instance,
                console,
                deadline,
                ended: false,
                peer: false,
            }),
            local_stop,
            attention: crate::signin_attention::Mailbox::default(),
        }))
    }
    pub(crate) fn renew(
        &self,
        lease: &str,
        instance: &str,
        console: u32,
        deadline: u64,
    ) -> Result<(), HostError> {
        self.renew_at(lease, instance, console, deadline, tick())
    }
    fn renew_at(
        &self,
        lease: &str,
        instance: &str,
        console: u32,
        deadline: u64,
        now: u64,
    ) -> Result<(), HostError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sign-in authority unavailable")?;
        if state.ended
            || now >= state.deadline
            || self.local_stop.load(Ordering::Acquire)
            || state.lease != lease
            || state.instance != instance
            || state.console != console
            || !bounded_deadline(deadline, now)
        {
            state.ended = true;
            state.peer = false;
            return Err("Sign-in authority ended".into());
        }
        state.deadline = deadline;
        Ok(())
    }
    pub fn stop(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.ended = true;
            state.peer = false;
        }
    }
    pub(crate) fn expired(&self) -> bool {
        self.state
            .lock()
            .map_or(true, |state| state.ended || tick() >= state.deadline)
    }
    /// Called only by the worker's authenticated peer-connection path. A lease
    /// arriving over IPC alone must never start capture.
    pub fn connect_peer(&self) -> Result<(), HostError> {
        self.check_platform()?;
        self.check_at(tick(), false)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sign-in authority unavailable")?;
        if state.ended || tick() >= state.deadline || self.local_stop.load(Ordering::Acquire) {
            state.ended = true;
            return Err("Sign-in authority ended".into());
        }
        state.peer = true;
        Ok(())
    }
    fn check_platform(&self) -> Result<(), HostError> {
        let console = self
            .state
            .lock()
            .map_err(|_| "Sign-in authority unavailable")?
            .console;
        if availability::current_sid()? != "S-1-5-18" || !signin_worker::on_signin_desktop(console)
        {
            self.stop();
            return Err("Sign-in desktop unavailable".into());
        }
        Ok(())
    }
    pub fn authorize(&self) -> Result<(), HostError> {
        self.check_at(tick(), true)?;
        self.check_platform()?;
        // The platform query may take time. Neither it nor a renewal reply
        // can restart the original lease timer.
        self.check_at(tick(), true)
    }
    // Network negotiation is allowed before peer connection, but never confers
    // capture/input permission or starts a new authorization timer.
    pub(crate) fn authorize_signaling(&self) -> Result<(), HostError> {
        self.check_at(tick(), false)?;
        self.check_platform()?;
        self.check_at(tick(), false)
    }
    pub(crate) fn signaling_binding(&self) -> Result<(String, String, u32), HostError> {
        self.authorize_signaling()?;
        let state = self
            .state
            .lock()
            .map_err(|_| "Sign-in authority unavailable")?;
        Ok((state.lease.clone(), state.instance.clone(), state.console))
    }
    pub(crate) fn request_attention(&self, sequence: u64) -> Result<(), HostError> {
        self.authorize()?;
        let state = self
            .state
            .lock()
            .map_err(|_| "Sign-in authority unavailable")?;
        self.attention.enqueue(sequence, state.deadline, tick())
    }
    pub(crate) fn authorize_binding(
        &self,
        lease: &str,
        instance: &str,
        console: u32,
    ) -> Result<(), HostError> {
        let matches = {
            let state = self
                .state
                .lock()
                .map_err(|_| "Sign-in authority unavailable")?;
            state.lease == lease && state.instance == instance && state.console == console
        };
        if !matches {
            self.stop();
            return Err("Sign-in input scope mismatch".into());
        }
        self.authorize()
    }
    // Teardown may release already-held input after lease expiry, but only on
    // this worker's original live sign-in desktop. Never target a new desktop.
    pub(crate) fn release_allowed(&self) -> bool {
        self.check_platform().is_ok()
    }
    fn check_at(&self, now: u64, need_peer: bool) -> Result<(), HostError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Sign-in authority unavailable")?;
        if state.ended || now >= state.deadline || self.local_stop.load(Ordering::Acquire) {
            state.ended = true;
            state.peer = false;
            return Err("Sign-in authority ended".into());
        }
        if need_peer && !state.peer {
            return Err("Sign-in peer is not connected".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(deadline: u64) -> Arc<SignInScope> {
        SignInScope::new_at(
            uuid::Uuid::new_v4().to_string(),
            uuid::Uuid::new_v4().to_string(),
            2,
            deadline,
            Arc::new(AtomicBool::new(false)),
            1000,
        )
        .unwrap()
    }
    #[test]
    fn delayed_ipc_cannot_extend_expiry_or_revive_an_ended_scope() {
        let scope = fixture(4000);
        assert!(scope.check_at(3999, false).is_ok());
        assert!(scope.check_at(4000, false).is_err());
        let state = scope.state.lock().unwrap();
        let (lease, instance) = (state.lease.clone(), state.instance.clone());
        drop(state);
        assert!(scope.renew_at(&lease, &instance, 2, 10_000, 4001).is_err());
        assert!(scope.check_at(4002, false).is_err());
        assert!(!bounded_deadline(4000, 4000));
        assert!(!bounded_deadline(
            1000 + 15_000 * TICKS_PER_MILLISECOND + 1,
            1000
        ));
        assert!(!bounded_deadline(u64::MAX, 1000));
    }
    #[test]
    fn lease_scope_and_stop_cannot_be_replaced_or_recovered_by_renewal() {
        let scope = fixture(5000);
        let state = scope.state.lock().unwrap();
        let (lease, instance) = (state.lease.clone(), state.instance.clone());
        drop(state);
        assert!(scope.check_at(2000, true).is_err()); // authorization is not peer connection
        assert!(scope.renew_at(&lease, &instance, 2, 7000, 2000).is_ok());
        assert!(scope.renew_at(&lease, &instance, 3, 8000, 2001).is_err());
        assert!(scope.renew_at(&lease, &instance, 2, 8000, 2002).is_err());
        let stopped = fixture(5000);
        stopped.local_stop.store(true, Ordering::Release);
        assert!(stopped.check_at(2000, false).is_err());
        stopped.local_stop.store(false, Ordering::Release);
        assert!(stopped.check_at(2001, false).is_err());
        let disconnected = fixture(5000);
        disconnected.stop();
        assert!(disconnected.check_at(2000, false).is_err());
    }
    #[test]
    fn worker_owner_drop_ends_authority_even_if_a_capture_clone_survives() {
        let scope = fixture(5000);
        scope.state.lock().unwrap().peer = true;
        assert!(scope.check_at(2000, true).is_ok());
        let owner = ScopeOwner(Some(scope.clone()));
        drop(owner);
        assert!(scope.check_at(2001, true).is_err());
    }
}
