//! Transport-independent, fail-closed desktop capabilities.
//! No HTTP, browser, or future automation dependency belongs here.
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Capability {
    DesktopView,
    DesktopControl,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ControlError {
    NoLease,
    NotController,
    Expired,
    Busy,
    InvalidLease,
    PlatformUnavailable,
    InvalidInput,
}

pub struct ControllerLease {
    session_id: String,
    controller_id: String,
    expires_at: Instant,
}

#[derive(Default)]
pub struct SessionCoordinator {
    controller: Option<ControllerLease>,
}

impl SessionCoordinator {
    /// Caller must verify server authorization AND local user consent first.
    /// Relative monotonic expiry prevents wall-clock changes extending control.
    pub fn start(
        &mut self,
        session_id: String,
        controller_id: String,
        lifetime: Duration,
        now: Instant,
    ) -> Result<(), ControlError> {
        if session_id.is_empty()
            || controller_id.is_empty()
            || lifetime.is_zero()
            || lifetime > Duration::from_secs(300)
        {
            return Err(ControlError::InvalidLease);
        }
        if self.controller.as_ref().is_some_and(|c| c.expires_at > now) {
            return Err(ControlError::Busy);
        }
        self.controller = Some(ControllerLease {
            session_id,
            controller_id,
            expires_at: now + lifetime,
        });
        Ok(())
    }

    pub fn authorize_input(
        &self,
        session_id: &str,
        controller_id: &str,
        now: Instant,
    ) -> Result<(), ControlError> {
        let lease = self.controller.as_ref().ok_or(ControlError::NoLease)?;
        if now >= lease.expires_at {
            return Err(ControlError::Expired);
        }
        if lease.session_id != session_id || lease.controller_id != controller_id {
            return Err(ControlError::NotController);
        }
        Ok(())
    }

    /// Stop input immediately on local revoke, disconnect, or server revocation.
    /// Platform implementations must also release every held key/button.
    pub fn stop(&mut self) {
        self.controller = None;
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Display {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub origin_x: i32,
    pub origin_y: i32,
    pub scale: f64,
}

pub struct Snapshot {
    pub display_id: String,
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

/// Capture serves both snapshots and the continuous encoder pipeline.
/// Implementations run inside the interactive user's Windows session.
pub trait ScreenCapture {
    fn get_displays(&self) -> Result<Vec<Display>, ControlError>;
    fn capture_snapshot(&mut self, display_id: &str) -> Result<Snapshot, ControlError>;
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Input {
    MovePointer {
        #[serde(rename = "displayId")]
        display_id: String,
        x: u32,
        y: u32,
    },
    Button {
        button: MouseButton,
        down: bool,
    },
    Scroll {
        horizontal: i32,
        vertical: i32,
    },
    Key {
        #[serde(rename = "scanCode")]
        scan_code: u16,
        extended: bool,
        down: bool,
    },
    TypeText {
        text: String,
    },
    ReleaseAll,
    KeepAlive,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

impl Input {
    pub fn validate(&self) -> Result<(), ControlError> {
        let valid = match self {
            Self::MovePointer { display_id, .. } => {
                !display_id.is_empty() && display_id.len() <= 80
            }
            Self::Scroll {
                horizontal,
                vertical,
            } => horizontal.abs_diff(0) <= 32767 && vertical.abs_diff(0) <= 32767,
            // Windows set-1 scan codes; E0 is supplied separately. Reject E1 and raw flags.
            Self::Key { scan_code, .. } => (1..=0x7f).contains(scan_code),
            Self::TypeText { text } => {
                !text.is_empty()
                    && text.encode_utf16().count() <= 256
                    && !text.chars().any(char::is_control)
            }
            _ => true,
        };
        if valid {
            Ok(())
        } else {
            Err(ControlError::InvalidInput)
        }
    }
}

pub trait InputBackend {
    fn inject(&mut self, input: &Input) -> Result<(), ControlError>;
    fn release_all(&mut self);
}

/// The only input entry point; transports cannot inject without a live lease.
pub struct ControlledDesktop<B: InputBackend> {
    sessions: SessionCoordinator,
    backend: B,
}

impl<B: InputBackend> ControlledDesktop<B> {
    pub fn new(backend: B) -> Self {
        Self {
            sessions: SessionCoordinator::default(),
            backend,
        }
    }

    pub fn input(
        &mut self,
        session: &str,
        controller: &str,
        input: &Input,
        now: Instant,
    ) -> Result<(), ControlError> {
        if let Err(error) = self.sessions.authorize_input(session, controller, now) {
            self.stop();
            return Err(error);
        }
        if let Err(error) = input.validate().and_then(|()| self.backend.inject(input)) {
            self.stop();
            return Err(error);
        }
        Ok(())
    }

    /// Replacing an expired controller must release its held state first.
    pub fn start(
        &mut self,
        session: String,
        controller: String,
        lifetime: Duration,
        now: Instant,
    ) -> Result<(), ControlError> {
        if self
            .sessions
            .controller
            .as_ref()
            .is_some_and(|lease| lease.expires_at <= now)
        {
            self.stop();
        }
        self.sessions.start(session, controller, lifetime, now)
    }

    pub fn expire(&mut self, now: Instant) {
        if self
            .sessions
            .controller
            .as_ref()
            .is_some_and(|lease| lease.expires_at <= now)
        {
            self.stop();
        }
    }

    pub fn stop(&mut self) {
        self.sessions.stop();
        self.backend.release_all();
    }
}

impl<B: InputBackend> Drop for ControlledDesktop<B> {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct State {
        held: bool,
        injections: usize,
        releases: usize,
    }
    struct Backend(Arc<Mutex<State>>);
    impl InputBackend for Backend {
        fn inject(&mut self, _: &Input) -> Result<(), ControlError> {
            let mut state = self.0.lock().unwrap();
            state.held = true;
            state.injections += 1;
            Ok(())
        }
        fn release_all(&mut self) {
            let mut state = self.0.lock().unwrap();
            state.held = false;
            state.releases += 1;
        }
    }
    #[test]
    fn held_input_is_released_on_invalid_input_expiry_stop_and_drop() {
        let state = Arc::new(Mutex::new(State::default()));
        let now = Instant::now();
        let down = Input::Key {
            scan_code: 0x1d,
            extended: false,
            down: true,
        };
        let mut desktop = ControlledDesktop::new(Backend(state.clone()));
        assert_eq!(
            desktop.input("s", "c", &down, now),
            Err(ControlError::NoLease)
        );
        assert_eq!(state.lock().unwrap().injections, 0);
        desktop
            .start("s".into(), "c".into(), Duration::from_secs(1), now)
            .unwrap();
        desktop.input("s", "c", &down, now).unwrap();
        assert!(state.lock().unwrap().held);
        desktop.expire(now + Duration::from_secs(1));
        assert!(!state.lock().unwrap().held);
        assert_eq!(
            desktop.input("s", "c", &down, now),
            Err(ControlError::NoLease)
        );
        desktop
            .start("s".into(), "c".into(), Duration::from_secs(1), now)
            .unwrap();
        desktop.input("s", "c", &down, now).unwrap();
        assert_eq!(
            desktop.input(
                "s",
                "c",
                &Input::Key {
                    scan_code: 0x8000,
                    extended: false,
                    down: true
                },
                now
            ),
            Err(ControlError::InvalidInput)
        );
        assert!(!state.lock().unwrap().held);
        assert_eq!(
            desktop.input("s", "c", &down, now),
            Err(ControlError::NoLease)
        );
        desktop
            .start("s".into(), "c".into(), Duration::from_secs(1), now)
            .unwrap();
        desktop.input("s", "c", &down, now).unwrap();
        desktop.stop();
        assert!(!state.lock().unwrap().held);
        desktop
            .start("s".into(), "c".into(), Duration::from_secs(1), now)
            .unwrap();
        desktop.input("s", "c", &down, now).unwrap();
        let released = state.lock().unwrap().releases;
        drop(desktop);
        assert!(!state.lock().unwrap().held);
        assert!(state.lock().unwrap().releases > released);
    }

    #[test]
    fn expired_controller_replacement_releases_the_previous_held_input() {
        let state = Arc::new(Mutex::new(State::default()));
        let now = Instant::now();
        let mut desktop = ControlledDesktop::new(Backend(state.clone()));
        desktop
            .start("old".into(), "old".into(), Duration::from_secs(1), now)
            .unwrap();
        desktop
            .input(
                "old",
                "old",
                &Input::Button {
                    button: MouseButton::Left,
                    down: true,
                },
                now,
            )
            .unwrap();
        assert_eq!(
            desktop.start("new".into(), "new".into(), Duration::from_secs(1), now),
            Err(ControlError::Busy)
        );
        assert!(state.lock().unwrap().held);
        desktop
            .start(
                "new".into(),
                "new".into(),
                Duration::from_secs(1),
                now + Duration::from_secs(1),
            )
            .unwrap();
        assert!(!state.lock().unwrap().held);
        assert_eq!(
            desktop.input(
                "old",
                "old",
                &Input::KeepAlive,
                now + Duration::from_secs(1)
            ),
            Err(ControlError::NotController)
        );
    }

    #[test]
    fn control_lease_rejects_collision_wrong_identity_expiry_and_revocation() {
        let now = Instant::now();
        let mut sessions = SessionCoordinator::default();
        sessions
            .start(
                "session".into(),
                "human".into(),
                Duration::from_secs(30),
                now,
            )
            .unwrap();
        assert_eq!(
            sessions.start("other".into(), "other".into(), Duration::from_secs(30), now),
            Err(ControlError::Busy)
        );
        assert_eq!(
            sessions.authorize_input("session", "intruder", now),
            Err(ControlError::NotController)
        );
        assert_eq!(sessions.authorize_input("session", "human", now), Ok(()));
        assert_eq!(
            sessions.authorize_input("session", "human", now + Duration::from_secs(30)),
            Err(ControlError::Expired)
        );
        sessions.stop();
        assert_eq!(
            sessions.authorize_input("session", "human", now),
            Err(ControlError::NoLease)
        );
    }
}
