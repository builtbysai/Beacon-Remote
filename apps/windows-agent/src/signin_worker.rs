//! Fixed-purpose sign-in worker and launcher. Media requires its separate scoped
//! authorization and connected peer. The service uses only its own SYSTEM token, never another process's
//! token, and leaves window-station/desktop ACLs and Windows authentication intact.
use crate::{
    availability,
    helper_lifetime::Job,
    signin_endpoint,
    signin_ipc::{SignInChannel, SignInListener, SignInMessage},
    HostError,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use std::{
    os::windows::io::{AsHandle, AsRawHandle, FromRawHandle, OwnedHandle},
    ptr::{null, null_mut},
    sync::Arc,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{
        GetLastError, SetLastError, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    Security::{
        AdjustTokenPrivileges, CreateRestrictedToken, DuplicateTokenEx, LookupPrivilegeValueW,
        SecurityImpersonation, SetTokenInformation, TokenPrimary, TokenSessionId,
        DISABLE_MAX_PRIVILEGE, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED, TOKEN_ADJUST_DEFAULT,
        TOKEN_ADJUST_PRIVILEGES, TOKEN_ADJUST_SESSIONID, TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE,
        TOKEN_PRIVILEGES, TOKEN_QUERY,
    },
    System::{
        RemoteDesktop::{
            ProcessIdToSessionId, WTSActive, WTSConnected, WTSFreeMemory,
            WTSGetActiveConsoleSessionId, WTSQuerySessionInformationW, WTSSessionInfoEx,
            WTSINFOEXW,
        },
        StationsAndDesktops::{
            GetProcessWindowStation, GetThreadDesktop, GetUserObjectInformationW, UOI_IO, UOI_NAME,
        },
        SystemInformation::GetWindowsDirectoryW,
        Threading::{
            CreateProcessAsUserW, DeleteProcThreadAttributeList, GetCurrentProcess,
            GetCurrentThreadId, GetExitCodeProcess, InitializeProcThreadAttributeList, OpenProcess,
            OpenProcessToken, ResumeThread, UpdateProcThreadAttribute, WaitForSingleObject,
            CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, DETACHED_PROCESS,
            EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
            PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
            PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY, PROC_THREAD_ATTRIBUTE_JOB_LIST,
            STARTUPINFOEXW,
        },
    },
};
use zeroize::Zeroizing;

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn owned(handle: HANDLE) -> Result<OwnedHandle, HostError> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}
fn session_id() -> Result<u32, HostError> {
    let mut value = u32::MAX;
    if unsafe { ProcessIdToSessionId(std::process::id(), &mut value) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(value)
}
pub(crate) fn process_session() -> Result<u32, HostError> {
    session_id()
}
fn system() -> Result<(), HostError> {
    if availability::current_sid()? != "S-1-5-18" {
        return Err("The sign-in worker requires its installed SYSTEM identity".into());
    }
    Ok(())
}
/// Whether a console session is showing Windows' sign-in screen: a user session that is locked, or a console
/// that is connected with nobody signed in (a fresh boot, or after sign-out). An unlocked user session is never
/// eligible, even though UAC then also uses the Winlogon desktop.
fn shows_sign_in(state: i32, flags: i32, has_user: bool) -> bool {
    (state == WTSActive && flags == 0) || (state == WTSConnected && !has_user)
}

/// What Windows reports for the console session, as text for the diagnostic log.
pub(crate) fn console_probe() -> String {
    let console = unsafe { WTSGetActiveConsoleSessionId() };
    let mut bytes = null_mut();
    let mut count = 0;
    if unsafe {
        WTSQuerySessionInformationW(
            null_mut(),
            console,
            WTSSessionInfoEx,
            &mut bytes,
            &mut count,
        )
    } == 0
    {
        return format!("console {console} info unavailable");
    }
    let text = if count as usize >= std::mem::size_of::<WTSINFOEXW>() {
        let info = unsafe { &*bytes.cast::<WTSINFOEXW>() };
        if info.Level == 1 {
            let level = unsafe { &info.Data.WTSInfoExLevel1 };
            format!(
                "console {console} state {} flags {} user {} level 1",
                level.SessionState,
                level.SessionFlags,
                level.UserName[0] != 0
            )
        } else {
            format!("console {console} level {}", info.Level)
        }
    } else {
        format!("console {console} short info ({count} bytes)")
    };
    unsafe {
        WTSFreeMemory(bytes.cast());
    }
    text
}

/// The console session while it shows the sign-in screen (see `shows_sign_in`).
pub(crate) fn locked_console() -> Option<u32> {
    let console = unsafe { WTSGetActiveConsoleSessionId() };
    if console == 0 || console == u32::MAX {
        return None;
    }
    let mut bytes = null_mut();
    let mut count = 0;
    if unsafe {
        WTSQuerySessionInformationW(
            null_mut(),
            console,
            WTSSessionInfoEx,
            &mut bytes,
            &mut count,
        )
    } == 0
    {
        return None;
    }
    let locked = if count as usize >= std::mem::size_of::<WTSINFOEXW>() {
        let info = unsafe { &*bytes.cast::<WTSINFOEXW>() };
        info.Level == 1
            && unsafe {
                let level = &info.Data.WTSInfoExLevel1;
                shows_sign_in(
                    level.SessionState,
                    level.SessionFlags,
                    level.UserName[0] != 0,
                )
            }
    } else {
        false
    };
    unsafe {
        WTSFreeMemory(bytes.cast());
    }
    locked.then_some(console)
}
fn object_name(handle: HANDLE) -> Option<String> {
    if handle.is_null() {
        return None;
    }
    let mut bytes = [0u16; 128];
    let mut needed = 0;
    if unsafe {
        GetUserObjectInformationW(
            handle,
            UOI_NAME,
            bytes.as_mut_ptr().cast(),
            std::mem::size_of_val(&bytes) as u32,
            &mut needed,
        )
    } == 0
    {
        return None;
    }
    let count = bytes.iter().position(|&c| c == 0)?;
    String::from_utf16(&bytes[..count]).ok()
}
/// A locked console plus this thread's actual input desktop. UAC on an unlocked
/// user session is deliberately ineligible even if its desktop is also Winlogon.
/// Which part of `on_signin_desktop` last said no (0 when it has not): 1 session, 2 locked console,
/// 3 window station, 4 desktop, 5 input. A failing worker reports it in its exit status.
pub(crate) static DESKTOP_CHECK: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0);

pub(crate) fn on_signin_desktop(console: u32) -> bool {
    let refuse = |reason: u32| {
        DESKTOP_CHECK.store(reason, std::sync::atomic::Ordering::Relaxed);
        false
    };
    if session_id().ok() != Some(console) {
        return refuse(1);
    }
    if locked_console() != Some(console) {
        return refuse(2);
    }
    let station = unsafe { GetProcessWindowStation() };
    let desktop = unsafe { GetThreadDesktop(GetCurrentThreadId()) };
    if !object_name(station).is_some_and(|name| name.eq_ignore_ascii_case("WinSta0")) {
        return refuse(3);
    }
    if !object_name(desktop).is_some_and(|name| name.eq_ignore_ascii_case("Winlogon")) {
        return refuse(4);
    }
    let mut input = 0i32;
    let read = unsafe {
        GetUserObjectInformationW(
            desktop,
            UOI_IO,
            std::ptr::from_mut(&mut input).cast(),
            std::mem::size_of_val(&input) as u32,
            null_mut(),
        ) != 0
    };
    if read && input != 0 {
        true
    } else {
        refuse(5)
    }
}

struct Privilege {
    token: OwnedHandle,
    previous: TOKEN_PRIVILEGES,
}
impl Privilege {
    fn tcb() -> Result<Self, HostError> {
        let mut token = null_mut();
        if unsafe {
            OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_QUERY | TOKEN_ADJUST_PRIVILEGES,
                &mut token,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let token = owned(token)?;
        let mut luid = unsafe { std::mem::zeroed() };
        let name = wide("SeTcbPrivilege");
        if unsafe { LookupPrivilegeValueW(null(), name.as_ptr(), &mut luid) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let enable = TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [LUID_AND_ATTRIBUTES {
                Luid: luid,
                Attributes: SE_PRIVILEGE_ENABLED,
            }],
        };
        let mut previous = TOKEN_PRIVILEGES::default();
        let mut needed = 0;
        unsafe {
            SetLastError(0);
        }
        let ok = unsafe {
            AdjustTokenPrivileges(
                token.as_raw_handle(),
                0,
                &enable,
                std::mem::size_of_val(&previous) as u32,
                &mut previous,
                &mut needed,
            )
        };
        if ok == 0 || unsafe { GetLastError() } != 0 {
            return Err(
                "The installed service does not have the required Windows session privilege".into(),
            );
        }
        Ok(Self { token, previous })
    }
}
impl Drop for Privilege {
    fn drop(&mut self) {
        unsafe {
            AdjustTokenPrivileges(
                self.token.as_raw_handle(),
                0,
                &self.previous,
                0,
                null_mut(),
                null_mut(),
            );
        }
    }
}
fn worker_token(console: u32) -> Result<OwnedHandle, HostError> {
    system()?;
    let mut current = null_mut();
    if unsafe {
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_DUPLICATE | TOKEN_QUERY,
            &mut current,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    let current = owned(current)?;
    let mut copy = null_mut();
    if unsafe {
        DuplicateTokenEx(
            current.as_raw_handle(),
            TOKEN_ASSIGN_PRIMARY
                | TOKEN_DUPLICATE
                | TOKEN_QUERY
                | TOKEN_ADJUST_SESSIONID
                | TOKEN_ADJUST_DEFAULT,
            null(),
            SecurityImpersonation,
            TokenPrimary,
            &mut copy,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    let copy = owned(copy)?;
    let _privilege = Privilege::tcb()?;
    if unsafe {
        SetTokenInformation(
            copy.as_raw_handle(),
            TokenSessionId,
            std::ptr::from_ref(&console).cast(),
            std::mem::size_of_val(&console) as u32,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut restricted = null_mut();
    // No SANDBOX_INERT flag, borrowed login token or privilege addition. The
    // worker retains SYSTEM's existing desktop rights with privileges removed.
    if unsafe {
        CreateRestrictedToken(
            copy.as_raw_handle(),
            DISABLE_MAX_PRIVILEGE,
            0,
            null(),
            0,
            null(),
            0,
            null(),
            &mut restricted,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    owned(restricted)
}
struct Attributes {
    list: Vec<usize>,
    jobs: Box<[HANDLE; 1]>,
    policy: Box<u32>,
}
impl Attributes {
    fn new(job: &Job) -> Result<Self, HostError> {
        let mut bytes = 0;
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut bytes);
        }
        if bytes == 0 || bytes > 65536 {
            return Err("Invalid worker creation attributes".into());
        }
        let mut list = vec![0usize; bytes.div_ceil(std::mem::size_of::<usize>())];
        let ptr = list.as_mut_ptr().cast();
        if unsafe { InitializeProcThreadAttributeList(ptr, 2, 0, &mut bytes) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let mut attributes = Self {
            list,
            jobs: Box::new([job.handle().as_raw_handle()]),
            policy: Box::new(1),
        };
        let ptr = attributes.ptr();
        if unsafe {
            UpdateProcThreadAttribute(
                ptr,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                attributes.jobs.as_ptr().cast(),
                std::mem::size_of::<HANDLE>(),
                null_mut(),
                null(),
            )
        } == 0
            || unsafe {
                UpdateProcThreadAttribute(
                    ptr,
                    0,
                    PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY as usize,
                    std::ptr::from_ref(attributes.policy.as_ref()).cast(),
                    std::mem::size_of::<u32>(),
                    null_mut(),
                    null(),
                )
            } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(attributes)
    }
    fn ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.list.as_mut_ptr().cast()
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.ptr());
        }
    }
}
fn windows_directory() -> Result<String, HostError> {
    let mut path = [0u16; 512];
    let count = unsafe { GetWindowsDirectoryW(path.as_mut_ptr(), path.len() as u32) } as usize;
    if count == 0 || count >= path.len() {
        return Err("Cannot determine the Windows directory".into());
    }
    Ok(String::from_utf16(&path[..count])?)
}

#[derive(Default)]
struct LocalDisable {
    since: Option<Instant>,
    clean: bool,
}
impl LocalDisable {
    fn observe(&mut self, clean: bool, now: Instant) -> Result<(), HostError> {
        if self.clean && !clean {
            return Err("Sign-in cleanup confirmation changed".into());
        }
        self.since.get_or_insert(now);
        self.clean = clean;
        Ok(())
    }
    fn requested(&self) -> bool {
        self.since.is_some()
    }
    fn retain_ui(&self, now: Instant) -> bool {
        self.clean
            || self
                .since
                .is_some_and(|since| now.saturating_duration_since(since) < Duration::from_secs(4))
    }
}
fn fresh_ready(observed: Option<Instant>, now: Instant) -> bool {
    observed
        .and_then(|observed| now.checked_duration_since(observed))
        .is_some_and(|age| age < Duration::from_secs(1))
}
pub(crate) struct Worker {
    process: OwnedHandle,
    token: OwnedHandle,
    job: Option<Job>,
    channel: Option<SignInChannel>,
    pub instance: String,
    pub console: u32,
    public_key: String,
    lease: Option<String>,
    local_disable: LocalDisable,
    attention: Option<(String, u64, u64)>,
    attention_sequence: u64,
    lease_deadline: u64,
    revoke: Arc<crate::signin_revoke::LocalRevoke>,
    retired: bool,
    retirement_confirmed: bool,
    last_ready: Option<Instant>,
}
pub(crate) struct RetiredLease {
    pub lease: String,
    pub instance: String,
    pub console: u32,
    pub deadline: u64,
}
impl Worker {
    /// Fresh private worker/desktop readiness, not positive GPU/input acceptance.
    /// The build gate is separate from local owner opt-in and backend rollout.
    /// How the worker process ended, if it has: its exit status (see `run_as_process`).
    pub(crate) fn exit_status(&self) -> Option<u32> {
        let mut code = 0u32;
        let known = unsafe { GetExitCodeProcess(self.process.as_raw_handle(), &mut code) } != 0;
        (known && code != 259).then_some(code)
    }
    pub(crate) fn media_ready(&self) -> bool {
        cfg!(feature = "signin-media")
            && fresh_ready(self.last_ready, Instant::now())
            && !self.retired
            && !self.disable_requested()
            && !self.revoke.requested()
            && self.channel.is_some()
            && locked_console() == Some(self.console)
            && unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) } == WAIT_TIMEOUT
    }
    pub(crate) fn retire_for_handoff(&mut self) -> Option<RetiredLease> {
        if self.retired || self.disable_requested() || self.revoke.requested() {
            return None;
        }
        let lease = self.lease.clone()?;
        let candidate = RetiredLease {
            lease,
            instance: self.instance.clone(),
            console: self.console,
            deadline: self.lease_deadline,
        };
        if crate::signin_scope::tick() >= candidate.deadline
            || !self.retire()
            || self.disable_requested()
            || self.revoke.requested()
            || crate::signin_scope::tick() >= candidate.deadline
        {
            return None;
        }
        Some(candidate)
    }
    pub(crate) fn has_lease(&self) -> bool {
        self.lease.is_some()
    }
    pub(crate) fn attention_pending(&self) -> bool {
        self.attention.is_some()
    }
    pub(crate) fn disable_requested(&self) -> bool {
        self.local_disable.requested()
    }
    pub(crate) fn cleanup_confirmed(&self) -> bool {
        self.local_disable.requested() && self.local_disable.clean
    }
    pub(crate) fn retain_disabled_ui(&self) -> bool {
        self.local_disable.retain_ui(Instant::now())
    }
    pub fn public_key(&self) -> &str {
        &self.public_key
    }
    pub fn start(
        machine: &str,
        revoke: Arc<crate::signin_revoke::LocalRevoke>,
    ) -> Result<Self, HostError> {
        system()?;
        if session_id()? != 0 {
            return Err("Only the Session 0 sign-in supervisor may launch this worker".into());
        }
        let console = locked_console().ok_or("No locked active console is available")?;
        let executable = std::env::current_exe()?;
        signin_endpoint::validate_binary(machine, &executable)?;
        let listener = SignInListener::create()?;
        let token = worker_token(console)?;
        let job = Job::new()?;
        let mut attributes = Attributes::new(&job)?;
        let instance = uuid::Uuid::new_v4().to_string();
        let executable_wide = wide(&executable.to_string_lossy());
        let mut command = wide(&format!(
            "\"{}\" signin-worker {machine} {console} {} {instance} {}",
            executable.to_string_lossy(),
            std::process::id(),
            listener.name()
        ));
        let mut desktop = wide("winsta0\\Winlogon");
        let windows = windows_directory()?;
        // The worker's token cannot always resolve these two folders itself; it falls back to what the
        // supervisor resolved (and verifies the folder's permissions and the binary hash regardless).
        let program_files =
            availability::known_folder(&windows_sys::Win32::UI::Shell::FOLDERID_ProgramFiles)?;
        let program_data =
            availability::known_folder(&windows_sys::Win32::UI::Shell::FOLDERID_ProgramData)?;
        let environment: Vec<u16> = format!(
            "SystemRoot={windows}\0WINDIR={windows}\0ProgramFiles={}\0ProgramData={}\0\0",
            program_files.display(),
            program_data.display()
        )
        .encode_utf16()
        .collect();
        let directory = wide(
            &executable
                .parent()
                .ok_or("Missing installed worker folder")?
                .to_string_lossy(),
        );
        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = std::mem::size_of_val(&startup) as u32;
        startup.StartupInfo.lpDesktop = desktop.as_mut_ptr();
        startup.lpAttributeList = attributes.ptr();
        let mut info = PROCESS_INFORMATION::default();
        // The job is attached by the kernel at creation, before any thread can
        // run. No inherited handles or create/assign orphan window is permitted.
        if unsafe {
            CreateProcessAsUserW(
                token.as_raw_handle(),
                executable_wide.as_ptr(),
                command.as_mut_ptr(),
                null(),
                null(),
                0,
                // Detached: the worker needs no console, and a hidden console host cannot start in a job
                // that forbids child processes (the worker then fails to initialise, status 0xC0000142).
                CREATE_SUSPENDED
                    | DETACHED_PROCESS
                    | CREATE_UNICODE_ENVIRONMENT
                    | EXTENDED_STARTUPINFO_PRESENT,
                environment.as_ptr().cast(),
                directory.as_ptr(),
                &startup.StartupInfo,
                &mut info,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let process = owned(info.hProcess)?;
        let thread = owned(info.hThread)?;
        let mut worker = Self {
            process,
            token,
            job: Some(job),
            channel: None,
            instance,
            console,
            lease: None,
            public_key: String::new(),
            local_disable: LocalDisable::default(),
            attention: None,
            attention_sequence: 0,
            lease_deadline: 0,
            revoke,
            retired: false,
            retirement_confirmed: false,
            last_ready: None,
        };
        if unsafe { ResumeThread(thread.as_raw_handle()) } == u32::MAX {
            return Err(std::io::Error::last_os_error().into());
        }
        let mut channel =
            match listener.accept(worker.process.as_handle(), console, Duration::from_secs(2)) {
                Ok(channel) => channel,
                Err(error) => {
                    // A worker that never connects is almost always one that already ended: say how.
                    let mut code = 0u32;
                    let known =
                        unsafe { GetExitCodeProcess(worker.process.as_raw_handle(), &mut code) }
                            != 0;
                    signin_endpoint::diag(
                        machine,
                        &format!(
                            "worker did not connect: {error}; {}",
                            if !known {
                                "exit status unknown".to_owned()
                            } else if code == 259 {
                                "process still running".to_owned()
                            } else {
                                format!("process ended with status {code:#010x}")
                            }
                        ),
                    );
                    return Err(error.into());
                }
            };
        let ready = channel.receive(Duration::from_secs(2))?;
        let SignInMessage::Ready {
            instance_id,
            console_session_id,
            challenge,
            worker_public_key,
        } = ready
        else {
            return Err("Unexpected sign-in worker handshake".into());
        };
        if instance_id != worker.instance
            || console_session_id != console
            || challenge != worker.instance
        {
            return Err("Unexpected sign-in worker handshake".into());
        }
        worker.public_key = worker_public_key;
        worker.channel = Some(channel);
        worker.last_ready = Some(Instant::now());
        Ok(worker)
    }
    pub fn probe(&mut self) -> Result<(), HostError> {
        // A failed/mismatched/timed-out probe can never leave an old Ready live.
        self.last_ready = None;
        if locked_console() != Some(self.console)
            || unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) } != WAIT_TIMEOUT
        {
            return Err("The worker's console or process changed".into());
        }
        let channel = self
            .channel
            .as_mut()
            .ok_or("Sign-in worker channel is closed")?;
        let nonce = uuid::Uuid::new_v4().to_string();
        channel.send(
            &SignInMessage::Probe {
                challenge: nonce.clone(),
            },
            Duration::from_millis(500),
        )?;
        let reply = channel.receive(Duration::from_millis(500))?;
        match reply {
            SignInMessage::Draining {
                instance_id,
                console_session_id,
                challenge,
                worker_public_key,
            } if instance_id == self.instance
                && console_session_id == self.console
                && challenge == nonce
                && worker_public_key == self.public_key =>
            {
                return Err("The sign-in worker is draining".into());
            }
            SignInMessage::SecureAttention {
                instance_id,
                console_session_id,
                challenge,
                worker_public_key,
                lease_id,
                sequence,
                expires_at_tick,
            } if !self.disable_requested()
                && instance_id == self.instance
                && console_session_id == self.console
                && challenge == nonce
                && worker_public_key == self.public_key
                && self.lease.as_ref() == Some(&lease_id)
                && sequence > self.attention_sequence
                && self.attention.is_none()
                && expires_at_tick <= self.lease_deadline =>
            {
                self.attention_sequence = sequence;
                self.attention = Some((lease_id, sequence, expires_at_tick));
                self.last_ready = Some(Instant::now());
            }
            SignInMessage::Ready {
                instance_id,
                console_session_id,
                challenge,
                worker_public_key,
            } if !self.disable_requested()
                && instance_id == self.instance
                && console_session_id == self.console
                && challenge == nonce
                && worker_public_key == self.public_key =>
            {
                self.last_ready = Some(Instant::now());
            }
            SignInMessage::LocalDisable {
                instance_id,
                console_session_id,
                challenge,
                worker_public_key,
                cleanup_confirmed,
            } if instance_id == self.instance
                && console_session_id == self.console
                && challenge == nonce
                && worker_public_key == self.public_key =>
            {
                self.local_disable
                    .observe(cleanup_confirmed, Instant::now())?
            }
            _ => return Err("The sign-in desktop is no longer available".into()),
        }
        Ok(())
    }
    pub fn refresh_lease(
        &mut self,
        http: &reqwest::blocking::Client,
        server: &reqwest::Url,
        key: &ed25519_dalek::SigningKey,
        machine: &str,
        allowed: impl Fn() -> bool,
    ) -> Result<(), HostError> {
        if !allowed() {
            return Err("Sign-in authority ended".into());
        }
        // Probe between bounded network requests: neither HTTP nor IPC arrival
        // starts a new lease clock, and an idle worker retains no media grant.
        self.probe()?;
        if self.disable_requested() {
            return Err("Sign-in was locally disabled".into());
        }
        let client = crate::signin_lease::LeaseClient {
            http,
            server,
            key,
            machine,
            instance: &self.instance,
            console: self.console,
        };
        let lease = client.discover()?;
        if !allowed() {
            return Err("Sign-in authority ended".into());
        }
        let Some(lease) = lease else {
            return if self.lease.is_none() {
                Ok(())
            } else {
                Err("Sign-in lease ended".into())
            };
        };
        if self.lease.as_ref().is_some_and(|active| active != &lease) {
            return Err("A new sign-in lease requires a fresh worker".into());
        }
        self.probe()?;
        if self.disable_requested() {
            return Err("Sign-in was locally disabled".into());
        }
        let authorization = crate::signin_lease::LeaseClient {
            http,
            server,
            key,
            machine,
            instance: &self.instance,
            console: self.console,
        }
        .authorize(&lease)?;
        if !allowed() || locked_console() != Some(self.console) {
            return Err("Sign-in authority ended".into());
        }
        self.channel
            .as_mut()
            .ok_or("Sign-in worker channel is closed")?
            .send(&authorization, Duration::from_millis(500))?;
        let SignInMessage::Authorization {
            expires_at_tick, ..
        } = &authorization
        else {
            return Err("Invalid sign-in authorization".into());
        };
        self.lease_deadline = *expires_at_tick;
        self.lease = Some(lease);
        // Ordered IPC requires the worker to accept authorization before it can
        // answer this new challenge. It does not establish a connected peer.
        self.probe()?;
        if self.disable_requested() {
            return Err("Sign-in was locally disabled".into());
        }
        if let Some((lease, sequence, deadline)) = self.attention.take() {
            // Only after a fresh backend authorization, and check local revoke,
            // console and absolute expiry again immediately before Windows SAS.
            let outcome = crate::signin_attention::request(
                self.token.as_handle(),
                self.console,
                deadline.min(self.lease_deadline),
                || {
                    allowed()
                        && !self.disable_requested()
                        && self.lease.as_ref() == Some(&lease)
                        && unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) }
                            == WAIT_TIMEOUT
                },
            );
            self.channel
                .as_mut()
                .ok_or("Sign-in worker channel is closed")?
                .send(
                    &SignInMessage::AttentionResult {
                        lease_id: lease,
                        sequence,
                        outcome,
                    },
                    Duration::from_millis(500),
                )?;
        }
        Ok(())
    }
}
impl Worker {
    /// Proves retirement only, never Windows unlock or ordinary permission.
    /// Repeated calls cannot turn incomplete cleanup into positive evidence.
    pub(crate) fn retire(&mut self) -> bool {
        if self.retired {
            return self.retirement_confirmed;
        }
        self.retired = true;
        let until = Instant::now() + Duration::from_millis(4250);
        let challenge = uuid::Uuid::new_v4().to_string();
        let mut acknowledged = false;
        if let Some(channel) = &mut self.channel {
            if channel
                .send(
                    &SignInMessage::Retire {
                        challenge: challenge.clone(),
                    },
                    Duration::from_millis(250),
                )
                .is_ok()
            {
                let remaining = until.saturating_duration_since(Instant::now());
                if !remaining.is_zero() {
                    if let Ok(SignInMessage::Retired {
                        instance_id,
                        console_session_id,
                        challenge: echo,
                        worker_public_key,
                        cleanup_confirmed,
                        indicator_closed,
                        locally_disabled,
                    }) = channel.receive(remaining)
                    {
                        if instance_id == self.instance
                            && console_session_id == self.console
                            && echo == challenge
                            && worker_public_key == self.public_key
                        {
                            if locally_disabled {
                                self.revoke.request();
                                let _ = self
                                    .local_disable
                                    .observe(cleanup_confirmed, Instant::now());
                            }
                            acknowledged = cleanup_confirmed && indicator_closed;
                        }
                    }
                }
            }
        }
        if self.disable_requested() {
            self.revoke.request();
        }
        let remaining = until
            .saturating_duration_since(Instant::now())
            .as_millis()
            .min(u32::MAX as u128) as u32;
        let natural = unsafe { WaitForSingleObject(self.process.as_raw_handle(), remaining) }
            == WAIT_OBJECT_0;
        // Only our kill job is closed. A forced or late exit is never evidence
        // of successful cleanup even when the process eventually terminates.
        self.job.take();
        unsafe {
            WaitForSingleObject(self.process.as_raw_handle(), 1000);
        }
        let mut exit = 1;
        self.retirement_confirmed = acknowledged
            && natural
            && unsafe { GetExitCodeProcess(self.process.as_raw_handle(), &mut exit) } != 0
            && exit == 0;
        self.retirement_confirmed
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.retire();
    }
}

fn observe_disable(
    indicator: &crate::signin_indicator::Indicator,
    scope: &crate::signin_scope::ScopeOwner,
    media: &mut Option<crate::signin_media::SignInMedia>,
    cleanup_confirmed: &mut bool,
) -> bool {
    if !indicator.disable_requested() {
        return false;
    }
    if let Some(scope) = &scope.0 {
        scope.stop();
    }
    if let Some(active) = media {
        *cleanup_confirmed = false;
        if let Some(confirmed) = active.poll_cleanup() {
            *cleanup_confirmed = confirmed;
            media.take();
        }
    }
    true
}
fn begin_draining(
    draining: &mut Option<Instant>,
    scope: &crate::signin_scope::ScopeOwner,
    media: &mut Option<crate::signin_media::SignInMedia>,
    cleanup_confirmed: &mut bool,
) {
    draining.get_or_insert_with(Instant::now);
    if let Some(scope) = &scope.0 {
        scope.stop();
    }
    if let Some(active) = media {
        *cleanup_confirmed = false;
        if let Some(clean) = active.poll_cleanup() {
            *cleanup_confirmed = clean;
            media.take();
        }
    }
}
fn observe_draining(
    draining: &mut Option<Instant>,
    indicator: &crate::signin_indicator::Indicator,
    scope: &crate::signin_scope::ScopeOwner,
    media: &mut Option<crate::signin_media::SignInMedia>,
    cleanup_confirmed: &mut bool,
    console: u32,
    locally_disabled: bool,
) {
    if draining.is_none() {
        // Say which condition ended this, once: a worker that drains with no reason is hard to diagnose.
        let reason = if indicator.closed() {
            Some("the Disable window closed".to_owned())
        } else if !on_signin_desktop(console) {
            Some(format!(
                "this is no longer the sign-in desktop (check {})",
                DESKTOP_CHECK.load(std::sync::atomic::Ordering::Relaxed)
            ))
        } else if locally_disabled {
            None
        } else if indicator.stop_requested() {
            Some("Stop was requested".to_owned())
        } else if media.as_ref().is_some_and(|media| media.ended()) {
            Some("the media runner ended".to_owned())
        } else if scope.0.as_ref().is_some_and(|scope| scope.expired()) {
            Some("the authorization expired".to_owned())
        } else {
            None
        };
        if let Some(reason) = reason {
            trace(&format!("draining because {reason}"));
            draining.get_or_insert_with(Instant::now);
        }
    }
    if draining.is_some() {
        begin_draining(draining, scope, media, cleanup_confirmed);
    }
}
/// How far the worker got (see `run_as_process`).
static STAGE: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

pub(crate) fn run(arguments: &[String]) -> Result<(), HostError> {
    let result = run_worker(arguments);
    if let (Err(error), Some(machine)) = (&result, arguments.get(2)) {
        signin_endpoint::diag(machine, &format!("worker stopped: {error}"));
    }
    result
}

/// The worker process's entry point. A failing worker cannot always write the supervisor's log from inside its
/// restricted token, so it also reports how it failed through its exit status for the supervisor to read.
pub(crate) fn run_as_process(arguments: &[String]) -> Result<(), HostError> {
    let result = run(arguments);
    if let Err(error) = &result {
        use std::sync::atomic::Ordering::Relaxed;
        let folder = availability::LAST_FOLDER_RESULT.load(Relaxed);
        if folder != 0 {
            // A failed folder lookup is reported as its own Windows result (high bit set).
            std::process::exit(folder as i32);
        }
        // Windows error number (high 16 bits), the last binary-check step, then the stage reached.
        let desktop = DESKTOP_CHECK.load(Relaxed);
        let os_error = if desktop != 0 {
            // Which part of the sign-in desktop check refused.
            desktop
        } else {
            error
                .downcast_ref::<std::io::Error>()
                .and_then(std::io::Error::raw_os_error)
                .unwrap_or(0) as u32
                & 0xffff
        };
        let check = signin_endpoint::VALIDATE_STEP.load(Relaxed) & 0xff;
        let stage = STAGE.load(Relaxed) & 0xff;
        let status = (os_error << 16) | (check << 8) | stage;
        // 259 (STILL_ACTIVE) would read as a running worker.
        std::process::exit(if status == 259 { 260 } else { status } as i32);
    }
    result
}

/// Counts a silent checkpoint toward the stage reported in the exit status.
fn mark() {
    STAGE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}

static WORKER_MACHINE: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// A diagnostic line from anywhere inside the worker process (states and errors only, never content).
pub(crate) fn trace(text: &str) {
    if let Some(machine) = WORKER_MACHINE.get() {
        signin_endpoint::diag(machine, &format!("worker: {text}"));
    }
}

/// A diagnostic line that does not count as a stage.
fn note(machine: &str, text: &str) {
    signin_endpoint::diag(machine, &format!("worker: {text}"));
}

/// Records how far the worker got, in the supervisor's protected log. Steps only, never any content.
fn step(machine: &str, name: &str) {
    STAGE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    signin_endpoint::diag(machine, &format!("worker step: {name}"));
}

fn run_worker(arguments: &[String]) -> Result<(), HostError> {
    if arguments.len() != 7 {
        return Err("Invalid sign-in worker invocation".into());
    }
    system()?;
    step(&arguments[2], "started as SYSTEM");
    let machine = &arguments[2];
    let _ = WORKER_MACHINE.set(machine.clone());
    let console = arguments[3].parse::<u32>()?;
    mark();
    let service_id = arguments[4].parse::<u32>()?;
    mark();
    let instance = &arguments[5];
    let nil = uuid::Uuid::parse_str(instance)?.is_nil();
    mark();
    if nil || service_id == 0 || console == 0 || console == u32::MAX {
        return Err("Invalid sign-in worker scope".into());
    }
    mark();
    let executable = std::env::current_exe()?;
    mark();
    signin_endpoint::validate_binary(machine, &executable)?;
    step(machine, "binary validated");
    if !on_signin_desktop(console) {
        return Err("The worker is not on the active Windows sign-in desktop".into());
    }
    step(machine, "on the sign-in desktop");
    let service = owned(unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            service_id,
        )
    })?;
    let mut channel = SignInChannel::connect(&arguments[6], service.as_handle(), console)?;
    step(machine, "channel connected");
    let mut indicator = crate::signin_indicator::Indicator::show(machine, console)?;
    step(machine, "Disable window shown");
    if cfg!(feature = "signin-media") {
        // Inspect only topology/capability. No duplication, frame acquisition,
        // encoder or input adapter starts before a live authenticated peer.
        crate::signin_capture::preflight(console)?;
        step(machine, "capture preflight passed");
    }
    // Ephemeral private material stays inside this scoped worker until teardown.
    // Only its public key crosses the authenticated private lifecycle channel.
    let worker_key = Zeroizing::new(SigningKey::generate(&mut rand::rng()).to_bytes());
    let public_key = STANDARD.encode(
        SigningKey::from_bytes(&worker_key)
            .verifying_key()
            .as_bytes(),
    );
    let mut worker_key = Some(worker_key);
    let mut scope = crate::signin_scope::ScopeOwner(None);
    let mut media: Option<crate::signin_media::SignInMedia> = None;
    let mut locally_disabled = false;
    let mut cleanup_confirmed = true;
    let mut draining = None;
    channel.send(
        &SignInMessage::Ready {
            instance_id: instance.clone(),
            console_session_id: console,
            challenge: instance.clone(),
            worker_public_key: public_key.clone(),
        },
        Duration::from_millis(500),
    )?;
    loop {
        locally_disabled |= observe_disable(&indicator, &scope, &mut media, &mut cleanup_confirmed);
        observe_draining(
            &mut draining,
            &indicator,
            &scope,
            &mut media,
            &mut cleanup_confirmed,
            console,
            locally_disabled,
        );
        if draining.is_some_and(|since: Instant| since.elapsed() >= Duration::from_secs(4))
            || unsafe { WaitForSingleObject(service.as_raw_handle(), 0) } != WAIT_TIMEOUT
        {
            return Ok(());
        }
        // The supervisor may be inside its bounded three-second heartbeat.
        // This is only lifecycle liveness, never a media authorization timer.
        let wait = draining.map_or(Duration::from_secs(5), |since| {
            Duration::from_secs(4).saturating_sub(since.elapsed())
        });
        if wait.is_zero() {
            return Ok(());
        }
        let message = channel.receive(wait)?;
        // Disable can arrive while waiting for a Probe/Authorization or during
        // the UI's controller acknowledgement. It must not look like a crash.
        locally_disabled |= observe_disable(&indicator, &scope, &mut media, &mut cleanup_confirmed);
        observe_draining(
            &mut draining,
            &indicator,
            &scope,
            &mut media,
            &mut cleanup_confirmed,
            console,
            locally_disabled,
        );
        let result = (|| -> Result<bool, HostError> {
            match message {
                SignInMessage::Probe { challenge } => {
                    let reply = if locally_disabled {
                        SignInMessage::LocalDisable {
                            instance_id: instance.clone(),
                            console_session_id: console,
                            challenge,
                            worker_public_key: public_key.clone(),
                            cleanup_confirmed,
                        }
                    } else if draining.is_some() {
                        SignInMessage::Draining {
                            instance_id: instance.clone(),
                            console_session_id: console,
                            challenge,
                            worker_public_key: public_key.clone(),
                        }
                    } else if let Some(active) = &scope.0 {
                        if let Some(request) = active.attention.take(crate::signin_scope::tick()) {
                            active.authorize()?;
                            let (lease, _, _) = active.signaling_binding()?;
                            SignInMessage::SecureAttention {
                                instance_id: instance.clone(),
                                console_session_id: console,
                                challenge,
                                worker_public_key: public_key.clone(),
                                lease_id: lease,
                                sequence: request.sequence,
                                expires_at_tick: request.deadline,
                            }
                        } else {
                            SignInMessage::Ready {
                                instance_id: instance.clone(),
                                console_session_id: console,
                                challenge,
                                worker_public_key: public_key.clone(),
                            }
                        }
                    } else {
                        SignInMessage::Ready {
                            instance_id: instance.clone(),
                            console_session_id: console,
                            challenge,
                            worker_public_key: public_key.clone(),
                        }
                    };
                    channel.send(&reply, Duration::from_millis(500))?;
                }
                SignInMessage::Retire { challenge } => {
                    if let Some(scope) = &scope.0 {
                        scope.stop();
                    }
                    if let Some(active) = media.as_mut() {
                        cleanup_confirmed = active.stop_and_cleanup();
                    }
                    // Freeze and join the UI before sampling its final Disable
                    // bit. An unfinished UI cannot produce positive retirement.
                    let indicator_closed = indicator.finish();
                    locally_disabled |= indicator.disable_requested();
                    channel.send(
                        &SignInMessage::Retired {
                            instance_id: instance.clone(),
                            console_session_id: console,
                            challenge,
                            worker_public_key: public_key.clone(),
                            cleanup_confirmed,
                            indicator_closed,
                            locally_disabled,
                        },
                        Duration::from_millis(250),
                    )?;
                    return Ok(true);
                }
                SignInMessage::Stop {} => {
                    if let Some(scope) = &scope.0 {
                        scope.stop();
                    }
                    if media
                        .as_mut()
                        .map_or(cleanup_confirmed, |media| media.stop_and_cleanup())
                    {
                        let _ =
                            channel.send(&SignInMessage::Stopped {}, Duration::from_millis(250));
                    }
                    return Ok(true);
                }
                SignInMessage::AttentionResult {
                    lease_id,
                    sequence,
                    outcome,
                } => {
                    if locally_disabled || draining.is_some() {
                        return Ok(false);
                    }
                    let active = scope.0.as_ref().ok_or("Missing sign-in attention scope")?;
                    let (lease, _, _) = active.signaling_binding()?;
                    if lease != lease_id {
                        return Err("Sign-in attention scope changed".into());
                    }
                    active.authorize()?;
                    active
                        .attention
                        .finish(sequence, outcome, crate::signin_scope::tick())?;
                }
                SignInMessage::Authorization {
                    lease_id,
                    instance_id,
                    console_session_id,
                    expires_at_tick,
                    controller,
                } => {
                    if !cfg!(feature = "signin-media") {
                        return Err("Sign-in media is not enabled in this build".into());
                    }
                    if locally_disabled || draining.is_some() {
                        return Ok(false);
                    }
                    if instance_id != *instance
                        || console_session_id != console
                        || indicator.stop_requested()
                    {
                        return Err("Sign-in scope mismatch".into());
                    }
                    // Show the authorized owner before creating or renewing usable
                    // authority. UI failure/timeout permanently latches local Stop.
                    STAGE.store(20, std::sync::atomic::Ordering::Relaxed);
                    note(machine, "authorization received");
                    indicator.authorize(&controller)?;
                    note(machine, "owner shown on the Disable window");
                    STAGE.store(21, std::sync::atomic::Ordering::Relaxed);
                    if let Some(active) = &scope.0 {
                        active.renew(&lease_id, instance, console, expires_at_tick)?;
                    } else {
                        scope.0 = Some(crate::signin_scope::SignInScope::new(
                            lease_id,
                            instance.clone(),
                            console,
                            expires_at_tick,
                            indicator.stop_signal(),
                        )?);
                        note(machine, "scope created");
                        STAGE.store(22, std::sync::atomic::Ordering::Relaxed);
                        let signaling = crate::signin_signaling::SignInSignaling::start(
                            machine,
                            scope.0.as_ref().ok_or("Missing sign-in scope")?.clone(),
                            worker_key
                                .take()
                                .ok_or("The worker signer was already consumed")?,
                        )?;
                        note(machine, "signaling started");
                        STAGE.store(23, std::sync::atomic::Ordering::Relaxed);
                        media = Some(crate::signin_media::SignInMedia::start(
                            signaling,
                            scope.0.as_ref().ok_or("Missing sign-in scope")?.clone(),
                        )?);
                    }
                    note(machine, "media runner started");
                    // The media runner negotiates here; its capture/input adapters
                    // still require the actual authenticated peer-connected gate.
                }
                _ => {
                    if indicator.stop_requested() {
                        return Ok(true);
                    }
                    return Err("Unexpected sign-in lifecycle message".into());
                }
            }
            Ok(false)
        })();
        match result {
            Ok(true) => return Ok(()),
            Ok(false) => {}
            Err(_) if indicator.disable_requested() && !indicator.closed() => continue,
            Err(error) => return Err(error),
        }
    }
}

