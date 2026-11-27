//! The decision for attaching a viewer to an existing Windows session (P2-5). Attaching changes who is using a
//! computer, so it is allowed only when the owner approved that exact session id, and only for a session the
//! owner can see in the listing. This module decides; it does not call any Windows session API.

use crate::sessions::Session;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny(&'static str),
}

pub fn decide(session: &Session, owner_approved: &[u32], listed: &[Session]) -> Decision {
    if !listed.iter().any(|candidate| candidate.id == session.id) {
        return Decision::Deny("the session is not in the owner's listing");
    }
    if !owner_approved.contains(&session.id) {
        return Decision::Deny("the owner has not approved this session");
    }
    if session.state == "shadow" || session.state == "down" || session.state == "reset" {
        return Decision::Deny("the session cannot be attached in this state");
    }
    Decision::Allow
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: u32, state: &'static str) -> Session {
        Session {
            id,
            name: format!("RDP-Tcp#{id}"),
            state,
        }
    }

    #[test]
    fn only_an_approved_listed_session_can_be_attached() {
        let listed = vec![session(2, "disconnected")];
        assert_eq!(
            decide(&session(2, "disconnected"), &[], &listed),
            Decision::Deny("the owner has not approved this session")
        );
        assert_eq!(
            decide(&session(2, "disconnected"), &[2], &listed),
            Decision::Allow
        );
        assert!(matches!(
            decide(&session(3, "disconnected"), &[3], &listed),
            Decision::Deny(_)
        ));
    }

    #[test]
    fn sessions_in_unsafe_states_are_never_attached() {
        let listed = vec![session(2, "shadow")];
        assert!(matches!(
            decide(&session(2, "shadow"), &[2], &listed),
            Decision::Deny(_)
        ));
    }
}
