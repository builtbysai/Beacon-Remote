//! Private local IPC building block for ADR 0048, not a service or launcher.
//! No endpoint private key, input, pixels, executable path or arbitrary command crosses it.
//! Secure attention is a fixed-purpose, lease-bound request with a separate result.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    io,
    os::windows::io::{AsRawHandle, BorrowedHandle, FromRawHandle, OwnedHandle},
    ptr::{null, null_mut},
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{
        GetLastError, LocalFree, ERROR_IO_PENDING, ERROR_PIPE_CONNECTED, HANDLE,
        INVALID_HANDLE_VALUE, WAIT_TIMEOUT,
    },
    Security::{
        Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW, GetTokenInformation,
        IsWellKnownSid, TokenUser, WinLocalSystemSid, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::{
        CreateFileW, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED,
        OPEN_EXISTING, PIPE_ACCESS_DUPLEX, SECURITY_IDENTIFICATION, SECURITY_SQOS_PRESENT,
    },
    System::{
        Pipes::{
            ConnectNamedPipe, CreateNamedPipeW, GetNamedPipeClientProcessId,
            GetNamedPipeServerProcessId, SetNamedPipeHandleState, PIPE_READMODE_MESSAGE,
            PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_MESSAGE, PIPE_WAIT,
        },
        RemoteDesktop::ProcessIdToSessionId,
        Threading::{
            CreateEventW, GetCurrentProcess, GetProcessId, OpenProcessToken, WaitForSingleObject,
        },
        IO::{CancelIoEx, GetOverlappedResult, GetOverlappedResultEx, OVERLAPPED},
    },
};

const MAX_MESSAGE: usize = 4096;
const PREFIX: &str = r"\\.\pipe\BeaconRemote.SignIn.";
fn valid_worker_key(key: &str) -> bool {
    let Ok(bytes) = STANDARD.decode(key) else {
        return false;
    };
    if bytes.len() != 32 || STANDARD.encode(&bytes) != key {
        return false;
    }
    let Ok(bytes) = <[u8; 32]>::try_from(bytes.as_slice()) else {
        return false;
    };
    ed25519_dalek::VerifyingKey::from_bytes(&bytes).is_ok_and(|key| !key.is_weak())
}
fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Sign-in IPC boundary rejected",
    )
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn owned(handle: HANDLE) -> io::Result<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
    }
}
fn timeout_ms(timeout: Duration) -> io::Result<u32> {
    let millis = timeout.as_millis();
    if millis == 0 || millis > 5000 {
        return Err(invalid());
    }
    Ok(millis as u32)
}

