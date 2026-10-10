//! Keep the interactive helper bounded by the development agent's lifetime.
use std::{io, os::windows::io::AsRawHandle, process::Child};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_BASIC_LIMIT_INFORMATION,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};

pub struct Job(HANDLE);

impl Job {
    pub fn new() -> io::Result<Self> {
        // Unnamed, non-inheritable: the agent owns the only job handle. Windows
        // closes it even on forced termination, which also terminates helpers.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Self(handle);
        let limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
            BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION {
                LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                ..Default::default()
            },
            ..Default::default()
        };
        let ok = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    pub fn assign(&self, child: &Child) -> io::Result<()> {
        // The child is waiting on its grant pipe. Assign before writing any
        // credentials; if the parent exits before assignment, pipe EOF rejects
        // the empty grant. Never enable breakaway to bypass a containing job.
        if unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::Job;
    use std::os::windows::io::AsRawHandle;
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
    };
    use windows_sys::Win32::{
        Foundation::WAIT_OBJECT_0,
        System::Threading::{WaitForSingleObject, CREATE_NO_WINDOW},
    };

    #[test]
    fn closing_agent_job_terminates_its_helper_process() {
        let job = Job::new().expect("create helper job");
        let mut child = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("start bounded process fixture");
        if let Err(error) = job.assign(&child) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("helper job assignment failed: {error}");
        }
        assert!(child.try_wait().expect("query child").is_none());
        drop(job);
        let result = unsafe { WaitForSingleObject(child.as_raw_handle(), 3000) };
        if result != WAIT_OBJECT_0 {
            let _ = child.kill();
        }
        child.wait().expect("reap process fixture");
        assert_eq!(result, WAIT_OBJECT_0, "job close must terminate the helper");
    }
}
