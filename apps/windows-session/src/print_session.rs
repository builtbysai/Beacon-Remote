//! The print message handler for P2-1. It joins the job lifecycle (`print_jobs`) to the byte buffers and to a
//! submit function that the caller injects. The real submit is `print_submit::submit`; tests inject a fake, so
//! nothing reaches a spooler here. Every message is checked against the lifecycle before any byte is kept.

use crate::print_jobs::{Jobs, Refusal, State};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Message {
    Begin { id: u32, printer: String, size: u64 },
    Chunk { id: u32, bytes: Vec<u8> },
    Print { id: u32 },
    Cancel { id: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reply {
    Accepted,
    Received { total: u64 },
    Printed,
    Cancelled,
    Refused(&'static str),
}

pub struct PrintSession {
    jobs: Jobs,
    buffers: HashMap<u32, Vec<u8>>,
}

fn refusal_name(refusal: &Refusal) -> &'static str {
    match refusal {
        Refusal::PrinterNotSelected => "printer-not-selected",
        Refusal::TooLarge => "too-large",
        Refusal::UnknownJob => "unknown-job",
        Refusal::WrongState => "wrong-state",
        Refusal::OverDeclared => "over-declared",
    }
}

impl PrintSession {
    pub fn new(selected: Vec<String>, max_bytes: u64) -> Self {
        Self {
            jobs: Jobs::new(selected, max_bytes),
            buffers: HashMap::new(),
        }
    }

    pub fn set_selected(&mut self, selected: Vec<String>) {
        self.jobs.set_selected(selected);
    }

    pub fn selected(&self) -> &[String] {
        self.jobs.selected()
    }

    /// Handles one message. `submit(printer, bytes)` runs only for a job that is complete and queued.
    pub fn handle<F>(&mut self, message: Message, submit: F) -> Reply
    where
        F: FnOnce(&str, &[u8]) -> Result<(), &'static str>,
    {
        match message {
            Message::Begin { id, printer, size } => match self.jobs.begin(id, &printer, size) {
                Ok(()) => {
                    self.buffers.insert(id, Vec::with_capacity(size as usize));
                    Reply::Accepted
                }
                Err(refusal) => Reply::Refused(refusal_name(&refusal)),
            },
            Message::Chunk { id, bytes } => {
                if let Err(refusal) = self.jobs.receive(id, bytes.len() as u64) {
                    return Reply::Refused(refusal_name(&refusal));
                }
                let buffer = self.buffers.entry(id).or_default();
                buffer.extend_from_slice(&bytes);
                Reply::Received {
                    total: buffer.len() as u64,
                }
            }
            Message::Print { id } => {
                if let Err(refusal) = self.jobs.start_printing(id) {
                    return Reply::Refused(refusal_name(&refusal));
                }
                let printer = self.jobs.printer(id).unwrap_or_default().to_string();
                let bytes = self.buffers.remove(&id).unwrap_or_default();
                match submit(&printer, &bytes) {
                    Ok(()) => {
                        let _ = self.jobs.finish(id, true);
                        Reply::Printed
                    }
                    Err(_) => {
                        let _ = self.jobs.finish(id, false);
                        Reply::Refused("spooler-failed")
                    }
                }
            }
            Message::Cancel { id } => match self.jobs.cancel(id) {
                Ok(()) => {
                    self.buffers.remove(&id);
                    Reply::Cancelled
                }
                Err(refusal) => Reply::Refused(refusal_name(&refusal)),
            },
        }
    }

    pub fn state(&self, id: u32) -> Option<State> {
        self.jobs.state(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn session() -> PrintSession {
        PrintSession::new(vec!["Office Laser".to_string()], 1024)
    }

    fn accept(_printer: &str, _bytes: &[u8]) -> Result<(), &'static str> {
        Ok(())
    }

    #[test]
    fn a_complete_job_is_submitted_once_with_its_exact_bytes() {
        let sent = RefCell::new(Vec::new());
        let mut s = session();
        assert_eq!(
            s.handle(
                Message::Begin {
                    id: 1,
                    printer: "Office Laser".into(),
                    size: 4
                },
                accept
            ),
            Reply::Accepted
        );
        assert_eq!(
            s.handle(
                Message::Chunk {
                    id: 1,
                    bytes: b"ab".to_vec()
                },
                accept
            ),
            Reply::Received { total: 2 }
        );
        assert_eq!(
            s.handle(
                Message::Chunk {
                    id: 1,
                    bytes: b"cd".to_vec()
                },
                accept
            ),
            Reply::Received { total: 4 }
        );
        let reply = s.handle(Message::Print { id: 1 }, |p, b| {
            sent.borrow_mut().push((p.to_string(), b.to_vec()));
            Ok(())
        });
        assert_eq!(reply, Reply::Printed);
        assert_eq!(
            sent.borrow().as_slice(),
            &[("Office Laser".to_string(), b"abcd".to_vec())]
        );
        assert_eq!(s.state(1), Some(State::Done));
        assert_eq!(
            s.handle(Message::Print { id: 1 }, accept),
            Reply::Refused("wrong-state")
        );
    }

    #[test]
    fn an_incomplete_job_is_never_printed() {
        let mut s = session();
        s.handle(
            Message::Begin {
                id: 1,
                printer: "Office Laser".into(),
                size: 4,
            },
            accept,
        );
        s.handle(
            Message::Chunk {
                id: 1,
                bytes: b"ab".to_vec(),
            },
            accept,
        );
        assert_eq!(
            s.handle(Message::Print { id: 1 }, accept),
            Reply::Refused("wrong-state")
        );
        assert_eq!(s.state(1), Some(State::Receiving));
    }

    #[test]
    fn cancel_drops_the_bytes_and_a_late_print_is_refused() {
        let mut s = session();
        s.handle(
            Message::Begin {
                id: 1,
                printer: "Office Laser".into(),
                size: 2,
            },
            accept,
        );
        s.handle(
            Message::Chunk {
                id: 1,
                bytes: b"ab".to_vec(),
            },
            accept,
        );
        assert_eq!(
            s.handle(Message::Cancel { id: 1 }, accept),
            Reply::Cancelled
        );
        assert_eq!(
            s.handle(Message::Print { id: 1 }, accept),
            Reply::Refused("wrong-state")
        );
    }

    #[test]
    fn a_spooler_failure_marks_the_job_failed_and_is_reported() {
        let mut s = session();
        s.handle(
            Message::Begin {
                id: 1,
                printer: "Office Laser".into(),
                size: 1,
            },
            accept,
        );
        s.handle(
            Message::Chunk {
                id: 1,
                bytes: b"a".to_vec(),
            },
            accept,
        );
        assert_eq!(
            s.handle(Message::Print { id: 1 }, |_, _| Err("offline")),
            Reply::Refused("spooler-failed")
        );
        assert_eq!(s.state(1), Some(State::Failed));
    }

    #[test]
    fn unselected_printers_and_over_declared_bytes_are_refused() {
        let mut s = session();
        assert_eq!(
            s.handle(
                Message::Begin {
                    id: 1,
                    printer: "Other".into(),
                    size: 1
                },
                accept
            ),
            Reply::Refused("printer-not-selected")
        );
        s.handle(
            Message::Begin {
                id: 2,
                printer: "Office Laser".into(),
                size: 1,
            },
            accept,
        );
        assert_eq!(
            s.handle(
                Message::Chunk {
                    id: 2,
                    bytes: b"ab".to_vec()
                },
                accept
            ),
            Reply::Refused("over-declared")
        );
    }
}
