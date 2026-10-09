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
        display_id: String,
        x: u32,
        y: u32,
    },
    Button {
        button: u8,
        down: bool,
    },
    Scroll {
        horizontal: i32,
        vertical: i32,
    },
    Key {
        scan_code: u16,
        extended: bool,
        down: bool,
    },
    TypeText {
        text: String,
    },
}

pub trait InputBackend {
    fn inject(&mut self, input: &Input) -> Result<(), ControlError>;
    fn release_all(&mut self);
}

/// The only input entry point; transports cannot inject without a live lease.
pub struct ControlledDesktop<B: InputBackend> {
    pub sessions: SessionCoordinator,
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
            self.backend.release_all();
            return Err(error);
        }
        self.backend.inject(input)
    }

    pub fn stop(&mut self) {
        self.sessions.stop();
        self.backend.release_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