fn token_user<T>(
    process: HANDLE,
    inspect: impl FnOnce(*mut TOKEN_USER) -> io::Result<T>,
) -> io::Result<T> {
    let mut token = null_mut();
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let token = owned(token)?;
    let mut needed = 0;
    unsafe {
        GetTokenInformation(token.as_raw_handle(), TokenUser, null_mut(), 0, &mut needed);
    }
    if needed == 0 || needed > 65536 {
        return Err(invalid());
    }
    // TOKEN_USER contains pointers: use pointer-aligned storage, not a byte vector.
    let mut buffer = vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    inspect(buffer.as_mut_ptr().cast())
}
fn is_system(process: HANDLE) -> io::Result<bool> {
    token_user(process, |user| {
        Ok(unsafe { IsWellKnownSid((*user).User.Sid, WinLocalSystemSid) } != 0)
    })
}
#[cfg(test)]
fn own_sid() -> io::Result<String> {
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    token_user(unsafe { GetCurrentProcess() }, |user| {
        let mut text = null_mut();
        if unsafe { ConvertSidToStringSidW((*user).User.Sid, &mut text) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let value = unsafe {
            let mut len = 0;
            while *text.add(len) != 0 {
                len += 1;
            }
            let value = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
            LocalFree(text.cast());
            value
        };
        Ok(value)
    })
}

// Keep the OVERLAPPED, event and caller's buffers alive through completion or
// cancellation. Dropping pending stack-backed I/O would be a use-after-free.
fn operation(
    handle: HANDLE,
    timeout: Duration,
    connect: bool,
    start: impl FnOnce(*mut OVERLAPPED) -> i32,
) -> io::Result<u32> {
    let wait = timeout_ms(timeout)?;
    let event = owned(unsafe { CreateEventW(null(), 1, 0, null()) })?;
    let mut overlap = OVERLAPPED {
        hEvent: event.as_raw_handle(),
        ..Default::default()
    };
    if start(&mut overlap) == 0 {
        let error = unsafe { GetLastError() };
        if connect && error == ERROR_PIPE_CONNECTED {
            return Ok(0);
        }
        if error != ERROR_IO_PENDING {
            return Err(io::Error::from_raw_os_error(error as i32));
        }
    }
    let mut bytes = 0;
    if unsafe { GetOverlappedResultEx(handle, &overlap, &mut bytes, wait, 0) } != 0 {
        return Ok(bytes);
    }
    let error = io::Error::last_os_error();
    unsafe {
        CancelIoEx(handle, &overlap);
        // CancelIoEx is a request, not completion. Drain before releasing memory.
        GetOverlappedResult(handle, &overlap, &mut bytes, 1);
    }
    Err(error)
}

fn peer(
    pipe: HANDLE,
    expected: BorrowedHandle<'_>,
    console: u32,
    server: bool,
    require_system: bool,
) -> io::Result<()> {
    let process = expected.as_raw_handle();
    let expected_id = unsafe { GetProcessId(process) };
    let mut actual = 0;
    let found = unsafe {
        if server {
            GetNamedPipeServerProcessId(pipe, &mut actual)
        } else {
            GetNamedPipeClientProcessId(pipe, &mut actual)
        }
    };
    let mut actual_session = u32::MAX;
    if expected_id == 0
        || found == 0
        || actual != expected_id
        || unsafe { WaitForSingleObject(process, 0) } != WAIT_TIMEOUT
        || unsafe { ProcessIdToSessionId(actual, &mut actual_session) } == 0
        || actual_session != console
        || (require_system && !is_system(process)?)
    {
        return Err(invalid());
    }
    Ok(())
}

/// Lifecycle/lease messages and one fixed secure-attention request; no arbitrary RPC.
/// Deliberately has no Debug implementation or credentials/pixels/input fields.
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum SignInMessage {
    Ready {
        instance_id: String,
        console_session_id: u32,
        challenge: String,
        worker_public_key: String,
    },
    Draining {
        instance_id: String,
        console_session_id: u32,
        challenge: String,
        worker_public_key: String,
    },
    Retire {
        challenge: String,
    },
    Retired {
        instance_id: String,
        console_session_id: u32,
        challenge: String,
        worker_public_key: String,
        cleanup_confirmed: bool,
        indicator_closed: bool,
        locally_disabled: bool,
    },
    LocalDisable {
        instance_id: String,
        console_session_id: u32,
        challenge: String,
        worker_public_key: String,
        cleanup_confirmed: bool,
    },
    SecureAttention {
        instance_id: String,
        console_session_id: u32,
        challenge: String,
        worker_public_key: String,
        lease_id: String,
        sequence: u64,
        expires_at_tick: u64,
    },
    AttentionResult {
        lease_id: String,
        sequence: u64,
        outcome: crate::signin_attention::Outcome,
    },
    Authorization {
        lease_id: String,
        instance_id: String,
        console_session_id: u32,
        expires_at_tick: u64,
        controller: String,
    },
    Stop {},
    Probe {
        challenge: String,
    },
    Stopped {},
}
impl SignInMessage {
    fn valid(&self, console: u32) -> bool {
        self.valid_at(console, crate::signin_scope::tick())
    }
    fn valid_at(&self, console: u32, now: u64) -> bool {
        let valid_id = |id: &str| uuid::Uuid::parse_str(id).is_ok_and(|id| !id.is_nil());
        match self {
            Self::Ready {
                instance_id,
                console_session_id,
                challenge,
                worker_public_key,
            }
            | Self::Draining {
                instance_id,
                console_session_id,
                challenge,
                worker_public_key,
            }
            | Self::Retired {
                instance_id,
                console_session_id,
                challenge,
                worker_public_key,
                ..
            }
            | Self::LocalDisable {
                instance_id,
                console_session_id,
                challenge,
                worker_public_key,
                ..
            } => {
                valid_id(instance_id)
                    && valid_id(challenge)
                    && *console_session_id == console
                    && valid_worker_key(worker_public_key)
            }
            Self::Authorization {
                lease_id,
                instance_id,
                console_session_id,
                expires_at_tick,
                controller,
            } => {
                valid_id(lease_id)
                    && valid_id(instance_id)
                    && *console_session_id == console
                    && crate::signin_scope::bounded_deadline(*expires_at_tick, now)
                    && !controller.is_empty()
                    && controller.len() <= 254
                    && !controller.chars().any(char::is_control)
            }
            Self::SecureAttention {
                instance_id,
                console_session_id,
                challenge,
                worker_public_key,
                lease_id,
                sequence,
                expires_at_tick,
            } => {
                valid_id(instance_id)
                    && *console_session_id == console
                    && valid_id(challenge)
                    && valid_worker_key(worker_public_key)
                    && valid_id(lease_id)
                    && *sequence > 0
                    && crate::signin_scope::bounded_deadline(*expires_at_tick, now)
            }
            Self::AttentionResult {
                lease_id, sequence, ..
            } => valid_id(lease_id) && *sequence > 0,
            Self::Probe { challenge } | Self::Retire { challenge } => valid_id(challenge),
            Self::Stop { .. } | Self::Stopped { .. } => true,
        }
    }
    fn is_service_message(&self) -> bool {
        matches!(
            self,
            Self::Authorization { .. }
                | Self::Stop { .. }
                | Self::Probe { .. }
                | Self::AttentionResult { .. }
                | Self::Retire { .. }
        )
    }
    /// Decode only after a successful separately signed /signin/authorize
    /// exchange with the configured HTTPS origin. Anchor expiry before the
    /// request, conservatively subtracting network plus later IPC latency.
    pub fn authorization_reply(
        body: &[u8],
        lease: &str,
        instance: &str,
        console: u32,
        request_started_tick: u64,
    ) -> io::Result<Self> {
        Self::authorization_reply_at(
            body,
            lease,
            instance,
            console,
            request_started_tick,
            crate::signin_scope::tick(),
        )
    }
    fn authorization_reply_at(
        body: &[u8],
        lease: &str,
        instance: &str,
        console: u32,
        started: u64,
        now: u64,
    ) -> io::Result<Self> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Reply {
            scope: String,
            id: String,
            instance_id: String,
            console_session_id: u32,
            remaining_millis: u32,
            controller: String,
            files: bool,
            clipboard: bool,
            audio: bool,
            recording: bool,
            automation: bool,
        }
        if body.len() > MAX_MESSAGE || started > now {
            return Err(invalid());
        }
        let reply: Reply = serde_json::from_slice(body).map_err(|_| invalid())?;
        if reply.scope != "windows:sign-in"
            || reply.id != lease
            || reply.instance_id != instance
            || reply.console_session_id != console
            || !(1..=15000).contains(&reply.remaining_millis)
            || reply.files
            || reply.clipboard
            || reply.audio
            || reply.recording
            || reply.automation
        {
            return Err(invalid());
        }
        let message = Self::Authorization {
            lease_id: reply.id,
            instance_id: reply.instance_id,
            console_session_id: reply.console_session_id,
            expires_at_tick: started
                .checked_add(
                    reply.remaining_millis as u64 * crate::signin_scope::TICKS_PER_MILLISECOND,
                )
                .ok_or_else(invalid)?,
            controller: reply.controller,
        };
        if !message.valid_at(console, now) {
            return Err(invalid());
        }
        Ok(message)
    }
}