/// Right after a lock, Windows shows the lock-screen picture (LockApp) on the session's Default desktop; the
/// password prompt, where the worker runs, appears on the Winlogon desktop only after a key press or click. VNC
/// services and the commercial remote-support tools follow whichever desktop has the input; Beacon keeps the
/// worker on Winlogon only and instead raises the prompt when a viewer asks: one short-lived SYSTEM helper in the
/// console session presses and releases Ctrl on the lock-screen picture. It never types, never touches an
/// unlocked desktop and never runs unless the console is locked and the picture is what has the input.
pub(crate) fn wake_prompt(machine: &str, console: u32) -> Result<(), HostError> {
    system()?;
    if session_id()? != 0 {
        return Err("Only the Session 0 sign-in supervisor may raise the prompt".into());
    }
    if locked_console() != Some(console) {
        return Err("The console is not locked".into());
    }
    let executable = std::env::current_exe()?;
    signin_endpoint::validate_binary(machine, &executable)?;
    let token = worker_token(console)?;
    let job = Job::new()?;
    let mut attributes = Attributes::new(&job)?;
    let executable_wide = wide(&executable.to_string_lossy());
    let mut command = wide(&format!(
        "\"{}\" signin-wake {machine} {console}",
        executable.to_string_lossy()
    ));
    let mut desktop = wide("winsta0\\Default");
    let windows = windows_directory()?;
    let program_files =
        availability::known_folder(&windows_sys::Win32::UI::Shell::FOLDERID_ProgramFiles)?;
    let program_data =
        availability::known_folder(&windows_sys::Win32::UI::Shell::FOLDERID_ProgramData)?;
    let environment: Vec<u16> = format!(
        "SystemRoot={windows}\0WINDIR={windows}\0ProgramFiles={}\0ProgramData={}\0\0",
        program_files.display(),
        program_data.display()
    )
    .encode_utf16()
    .collect();
    let directory = wide(
        &executable
            .parent()
            .ok_or("Missing installed worker folder")?
            .to_string_lossy(),
    );
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = std::mem::size_of_val(&startup) as u32;
    startup.StartupInfo.lpDesktop = desktop.as_mut_ptr();
    startup.lpAttributeList = attributes.ptr();
    let mut info = PROCESS_INFORMATION::default();
    if unsafe {
        CreateProcessAsUserW(
            token.as_raw_handle(),
            executable_wide.as_ptr(),
            command.as_mut_ptr(),
            null(),
            null(),
            0,
            CREATE_SUSPENDED
                | DETACHED_PROCESS
                | CREATE_UNICODE_ENVIRONMENT
                | EXTENDED_STARTUPINFO_PRESENT,
            environment.as_ptr().cast(),
            directory.as_ptr(),
            &startup.StartupInfo,
            &mut info,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    let process = owned(info.hProcess)?;
    let thread = owned(info.hThread)?;
    if unsafe { ResumeThread(thread.as_raw_handle()) } == u32::MAX {
        return Err(std::io::Error::last_os_error().into());
    }
    // Dropping the job ends the helper if it has not finished in time.
    if unsafe { WaitForSingleObject(process.as_raw_handle(), 5_000) } != WAIT_OBJECT_0 {
        return Err("The prompt helper did not finish".into());
    }
    let mut code = 0u32;
    if unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut code) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    drop(job);
    match code {
        0 => Ok(()),
        code => Err(format!("The prompt helper ended with status {code:#010x}").into()),
    }
}

/// What the prompt helper does on the desktop that has the input.
#[derive(Debug, PartialEq, Eq)]
enum WakeTarget {
    /// The lock-screen picture: press Ctrl.
    Picture,
    /// The password prompt is already up: nothing to do.
    Prompt,
    /// Anything else (a screen saver, a desktop it cannot name): do nothing and say so.
    Other,
}
fn wake_target(input_desktop: Option<&str>) -> WakeTarget {
    match input_desktop {
        Some(name) if name.eq_ignore_ascii_case("Default") => WakeTarget::Picture,
        Some(name) if name.eq_ignore_ascii_case("Winlogon") => WakeTarget::Prompt,
        _ => WakeTarget::Other,
    }
}

/// `beacon-remote-agent signin-wake <machine> <console>`, started only by `wake_prompt`.
pub(crate) fn run_wake(arguments: &[String]) -> Result<(), HostError> {
    use windows_sys::Win32::System::StationsAndDesktops::{
        CloseDesktop, OpenInputDesktop, SetThreadDesktop, DESKTOP_JOURNALPLAYBACK,
        DESKTOP_READOBJECTS, DESKTOP_WRITEOBJECTS,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
    };
    if arguments.len() != 4 {
        return Err("Invalid prompt helper invocation".into());
    }
    system()?;
    let machine = &arguments[2];
    let console = arguments[3].parse::<u32>()?;
    signin_endpoint::validate_binary(machine, &std::env::current_exe()?)?;
    if session_id()? != console || locked_console() != Some(console) {
        return Err("The console is not locked".into());
    }
    struct Desktop(windows_sys::Win32::System::StationsAndDesktops::HDESK);
    impl Drop for Desktop {
        fn drop(&mut self) {
            unsafe {
                CloseDesktop(self.0);
            }
        }
    }
    let key = |flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_CONTROL,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let keys = [key(0), key(KEYEVENTF_KEYUP)];
    // With the display asleep or dimmed, the first press only wakes the screen and the picture keeps the input. So
    // the helper looks again after each press and presses once more, at most WAKE_PRESSES times, and only while the
    // console is still locked and the picture still has the input.
    for press in 0..WAKE_PRESSES {
        let input = unsafe {
            OpenInputDesktop(
                0,
                0,
                DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS | DESKTOP_JOURNALPLAYBACK,
            )
        };
        if input.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let input = Desktop(input);
        match wake_target(object_name(input.0).as_deref()) {
            WakeTarget::Prompt => return Ok(()),
            WakeTarget::Other if press == 0 => {
                return Err("The lock-screen picture does not have the input".into())
            }
            // Between desktops right after a press: wait and look again.
            WakeTarget::Other => {
                std::thread::sleep(std::time::Duration::from_millis(WAKE_SETTLE_MS));
                continue;
            }
            WakeTarget::Picture => {}
        }
        if unsafe { SetThreadDesktop(input.0) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        // The last check before each key: an unlock in between must not send it to someone's desktop.
        if locked_console() != Some(console) {
            return Err("The console was unlocked".into());
        }
        let sent = unsafe {
            SendInput(
                keys.len() as u32,
                keys.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };
        if sent as usize != keys.len() {
            return Err(std::io::Error::last_os_error().into());
        }
        std::thread::sleep(std::time::Duration::from_millis(WAKE_SETTLE_MS));
    }
    Ok(())
}

/// Presses the prompt helper may send in one run, and the pause after each; together well inside the supervisor's
/// five-second wait for the helper.
const WAKE_PRESSES: u32 = 4;
const WAKE_SETTLE_MS: u64 = 700;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_prompt_helper_presses_a_key_only_on_the_lock_screen_picture() {
        assert_eq!(wake_target(Some("Default")), WakeTarget::Picture);
        assert_eq!(wake_target(Some("default")), WakeTarget::Picture);
        assert_eq!(wake_target(Some("Winlogon")), WakeTarget::Prompt);
        assert_eq!(wake_target(Some("Screen-saver")), WakeTarget::Other);
        assert_eq!(wake_target(None), WakeTarget::Other);
        // Outside a locked console session the helper refuses before it looks at any desktop.
        assert!(run_wake(&["agent".into(), "signin-wake".into()]).is_err());
    }

    #[test]
    fn only_a_locked_session_or_a_console_with_nobody_signed_in_shows_the_sign_in_screen() {
        // Locked user session: active, lock flag 0.
        assert!(shows_sign_in(WTSActive, 0, true));
        // Fresh boot or after sign-out: connected, no user.
        assert!(shows_sign_in(WTSConnected, 0, false));
        assert!(shows_sign_in(WTSConnected, 1, false));
        // An unlocked user session (flag 1) is never eligible, even though UAC uses the same desktop.
        assert!(!shows_sign_in(WTSActive, 1, true));
        // A connected session that has a user is not the sign-in screen.
        assert!(!shows_sign_in(WTSConnected, 0, true));
        // Disconnected, idle or listening sessions are not a console that can be viewed.
        assert!(!shows_sign_in(
            windows_sys::Win32::System::RemoteDesktop::WTSDisconnected,
            0,
            false
        ));
        assert!(!shows_sign_in(
            windows_sys::Win32::System::RemoteDesktop::WTSIdle,
            0,
            false
        ));
    }
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
    #[test]
    fn readiness_needs_a_recent_positive_probe_without_a_future_timestamp() {
        let now = Instant::now();
        assert!(!fresh_ready(None, now));
        assert!(fresh_ready(Some(now), now));
        assert!(fresh_ready(Some(now), now + Duration::from_millis(999)));
        assert!(!fresh_ready(Some(now), now + Duration::from_secs(1)));
        assert!(!fresh_ready(Some(now + Duration::from_millis(1)), now));
    }
    fn fixture_key() -> String {
        STANDARD.encode(SigningKey::from_bytes(&[19; 32]).verifying_key().as_bytes())
    }
    #[test]
    fn retirement_child() {
        let Ok(pipe) = std::env::var("BEACON_RETIRE_FIXTURE") else {
            return;
        };
        let parent = std::env::var("BEACON_RETIRE_PARENT")
            .unwrap()
            .parse::<u32>()
            .unwrap();
        let console = std::env::var("BEACON_RETIRE_CONSOLE")
            .unwrap()
            .parse::<u32>()
            .unwrap();
        let instance = std::env::var("BEACON_RETIRE_INSTANCE").unwrap();
        let mode = std::env::var("BEACON_RETIRE_MODE").unwrap();
        let process = owned(unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                parent,
            )
        })
        .unwrap();
        let mut channel =
            SignInChannel::connect_fixture(&pipe, process.as_handle(), console).unwrap();
        channel
            .send(
                &SignInMessage::Ready {
                    instance_id: instance.clone(),
                    console_session_id: console,
                    challenge: instance.clone(),
                    worker_public_key: fixture_key(),
                },
                Duration::from_secs(2),
            )
            .unwrap();
        let SignInMessage::Retire { challenge } = channel.receive(Duration::from_secs(5)).unwrap()
        else {
            panic!("expected final challenge")
        };
        channel
            .send(
                &SignInMessage::Retired {
                    instance_id: instance,
                    console_session_id: console,
                    challenge: if mode == "wrong-challenge" {
                        uuid::Uuid::new_v4().to_string()
                    } else {
                        challenge
                    },
                    worker_public_key: if mode == "wrong-key" {
                        STANDARD
                            .encode(SigningKey::from_bytes(&[27; 32]).verifying_key().as_bytes())
                    } else {
                        fixture_key()
                    },
                    cleanup_confirmed: !matches!(mode.as_str(), "dirty" | "disabled-dirty"),
                    indicator_closed: mode != "ui-stalled",
                    locally_disabled: matches!(
                        mode.as_str(),
                        "disabled" | "disabled-dirty" | "wrong-key"
                    ),
                },
                Duration::from_secs(2),
            )
            .unwrap();
        if mode == "forced" {
            std::thread::sleep(Duration::from_secs(20));
        }
        if mode == "crash" {
            std::process::exit(7);
        }
    }
    fn retirement_fixture(mode: &str) -> Worker {
        use windows_sys::Win32::System::Threading::CreateProcessW;
        let listener = SignInListener::fixture().unwrap();
        let console = session_id().unwrap();
        let instance = uuid::Uuid::new_v4().to_string();
        let job = Job::new().unwrap();
        let mut attributes = Attributes::new(&job).unwrap();
        let executable = std::env::current_exe().unwrap();
        let mut command = wide(&format!(
            "\"{}\" --exact signin_worker::tests::retirement_child --nocapture --test-threads=1",
            executable.to_string_lossy()
        ));
        let windows = windows_directory().unwrap();
        let environment:Vec<u16>=format!("BEACON_RETIRE_CONSOLE={console}\0BEACON_RETIRE_FIXTURE={}\0BEACON_RETIRE_INSTANCE={instance}\0BEACON_RETIRE_MODE={mode}\0BEACON_RETIRE_PARENT={}\0SystemRoot={windows}\0WINDIR={windows}\0\0",listener.name(),std::process::id()).encode_utf16().collect();
        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = std::mem::size_of_val(&startup) as u32;
        startup.lpAttributeList = attributes.ptr();
        // Use only this fixture's already granted station/desktop, never a
        // guessed interactive desktop or any privileged sign-in placement.
        let mut desktop = wide(&format!(
            "{}\\{}",
            object_name(unsafe { GetProcessWindowStation() }).unwrap(),
            object_name(unsafe { GetThreadDesktop(GetCurrentThreadId()) }).unwrap()
        ));
        startup.StartupInfo.lpDesktop = desktop.as_mut_ptr();
        let mut info = PROCESS_INFORMATION::default();
        assert_ne!(
            unsafe {
                CreateProcessW(
                    wide(&executable.to_string_lossy()).as_ptr(),
                    command.as_mut_ptr(),
                    null(),
                    null(),
                    0,
                    CREATE_SUSPENDED
                        | CREATE_NO_WINDOW
                        | CREATE_UNICODE_ENVIRONMENT
                        | EXTENDED_STARTUPINFO_PRESENT,
                    environment.as_ptr().cast(),
                    null(),
                    &startup.StartupInfo,
                    &mut info,
                )
            },
            0
        );
        let process = owned(info.hProcess).unwrap();
        let thread = owned(info.hThread).unwrap();
        assert_ne!(unsafe { ResumeThread(thread.as_raw_handle()) }, u32::MAX);
        let mut channel = listener
            .accept_fixture(process.as_handle(), console)
            .unwrap_or_else(|error| {
                let mut exit = 0;
                unsafe {
                    GetExitCodeProcess(process.as_raw_handle(), &mut exit);
                }
                panic!(
                    "owned retirement fixture failed to connect ({mode}, exit {exit:#x}): {error}"
                );
            });
        assert!(
            matches!(channel.receive(Duration::from_secs(2)).unwrap(),SignInMessage::Ready{instance_id,..} if instance_id==instance)
        );
        let mut token = null_mut();
        assert_ne!(
            unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) },
            0
        );
        Worker {
            process,
            token: owned(token).unwrap(),
            job: Some(job),
            channel: Some(channel),
            instance,
            console,
            public_key: fixture_key(),
            lease: None,
            local_disable: LocalDisable::default(),
            attention: None,
            attention_sequence: 0,
            lease_deadline: 0,
            revoke: Arc::new(crate::signin_revoke::LocalRevoke::new(
                std::env::temp_dir().join(format!("unused-beacon-retire-{}", uuid::Uuid::new_v4())),
            )),
            retired: false,
            retirement_confirmed: false,
            last_ready: None,
        }
    }
    #[test]
    fn actual_owned_child_retirement_requires_pinned_cleanup_ui_and_normal_exit_and_keeps_final_disable(
    ) {
        for mode in [
            "clean",
            "disabled",
            "disabled-dirty",
            "dirty",
            "ui-stalled",
            "wrong-challenge",
            "wrong-key",
            "crash",
            "forced",
        ] {
            let mut worker = retirement_fixture(mode);
            worker.lease = Some(uuid::Uuid::new_v4().to_string());
            worker.lease_deadline =
                crate::signin_scope::tick() + 10000 * crate::signin_scope::TICKS_PER_MILLISECOND;
            assert!(!worker.revoke.requested());
            let expected = matches!(mode, "clean" | "disabled");
            let candidate = worker.retire_for_handoff();
            assert_eq!(candidate.is_some(), mode == "clean", "{mode}");
            if let Some(candidate) = candidate {
                assert_eq!(Some(candidate.lease), worker.lease);
                assert_eq!(candidate.instance, worker.instance);
                assert_eq!(candidate.console, worker.console);
            }
            assert_eq!(worker.retire(), expected, "{mode}");
            assert_eq!(
                worker.revoke.requested(),
                matches!(mode, "disabled" | "disabled-dirty"),
                "{mode}"
            );
            assert_eq!(
                worker.retire(),
                expected,
                "retirement cannot be retried into success: {mode}"
            );
            assert_eq!(
                unsafe { WaitForSingleObject(worker.process.as_raw_handle(), 0) },
                WAIT_OBJECT_0,
                "{mode}"
            );
            assert!(worker.job.is_none());
        }
    }
    #[test]
    fn draining_stops_the_scope_and_cannot_extend_its_grace_or_renew_authority() {
        let lease = uuid::Uuid::new_v4().to_string();
        let instance = uuid::Uuid::new_v4().to_string();
        let scope = crate::signin_scope::SignInScope::new(
            lease.clone(),
            instance.clone(),
            1,
            crate::signin_scope::tick() + 10000 * crate::signin_scope::TICKS_PER_MILLISECOND,
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
        )
        .unwrap();
        let owner = crate::signin_scope::ScopeOwner(Some(scope.clone()));
        let mut draining = None;
        let mut media = None;
        let mut clean = true;
        begin_draining(&mut draining, &owner, &mut media, &mut clean);
        let first = draining.unwrap();
        assert!(scope.expired());
        assert!(clean);
        begin_draining(&mut draining, &owner, &mut media, &mut clean);
        assert_eq!(draining, Some(first));
        assert!(scope
            .renew(
                &lease,
                &instance,
                1,
                crate::signin_scope::tick() + 1000 * crate::signin_scope::TICKS_PER_MILLISECOND
            )
            .is_err());
    }
    #[test]
    fn local_disable_never_restores_authority_or_extends_pending_cleanup_grace() {
        let now = Instant::now();
        let mut state = LocalDisable::default();
        assert!(!state.requested());
        assert!(!state.retain_ui(now));
        state.observe(false, now).unwrap();
        assert!(state.requested());
        assert!(state.retain_ui(now + Duration::from_secs(3)));
        state.observe(false, now + Duration::from_secs(3)).unwrap();
        assert!(!state.retain_ui(now + Duration::from_secs(4)));
        state.observe(true, now + Duration::from_secs(4)).unwrap();
        assert!(state.retain_ui(now + Duration::from_secs(60)));
        assert!(state.observe(false, now + Duration::from_secs(61)).is_err());
        assert!(state.requested());
        assert!(state.clean);
    }
    #[test]
    fn ordinary_desktop_and_ordinary_identity_cannot_become_a_signin_worker() {
        assert!(!on_signin_desktop(0));
        assert!(!on_signin_desktop(u32::MAX));
        if availability::current_sid().unwrap() != "S-1-5-18" {
            assert!(system().is_err());
        }
        assert!(run(&[]).is_err());
    }
    #[test]
    fn child_is_attached_to_its_kill_job_before_its_first_instruction() {
        use windows_sys::Win32::System::{JobObjects::IsProcessInJob, Threading::CreateProcessW};
        let job = Job::new().unwrap();
        let mut attributes = Attributes::new(&job).unwrap();
        let executable = wide(&format!(
            "{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            windows_directory().unwrap()
        ));
        let mut command = wide("powershell.exe -NoProfile -NonInteractive -Command exit");
        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = std::mem::size_of_val(&startup) as u32;
        startup.lpAttributeList = attributes.ptr();
        let mut info = PROCESS_INFORMATION::default();
        assert_ne!(
            unsafe {
                CreateProcessW(
                    executable.as_ptr(),
                    command.as_mut_ptr(),
                    null(),
                    null(),
                    0,
                    CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
                    null(),
                    null(),
                    &startup.StartupInfo,
                    &mut info,
                )
            },
            0
        );
        let process = owned(info.hProcess).unwrap();
        let _thread = owned(info.hThread).unwrap();
        let mut member = 0;
        assert_ne!(
            unsafe {
                IsProcessInJob(
                    process.as_raw_handle(),
                    job.handle().as_raw_handle(),
                    &mut member,
                )
            },
            0
        );
        assert_ne!(member, 0);
        drop(job);
        assert_eq!(
            unsafe { WaitForSingleObject(process.as_raw_handle(), 3000) },
            0
        );
        // The fixture is never resumed: no PowerShell script or GUI ran.
    }
}
