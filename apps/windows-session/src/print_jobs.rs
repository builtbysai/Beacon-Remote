//! Lifecycle for redirected print jobs (P2-1). This is the bookkeeping only: which job is in which state, how big
//! it may be, and that a cancel always wins over a late completion. It never talks to the print spooler, never
//! installs a printer, and never accepts a job for a printer the owner did not select. The spooler step comes
//! later, behind this state machine.

use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    /// Accepted from the viewer; bytes are still arriving.
    Receiving,
    /// All bytes arrived and matched the declared size; waiting to be handed to the printer.
    Queued,
    /// Handed to the printer by the (separate) spooler adapter.
    Printing,
    Done,
    Cancelled,
    Failed,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The printer is not one the owner selected.
    PrinterNotSelected,
    /// The declared size is zero or above the owner's limit.
    TooLarge,
    /// The job id is already in use or unknown.
    UnknownJob,
    /// The job is not in a state that allows this step.
    WrongState,
    /// More bytes arrived than were declared.
    OverDeclared,
}

#[derive(Debug)]
struct Job {
    printer: String,
    declared: u64,
    received: u64,
    state: State,
}

#[derive(Debug)]
pub struct Jobs {
    selected: Vec<String>,
    max_bytes: u64,
    jobs: HashMap<u32, Job>,
}

impl Jobs {
    pub fn new(selected: Vec<String>, max_bytes: u64) -> Self {
        Self {
            selected,
            max_bytes,
            jobs: HashMap::new(),
        }
    }

    pub fn begin(&mut self, id: u32, printer: &str, declared: u64) -> Result<(), Refusal> {
        if !self.selected.iter().any(|p| p == printer) {
            return Err(Refusal::PrinterNotSelected);
        }
        if declared == 0 || declared > self.max_bytes {
            return Err(Refusal::TooLarge);
        }
        if self.jobs.contains_key(&id) {
            return Err(Refusal::WrongState);
        }
        self.jobs.insert(
            id,
            Job {
                printer: printer.to_string(),
                declared,
                received: 0,
                state: State::Receiving,
            },
        );
        Ok(())
    }

    pub fn receive(&mut self, id: u32, bytes: u64) -> Result<(), Refusal> {
        let job = self.jobs.get_mut(&id).ok_or(Refusal::UnknownJob)?;
        if job.state != State::Receiving {
            return Err(Refusal::WrongState);
        }
        let total = job.received.saturating_add(bytes);
        if total > job.declared {
            return Err(Refusal::OverDeclared);
        }
        job.received = total;
        if job.received == job.declared {
            job.state = State::Queued;
        }
        Ok(())
    }

    pub fn start_printing(&mut self, id: u32) -> Result<(), Refusal> {
        let job = self.jobs.get_mut(&id).ok_or(Refusal::UnknownJob)?;
        if job.state != State::Queued {
            return Err(Refusal::WrongState);
        }
        job.state = State::Printing;
        Ok(())
    }

    /// Cancelling is allowed at any point before the job is finished, and a later completion cannot revive it.
    pub fn cancel(&mut self, id: u32) -> Result<(), Refusal> {
        let job = self.jobs.get_mut(&id).ok_or(Refusal::UnknownJob)?;
        match job.state {
            State::Done | State::Cancelled | State::Failed => Err(Refusal::WrongState),
            _ => {
                job.state = State::Cancelled;
                Ok(())
            }
        }
    }

    pub fn finish(&mut self, id: u32, ok: bool) -> Result<(), Refusal> {
        let job = self.jobs.get_mut(&id).ok_or(Refusal::UnknownJob)?;
        if job.state != State::Printing {
            // A job cancelled while the spooler was working stays cancelled.
            return Err(Refusal::WrongState);
        }
        job.state = if ok { State::Done } else { State::Failed };
        Ok(())
    }

    pub fn state(&self, id: u32) -> Option<State> {
        self.jobs.get(&id).map(|job| job.state)
    }

    pub fn printer(&self, id: u32) -> Option<&str> {
        self.jobs.get(&id).map(|job| job.printer.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jobs() -> Jobs {
        Jobs::new(vec!["Office Laser".to_string()], 10 * 1024 * 1024)
    }

    #[test]
    fn a_job_goes_from_receiving_to_done_only_in_order() {
        let mut queue = jobs();
        queue.begin(1, "Office Laser", 100).unwrap();
        queue.receive(1, 60).unwrap();
        assert_eq!(queue.state(1), Some(State::Receiving));
        queue.receive(1, 40).unwrap();
        assert_eq!(queue.state(1), Some(State::Queued));
        assert_eq!(queue.finish(1, true), Err(Refusal::WrongState));
        queue.start_printing(1).unwrap();
        queue.finish(1, true).unwrap();
        assert_eq!(queue.state(1), Some(State::Done));
    }

    #[test]
    fn only_selected_printers_and_bounded_sizes_are_accepted() {
        let mut queue = jobs();
        assert_eq!(
            queue.begin(1, "Unknown Printer", 10),
            Err(Refusal::PrinterNotSelected)
        );
        assert_eq!(queue.begin(2, "Office Laser", 0), Err(Refusal::TooLarge));
        assert_eq!(
            queue.begin(3, "Office Laser", 11 * 1024 * 1024),
            Err(Refusal::TooLarge)
        );
    }

    #[test]
    fn extra_bytes_beyond_the_declared_size_are_refused() {
        let mut queue = jobs();
        queue.begin(1, "Office Laser", 10).unwrap();
        assert_eq!(queue.receive(1, 11), Err(Refusal::OverDeclared));
        assert_eq!(queue.state(1), Some(State::Receiving));
    }

    #[test]
    fn cancel_wins_over_a_late_completion() {
        let mut queue = jobs();
        queue.begin(1, "Office Laser", 5).unwrap();
        queue.receive(1, 5).unwrap();
        queue.start_printing(1).unwrap();
        queue.cancel(1).unwrap();
        assert_eq!(queue.finish(1, true), Err(Refusal::WrongState));
        assert_eq!(queue.state(1), Some(State::Cancelled));
        assert_eq!(queue.cancel(1), Err(Refusal::WrongState));
    }

    #[test]
    fn unknown_jobs_and_reused_ids_are_refused() {
        let mut queue = jobs();
        assert_eq!(queue.receive(9, 1), Err(Refusal::UnknownJob));
        queue.begin(1, "Office Laser", 5).unwrap();
        assert_eq!(queue.begin(1, "Office Laser", 5), Err(Refusal::WrongState));
        assert_eq!(queue.printer(1), Some("Office Laser"));
    }
}
