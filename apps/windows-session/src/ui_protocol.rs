//! The private conversation between the host window (which owns every piece of local UI, ADR 0059) and the
//! headless capture helper. One JSON object per line. The helper's stdout carries [`ToHost`] lines and nothing else;
//! the host's stdin pipe to the helper carries [`ToHelper`] lines after the grant line. Neither side trusts the
//! other's text: lines are length-limited, parsed strictly, and anything unrecognised is dropped.
use serde::{Deserialize, Serialize};

/// The longest line either side will read.
pub const MAX_LINE: usize = 4096;
/// The helper stops if the host has not said `alive` for this long.
pub const LEASE_SECONDS: u64 = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptKind {
    /// The first approval, before anything is shared.
    First,
    /// More access while sharing (control, files, recording, a shared folder, printing).
    More,
}

/// What a person is asked to decide. Display only: the helper keeps its own copy of what was asked.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Prompt {
    pub id: u32,
    pub kind: PromptKind,
    /// Who is asking (an account name). Untrusted text.
    pub controller: String,
    /// A short session label such as `S-1A2B`.
    pub session: String,
    pub display: String,
    /// Keyboard and mouse control was asked for (first requests).
    pub control: bool,
    /// The session has no fixed end (first requests).
    pub unlimited: bool,
    /// What the extra access is, in words (more requests).
    pub detail: String,
    /// Milliseconds the person has to answer.
    pub deadline_ms: u64,
}

/// A full picture of a session in progress, sent whenever it changes and about twice a second.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionState {
    pub controller: String,
    pub session: String,
    /// A real desktop is shared (false for the synthetic video test).
    pub desktop: bool,
    pub connected: bool,
    pub control: bool,
    pub files: bool,
    pub recording: bool,
    pub audio: bool,
    pub paused: bool,
    pub muted: bool,
    /// The viewer is recording right now.
    pub recording_active: bool,
    /// A short note about a file in flight.
    pub note: String,
    /// Milliseconds left, or none when the session lasts until stopped.
    pub remaining_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum ToHost {
    Prompt(Prompt),
    /// The request with this id is no longer pending (answered elsewhere, expired or cancelled).
    Withdraw {
        id: u32,
    },
    State(SessionState),
    Ended,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum ToHelper {
    /// The person's answer. The choices only count with `allow`.
    Answer {
        id: u32,
        allow: bool,
        #[serde(default)]
        control: bool,
        #[serde(default)]
        files: bool,
        #[serde(default)]
        recording: bool,
        #[serde(default)]
        audio: bool,
    },
    Stop,
    Pause {
        on: bool,
    },
    Mute {
        on: bool,
    },
    /// Turn off file and recording access for this connection.
    RevokeExtras,
    /// A file the person picked in the host, to offer to the viewer.
    SendFile {
        path: String,
    },
    /// The host window is alive. Sent from its UI thread every second.
    Alive,
}

/// Why a line was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    TooLong,
    Malformed,
}

fn parse<T: for<'a> Deserialize<'a>>(line: &str) -> Result<T, Refused> {
    let line = line.trim_end_matches(['\r', '\n']);
    if line.len() > MAX_LINE {
        return Err(Refused::TooLong);
    }
    serde_json::from_str(line).map_err(|_| Refused::Malformed)
}

pub fn parse_to_host(line: &str) -> Result<ToHost, Refused> {
    let mut message: ToHost = parse(line)?;
    // Whatever the helper says is drawn, so text is cleaned here, once.
    match &mut message {
        ToHost::Prompt(prompt) => {
            prompt.controller = clean(&prompt.controller, 254);
            prompt.session = clean(&prompt.session, 16);
            prompt.display = clean(&prompt.display, 80);
            prompt.detail = clean(&prompt.detail, 160);
            prompt.deadline_ms = prompt.deadline_ms.min(120_000);
        }
        ToHost::State(state) => {
            state.controller = clean(&state.controller, 254);
            state.session = clean(&state.session, 16);
            state.note = clean(&state.note, 160);
        }
        ToHost::Withdraw { .. } | ToHost::Ended => {}
    }
    Ok(message)
}

pub fn parse_to_helper(line: &str) -> Result<ToHelper, Refused> {
    parse(line)
}

pub fn encode<T: Serialize>(message: &T) -> String {
    let mut line = serde_json::to_string(message).unwrap_or_default();
    line.push('\n');
    line
}

/// Control characters dropped, at most `limit` characters.
pub fn clean(text: &str, limit: usize) -> String {
    let mut out = String::new();
    for (count, character) in text
        .chars()
        .filter(|character| !character.is_control())
        .enumerate()
    {
        if count == limit {
            out.push('…');
            break;
        }
        out.push(character);
    }
    out.trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prompt() -> Prompt {
        Prompt {
            id: 7,
            kind: PromptKind::First,
            controller: "helper@example.test".into(),
            session: "S-1A2B".into(),
            display: "Primary display".into(),
            control: true,
            unlimited: false,
            detail: String::new(),
            deadline_ms: 120_000,
        }
    }

    #[test]
    fn messages_round_trip_one_per_line() {
        let line = encode(&ToHost::Prompt(prompt()));
        assert!(line.ends_with('\n') && line.matches('\n').count() == 1);
        assert_eq!(parse_to_host(&line), Ok(ToHost::Prompt(prompt())));
        let answer = ToHelper::Answer {
            id: 7,
            allow: true,
            control: true,
            files: false,
            recording: false,
            audio: false,
        };
        assert_eq!(parse_to_helper(&encode(&answer)), Ok(answer));
        assert_eq!(
            parse_to_helper(&encode(&ToHelper::Alive)),
            Ok(ToHelper::Alive)
        );
    }

    #[test]
    fn an_answer_without_choices_means_none_chosen() {
        assert_eq!(
            parse_to_helper(r#"{"t":"answer","id":3,"allow":true}"#),
            Ok(ToHelper::Answer {
                id: 3,
                allow: true,
                control: false,
                files: false,
                recording: false,
                audio: false
            })
        );
    }

    #[test]
    fn unknown_malformed_and_oversized_lines_are_refused() {
        assert_eq!(
            parse_to_helper(r#"{"t":"allow-everything"}"#),
            Err(Refused::Malformed)
        );
        assert_eq!(parse_to_helper("not json"), Err(Refused::Malformed));
        assert_eq!(
            parse_to_helper(r#"{"t":"answer","id":"x","allow":true}"#),
            Err(Refused::Malformed)
        );
        let long = format!(r#"{{"t":"send-file","path":"{}"}}"#, "a".repeat(MAX_LINE));
        assert_eq!(parse_to_helper(&long), Err(Refused::TooLong));
        assert_eq!(
            parse_to_host(r#"{"t":"prompt","id":1}"#),
            Err(Refused::Malformed)
        );
    }

    #[test]
    fn text_from_the_helper_is_cleaned_before_it_is_drawn() {
        let mut dirty = prompt();
        dirty.controller = format!("evil\u{0}\n@example.test{}", "x".repeat(400));
        dirty.deadline_ms = u64::MAX;
        let ToHost::Prompt(clean) = parse_to_host(&encode(&ToHost::Prompt(dirty))).unwrap() else {
            panic!("a prompt");
        };
        assert!(!clean.controller.contains('\u{0}') && !clean.controller.contains('\n'));
        assert!(clean.controller.chars().count() <= 255);
        assert_eq!(clean.deadline_ms, 120_000);
    }
}