pub struct SignInListener {
    pipe: OwnedHandle,
    name: String,
}
impl SignInListener {
    #[cfg(test)]
    pub(crate) fn fixture() -> io::Result<Self> {
        Self::create_with_acl(&format!("D:P(A;;GA;;;{})", own_sid()?))
    }
    #[cfg(test)]
    pub(crate) fn accept_fixture(
        self,
        worker: BorrowedHandle<'_>,
        console: u32,
    ) -> io::Result<SignInChannel> {
        self.accept_peer(worker, console, Duration::from_secs(2), false)
    }
    pub fn create() -> io::Result<Self> {
        if !is_system(unsafe { GetCurrentProcess() })? {
            return Err(invalid());
        }
        Self::create_with_acl("O:SYG:SYD:P(A;;GA;;;SY)")
    }
    fn create_with_acl(acl: &str) -> io::Result<Self> {
        let name = format!("{PREFIX}{}", uuid::Uuid::new_v4());
        let mut descriptor = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide(acl).as_ptr(),
                1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let raw = unsafe {
            CreateNamedPipeW(
                wide(&name).as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                MAX_MESSAGE as u32,
                MAX_MESSAGE as u32,
                0,
                &attributes,
            )
        };
        let result = owned(raw);
        unsafe {
            LocalFree(descriptor);
        }
        Ok(Self {
            pipe: result?,
            name,
        })
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn accept(
        self,
        worker: BorrowedHandle<'_>,
        console: u32,
        timeout: Duration,
    ) -> io::Result<SignInChannel> {
        if console == 0 || console == u32::MAX {
            return Err(invalid());
        }
        self.accept_peer(worker, console, timeout, true)
    }
    fn accept_peer(
        self,
        worker: BorrowedHandle<'_>,
        console: u32,
        timeout: Duration,
        require_system: bool,
    ) -> io::Result<SignInChannel> {
        operation(self.pipe.as_raw_handle(), timeout, true, |overlap| unsafe {
            ConnectNamedPipe(self.pipe.as_raw_handle(), overlap)
        })?;
        peer(
            self.pipe.as_raw_handle(),
            worker,
            console,
            false,
            require_system,
        )?;
        Ok(SignInChannel {
            pipe: Some(self.pipe),
            console,
            service: true,
        })
    }
}

pub struct SignInChannel {
    pipe: Option<OwnedHandle>,
    console: u32,
    service: bool,
}
impl SignInChannel {
    #[cfg(test)]
    pub(crate) fn connect_fixture(
        name: &str,
        service: BorrowedHandle<'_>,
        console: u32,
    ) -> io::Result<Self> {
        Self::connect_peer(name, service, console, false, console)
    }
    pub fn connect(name: &str, service: BorrowedHandle<'_>, console: u32) -> io::Result<Self> {
        if console == 0 || console == u32::MAX {
            return Err(invalid());
        }
        Self::connect_peer(name, service, console, true, 0)
    }
    fn connect_peer(
        name: &str,
        service: BorrowedHandle<'_>,
        console: u32,
        require_system: bool,
        service_session: u32,
    ) -> io::Result<Self> {
        if !name
            .strip_prefix(PREFIX)
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
        {
            return Err(invalid());
        }
        let pipe = owned(unsafe {
            CreateFileW(
                wide(name).as_ptr(),
                0x80000000 | 0x40000000,
                0,
                null(),
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
                null_mut(),
            )
        })?;
        let mode = PIPE_READMODE_MESSAGE;
        if unsafe { SetNamedPipeHandleState(pipe.as_raw_handle(), &mode, null(), null()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        // The server must be the expected still-live SYSTEM service in Session 0.
        peer(
            pipe.as_raw_handle(),
            service,
            service_session,
            true,
            require_system,
        )?;
        Ok(Self {
            pipe: Some(pipe),
            console,
            service: false,
        })
    }
    pub fn send(&mut self, message: &SignInMessage, timeout: Duration) -> io::Result<()> {
        let console = self.console;
        let service = self.service;
        self.transact(|handle| {
            if !message.valid(console) || message.is_service_message() != service {
                return Err(invalid());
            }
            let bytes = serde_json::to_vec(message).map_err(|_| invalid())?;
            if bytes.len() > MAX_MESSAGE {
                return Err(invalid());
            }
            let count = operation(handle, timeout, false, |overlap| unsafe {
                WriteFile(
                    handle,
                    bytes.as_ptr(),
                    bytes.len() as u32,
                    null_mut(),
                    overlap,
                )
            })?;
            if count as usize != bytes.len() {
                return Err(invalid());
            }
            Ok(())
        })
    }
    pub fn receive(&mut self, timeout: Duration) -> io::Result<SignInMessage> {
        let console = self.console;
        let service = self.service;
        self.transact(|handle| {
            let mut bytes = [0u8; MAX_MESSAGE];
            let count = operation(handle, timeout, false, |overlap| unsafe {
                ReadFile(
                    handle,
                    bytes.as_mut_ptr(),
                    bytes.len() as u32,
                    null_mut(),
                    overlap,
                )
            })?;
            if count == 0 || count as usize > MAX_MESSAGE {
                return Err(invalid());
            }
            let message: SignInMessage =
                serde_json::from_slice(&bytes[..count as usize]).map_err(|_| invalid())?;
            if !message.valid(console) || message.is_service_message() == service {
                return Err(invalid());
            }
            Ok(message)
        })
    }
    fn transact<T>(&mut self, action: impl FnOnce(HANDLE) -> io::Result<T>) -> io::Result<T> {
        let handle = self.pipe.as_ref().ok_or_else(invalid)?.as_raw_handle();
        let result = action(handle);
        // Any framing, role, policy or I/O failure permanently closes this channel.
        if result.is_err() {
            self.pipe.take();
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retirement_is_role_bound_context_bound_and_does_not_carry_grants_or_commands() {
        let instance = uuid::Uuid::new_v4().to_string();
        let challenge = uuid::Uuid::new_v4().to_string();
        let request = SignInMessage::Retire {
            challenge: challenge.clone(),
        };
        assert!(request.valid(2));
        assert!(request.is_service_message());
        let reply = SignInMessage::Retired {
            instance_id: instance.clone(),
            console_session_id: 2,
            challenge: challenge.clone(),
            worker_public_key: worker_public_key(),
            cleanup_confirmed: false,
            indicator_closed: false,
            locally_disabled: true,
        };
        assert!(reply.valid(2));
        assert!(!reply.valid(3));
        assert!(!reply.is_service_message());
        let draining = SignInMessage::Draining {
            instance_id: instance,
            console_session_id: 2,
            challenge,
            worker_public_key: worker_public_key(),
        };
        assert!(draining.valid(2));
        assert!(!draining.valid(3));
        assert!(!draining.is_service_message());
        for message in [request, reply, draining] {
            let body = serde_json::to_value(message).unwrap();
            for field in ["command", "desktop", "lease_id", "expires_at_tick"] {
                let mut changed = body.clone();
                changed[field] = serde_json::json!("not-allowed");
                assert!(serde_json::from_value::<SignInMessage>(changed).is_err());
            }
        }
    }
    fn worker_public_key() -> String {
        STANDARD.encode(
            ed25519_dalek::SigningKey::from_bytes(&[19; 32])
                .verifying_key()
                .as_bytes(),
        )
    }
    #[test]
    fn worker_public_identity_is_canonical_and_cannot_carry_private_material() {
        let key = worker_public_key();
        assert!(valid_worker_key(&key));
        assert!(!valid_worker_key("not a public key"));
        assert!(!valid_worker_key(&STANDARD.encode([0u8; 32])));
        assert!(!valid_worker_key(&STANDARD.encode([1u8; 31])));
        let ready = serde_json::json!({"type":"ready","instance_id":uuid::Uuid::new_v4().to_string(),
            "console_session_id":1,"challenge":uuid::Uuid::new_v4().to_string(),"worker_public_key":key,"private_key":"forbidden"});
        assert!(serde_json::from_value::<SignInMessage>(ready).is_err());
    }
    #[test]
    fn backend_reply_is_scope_bound_and_lifetime_includes_network_and_ipc_delay() {
        const T: u64 = crate::signin_scope::TICKS_PER_MILLISECOND;
        let decode = |body: &[u8], lease: &str, instance: &str, console, started: u64, now: u64| {
            SignInMessage::authorization_reply_at(
                body,
                lease,
                instance,
                console,
                started * T,
                now * T,
            )
        };
        let lease = uuid::Uuid::new_v4().to_string();
        let instance = uuid::Uuid::new_v4().to_string();
        let reply = serde_json::json!({"scope":"windows:sign-in","id":lease,"instanceId":instance,"consoleSessionId":2,"remainingMillis":4000,"controller":"Owner","files":false,"clipboard":false,"audio":false,"recording":false,"automation":false});
        let bytes = serde_json::to_vec(&reply).unwrap();
        let grant = decode(&bytes, &lease, &instance, 2, 1000, 3000).unwrap();
        assert!(matches!(
            grant,
            SignInMessage::Authorization {
                expires_at_tick, ..
            } if expires_at_tick == 5000 * T
        ));
        assert!(grant.valid_at(2, 4999 * T));
        assert!(!grant.valid_at(2, 5000 * T));
        assert!(decode(&bytes, &lease, &instance, 2, 1000, 5000).is_err());
        assert!(decode(&bytes, &lease, &instance, 2, 5000, 1000).is_err());
        assert!(decode(&bytes, &lease, &instance, 3, 1000, 3000).is_err());
        assert!(decode(
            &bytes,
            &uuid::Uuid::new_v4().to_string(),
            &instance,
            2,
            1000,
            3000
        )
        .is_err());
        for field in ["files", "clipboard", "audio", "recording", "automation"] {
            let mut changed = reply.clone();
            changed[field] = serde_json::json!(true);
            assert!(decode(
                &serde_json::to_vec(&changed).unwrap(),
                &lease,
                &instance,
                2,
                1000,
                3000
            )
            .is_err());
        }
        let mut ordinary = reply;
        ordinary["scope"] = serde_json::json!("desktop:control");
        assert!(decode(
            &serde_json::to_vec(&ordinary).unwrap(),
            &lease,
            &instance,
            2,
            1000,
            3000
        )
        .is_err());
    }
    #[test]
    fn pipe_wait_is_bounded_and_cancellation_drains_pending_io() {
        let acl = format!("D:P(A;;GA;;;{})", own_sid().unwrap());
        let listener = SignInListener::create_with_acl(&acl).unwrap();
        let started = std::time::Instant::now();
        // No client: timeout happens before peer inspection. No child process or service.
        let current = unsafe { BorrowedHandle::borrow_raw(GetCurrentProcess()) };
        assert!(listener
            .accept_peer(current, 1, Duration::from_millis(20), false)
            .is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
    }
    #[test]
    fn lifecycle_messages_cannot_convey_commands_files_or_wrong_console_authority() {
        assert!(
            serde_json::from_str::<SignInMessage>(r#"{"type":"stop","command":"anything"}"#)
                .is_err()
        );
        let instance = uuid::Uuid::new_v4().to_string();
        let ready = SignInMessage::Ready {
            instance_id: instance.clone(),
            console_session_id: 2,
            challenge: instance.clone(),
            worker_public_key: worker_public_key(),
        };
        assert!(ready.valid(2));
        assert!(!ready.valid(1));
        let now = crate::signin_scope::tick();
        let authority = SignInMessage::Authorization {
            lease_id: uuid::Uuid::new_v4().to_string(),
            instance_id: instance,
            console_session_id: 2,
            expires_at_tick: now + 15001 * crate::signin_scope::TICKS_PER_MILLISECOND,
            controller: "Owner".into(),
        };
        assert!(!authority.valid_at(2, now));
        assert!(authority.is_service_message());
        assert!(!ready.is_service_message());
        assert!(SignInChannel::connect_peer(
            r"\\remote\pipe\public",
            unsafe { BorrowedHandle::borrow_raw(GetCurrentProcess()) },
            1,
            false,
            0
        )
        .is_err());
    }
    #[test]
    fn ordinary_user_cannot_create_a_system_signin_channel() {
        if !is_system(unsafe { GetCurrentProcess() }).unwrap() {
            assert!(SignInListener::create().is_err());
        }
    }
    #[test]
    fn attention_messages_are_typed_role_bound_and_expiry_bound() {
        let now = crate::signin_scope::tick();
        let request = SignInMessage::SecureAttention {
            instance_id: uuid::Uuid::new_v4().to_string(),
            console_session_id: 2,
            challenge: uuid::Uuid::new_v4().to_string(),
            worker_public_key: worker_public_key(),
            lease_id: uuid::Uuid::new_v4().to_string(),
            sequence: 7,
            expires_at_tick: now + 1000 * crate::signin_scope::TICKS_PER_MILLISECOND,
        };
        assert!(request.valid_at(2, now));
        assert!(!request.is_service_message());
        assert!(!request.valid_at(3, now));
        assert!(!request.valid_at(2, now + 1000 * crate::signin_scope::TICKS_PER_MILLISECOND));
        let json = serde_json::to_value(&request).unwrap();
        for (field, value) in [
            ("lease_id", serde_json::json!("ordinary-grant")),
            ("sequence", serde_json::json!(0)),
            ("worker_public_key", serde_json::json!("private material")),
        ] {
            let mut changed = json.clone();
            changed[field] = value;
            let decoded: SignInMessage = serde_json::from_value(changed).unwrap();
            assert!(!decoded.valid_at(2, now));
        }
        let mut changed = json;
        changed["command"] = serde_json::json!("anything");
        assert!(serde_json::from_value::<SignInMessage>(changed).is_err());
        let result = SignInMessage::AttentionResult {
            lease_id: uuid::Uuid::new_v4().to_string(),
            sequence: 7,
            outcome: crate::signin_attention::Outcome::Requested,
        };
        assert!(result.valid_at(2, now));
        assert!(result.is_service_message());
        let mut changed = serde_json::to_value(result).unwrap();
        changed["outcome"] = serde_json::json!("delivered");
        assert!(serde_json::from_value::<SignInMessage>(changed).is_err());
    }
    #[test]
    fn actual_private_pipe_exchanges_attention_request_and_honest_result_without_os_action() {
        let listener =
            SignInListener::create_with_acl(&format!("D:P(A;;GA;;;{})", own_sid().unwrap()))
                .unwrap();
        let name = listener.name().to_owned();
        let session = {
            let mut value = 0;
            assert_ne!(
                unsafe { ProcessIdToSessionId(std::process::id(), &mut value) },
                0
            );
            value
        };
        let lease = uuid::Uuid::new_v4().to_string();
        let worker_lease = lease.clone();
        let client = std::thread::spawn(move || {
            let current = unsafe { BorrowedHandle::borrow_raw(GetCurrentProcess()) };
            let mut channel =
                SignInChannel::connect_peer(&name, current, session, false, session).unwrap();
            let SignInMessage::Probe { challenge } =
                channel.receive(Duration::from_secs(2)).unwrap()
            else {
                panic!("missing challenge")
            };
            channel
                .send(
                    &SignInMessage::SecureAttention {
                        instance_id: uuid::Uuid::new_v4().to_string(),
                        console_session_id: session,
                        challenge,
                        worker_public_key: worker_public_key(),
                        lease_id: worker_lease.clone(),
                        sequence: 9,
                        expires_at_tick: crate::signin_scope::tick()
                            + 3000 * crate::signin_scope::TICKS_PER_MILLISECOND,
                    },
                    Duration::from_secs(2),
                )
                .unwrap();
            assert!(
                matches!(channel.receive(Duration::from_secs(2)).unwrap(),SignInMessage::AttentionResult{lease_id,sequence:9,outcome:crate::signin_attention::Outcome::PolicyUnavailable} if lease_id==worker_lease)
            );
        });
        let current = unsafe { BorrowedHandle::borrow_raw(GetCurrentProcess()) };
        let mut channel = listener
            .accept_peer(current, session, Duration::from_secs(2), false)
            .unwrap();
        let challenge = uuid::Uuid::new_v4().to_string();
        channel
            .send(
                &SignInMessage::Probe {
                    challenge: challenge.clone(),
                },
                Duration::from_secs(2),
            )
            .unwrap();
        assert!(
            matches!(channel.receive(Duration::from_secs(2)).unwrap(),SignInMessage::SecureAttention{lease_id,sequence:9,challenge:echo,..} if lease_id==lease && echo==challenge)
        );
        channel
            .send(
                &SignInMessage::AttentionResult {
                    lease_id: lease,
                    sequence: 9,
                    outcome: crate::signin_attention::Outcome::PolicyUnavailable,
                },
                Duration::from_secs(2),
            )
            .unwrap();
        client.join().unwrap();
    }
    #[test]
    fn disable_notices_are_worker_only_context_bound_and_cannot_carry_commands() {
        let notice = SignInMessage::LocalDisable {
            instance_id: uuid::Uuid::new_v4().to_string(),
            console_session_id: 2,
            challenge: uuid::Uuid::new_v4().to_string(),
            worker_public_key: worker_public_key(),
            cleanup_confirmed: false,
        };
        assert!(notice.valid(2));
        assert!(!notice.valid(3));
        assert!(!notice.is_service_message());
        let mut body = serde_json::to_value(&notice).unwrap();
        body["command"] = serde_json::json!("forbidden");
        assert!(serde_json::from_value::<SignInMessage>(body).is_err());
    }
    #[test]
    fn actual_local_pipe_checks_process_and_session_before_exchanging_typed_messages() {
        let mut session = u32::MAX;
        assert_ne!(
            unsafe { ProcessIdToSessionId(std::process::id(), &mut session) },
            0
        );
        let listener =
            SignInListener::create_with_acl(&format!("D:P(A;;GA;;;{})", own_sid().unwrap()))
                .unwrap();
        let name = listener.name().to_owned();
        let worker = std::thread::spawn(move || {
            let current = unsafe { BorrowedHandle::borrow_raw(GetCurrentProcess()) };
            let mut channel =
                SignInChannel::connect_peer(&name, current, session, false, session).unwrap();
            channel
                .send(
                    &SignInMessage::Ready {
                        instance_id: uuid::Uuid::new_v4().to_string(),
                        console_session_id: session,
                        challenge: uuid::Uuid::new_v4().to_string(),
                        worker_public_key: worker_public_key(),
                    },
                    Duration::from_secs(2),
                )
                .unwrap();
            let challenge = match channel.receive(Duration::from_secs(2)).unwrap() {
                SignInMessage::Probe { challenge } => challenge,
                _ => panic!("expected a fresh service probe"),
            };
            channel
                .send(
                    &SignInMessage::Ready {
                        instance_id: uuid::Uuid::new_v4().to_string(),
                        console_session_id: session,
                        challenge,
                        worker_public_key: worker_public_key(),
                    },
                    Duration::from_secs(2),
                )
                .unwrap();
            for cleanup_confirmed in [false, true] {
                let challenge = match channel.receive(Duration::from_secs(2)).unwrap() {
                    SignInMessage::Probe { challenge } => challenge,
                    _ => panic!("expected disable-state probe"),
                };
                channel
                    .send(
                        &SignInMessage::LocalDisable {
                            instance_id: uuid::Uuid::new_v4().to_string(),
                            console_session_id: session,
                            challenge,
                            worker_public_key: worker_public_key(),
                            cleanup_confirmed,
                        },
                        Duration::from_secs(2),
                    )
                    .unwrap();
            }
            assert!(matches!(
                channel.receive(Duration::from_secs(2)).unwrap(),
                SignInMessage::Stop { .. }
            ));
            channel
                .send(&SignInMessage::Stopped {}, Duration::from_secs(2))
                .unwrap();
        });
        let current = unsafe { BorrowedHandle::borrow_raw(GetCurrentProcess()) };
        let mut channel = listener
            .accept_peer(current, session, Duration::from_secs(2), false)
            .unwrap();
        assert!(matches!(
            channel.receive(Duration::from_secs(2)).unwrap(),
            SignInMessage::Ready { .. }
        ));
        let challenge = uuid::Uuid::new_v4().to_string();
        channel
            .send(
                &SignInMessage::Probe {
                    challenge: challenge.clone(),
                },
                Duration::from_secs(2),
            )
            .unwrap();
        assert!(
            matches!(channel.receive(Duration::from_secs(2)).unwrap(), SignInMessage::Ready { challenge: echoed, .. } if echoed == challenge)
        );
        for expected in [false, true] {
            let challenge = uuid::Uuid::new_v4().to_string();
            channel
                .send(
                    &SignInMessage::Probe {
                        challenge: challenge.clone(),
                    },
                    Duration::from_secs(2),
                )
                .unwrap();
            assert!(
                matches!(channel.receive(Duration::from_secs(2)).unwrap(),SignInMessage::LocalDisable{challenge:echoed,cleanup_confirmed,..} if echoed==challenge && cleanup_confirmed==expected)
            );
        }
        channel
            .send(&SignInMessage::Stop {}, Duration::from_secs(2))
            .unwrap();
        assert!(matches!(
            channel.receive(Duration::from_secs(2)).unwrap(),
            SignInMessage::Stopped { .. }
        ));
        worker.join().unwrap();
    }
}
