//! Separate administrator-installed Windows sign-in endpoint (ADR 0048).
//! Its scoped worker probes the active sign-in desktop. Media readiness stays
//! false until remaining integration and SYSTEM/device acceptance are complete.
use crate::{
    availability::{self, known_folder, reject_reparse, secure_directory},
    credentials, load_identity, signin_files, signin_revoke, validate_server, HostError,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs,
    io::Read,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    path::{Path, PathBuf},
    ptr::null_mut,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use windows_service::{
    define_windows_service,
    service::{
        Service, ServiceAccess, ServiceAction, ServiceActionType, ServiceControl,
        ServiceControlAccept, ServiceErrorControl, ServiceExitCode, ServiceFailureActions,
        ServiceFailureResetPeriod, ServiceInfo, ServiceStartType, ServiceState, ServiceStatus,
        ServiceType, UserEventCode,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
    service_manager::{ServiceManager, ServiceManagerAccess},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree},
    Security::{
        Authorization::ConvertStringSidToSidW, GetTokenInformation, TokenElevation,
        TOKEN_ELEVATION, TOKEN_QUERY,
    },
    System::{
        RemoteDesktop::*,
        Threading::{
            GetCurrentProcess, GetExitCodeProcess, OpenProcess, OpenProcessToken,
            WaitForSingleObject, PROCESS_SYNCHRONIZE,
        },
    },
    UI::Shell::{
        CommandLineToArgvW, FOLDERID_ProgramData, FOLDERID_ProgramFiles, ShellExecuteExW,
        SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    },
};
use zeroize::{Zeroize, Zeroizing};

const MAX_BINARY: usize = 256 * 1024 * 1024;
static MACHINE: OnceLock<String> = OnceLock::new();
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn name(machine: &str) -> String {
    format!("BeaconRemoteSignIn-{machine}")
}
fn valid_machine(machine: &str) -> Result<(), HostError> {
    let id = uuid::Uuid::parse_str(machine)?;
    if id.is_nil() || id.to_string() != machine {
        return Err("A canonical machine UUID is required".into());
    }
    Ok(())
}
fn valid_owner(owner: &str) -> Result<(), HostError> {
    if owner.len() > 184
        || !owner.starts_with("S-1-")
        || !owner
            .bytes()
            .all(|c| c == b'S' || c == b'-' || c.is_ascii_digit())
    {
        return Err("Invalid Windows owner SID".into());
    }
    let mut sid = null_mut();
    let value = wide(owner);
    if unsafe { ConvertStringSidToSidW(value.as_ptr(), &mut sid) } == 0 {
        return Err("Invalid Windows owner SID".into());
    }
    unsafe {
        LocalFree(sid);
    }
    Ok(())
}
fn elevated() -> Result<bool, HostError> {
    let mut token = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut elevation = TOKEN_ELEVATION::default();
    let mut needed = 0;
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            std::ptr::from_mut(&mut elevation).cast(),
            std::mem::size_of_val(&elevation) as u32,
            &mut needed,
        )
    };
    unsafe {
        CloseHandle(token);
    }
    if ok == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(elevation.TokenIsElevated != 0)
}
fn require_admin() -> Result<(), HostError> {
    if !elevated()? {
        return Err(
            "Windows administrator setup is required for the separate sign-in endpoint".into(),
        );
    }
    Ok(())
}
fn roots() -> Result<(PathBuf, PathBuf), HostError> {
    Ok((
        known_folder(&FOLDERID_ProgramFiles)?.join("Beacon Remote Sign-in"),
        known_folder(&FOLDERID_ProgramData)?.join("BeaconRemoteSignIn"),
    ))
}
fn paths(machine: &str) -> Result<(PathBuf, PathBuf), HostError> {
    valid_machine(machine)?;
    let (programs, data) = roots()?;
    Ok((programs.join(machine), data.join(machine)))
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MachineIdentity {
    version: u8,
    machine: String,
    server: String,
    owner_sid: String,
    secret: [u8; 32],
}
impl Drop for MachineIdentity {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PublicBinding {
    version: u8,
    machine: String,
    server: String,
    owner_sid: String,
    public_key: String,
}
fn read_binding(machine: &str) -> Result<PublicBinding, HostError> {
    let (root, _) = roots()?;
    signin_files::verify_directory(&root, availability::PUBLIC_ACL)?;
    let (programs, _) = paths(machine)?;
    signin_files::verify_directory(&programs, availability::PUBLIC_ACL)?;
    let binding: PublicBinding = serde_json::from_slice(&signin_files::read(
        &programs.join("public.json"),
        signin_files::PUBLIC_FILE,
        4096,
    )?)
    .map_err(|_| "Cannot read the sign-in public binding")?;
    if binding.version != 1
        || binding.machine != machine
        || validate_server(&binding.server)?.to_string() != binding.server
        || STANDARD.decode(&binding.public_key)?.len() != 32
    {
        return Err("Invalid sign-in public binding".into());
    }
    valid_owner(&binding.owner_sid)?;
    Ok(binding)
}
pub(crate) fn worker_server(machine: &str) -> Result<reqwest::Url, HostError> {
    validate_server(&read_binding(machine)?.server)
}
fn private_identity(machine: &str) -> Result<MachineIdentity, HostError> {
    let (_, root) = roots()?;
    signin_files::verify_directory(&root, availability::PRIVATE_ACL)?;
    let (_, data) = paths(machine)?;
    signin_files::verify_directory(&data, availability::PRIVATE_ACL)?;
    let encrypted = signin_files::read(
        &data.join("identity.dpapi"),
        signin_files::PRIVATE_FILE,
        8192,
    )?;
    let bytes = Zeroizing::new(credentials::unprotect(&encrypted)?);
    let identity: MachineIdentity =
        serde_json::from_slice(&bytes).map_err(|_| "Cannot read the protected sign-in identity")?;
    if identity.version != 1
        || identity.machine != machine
        || validate_server(&identity.server)?.to_string() != identity.server
    {
        return Err("Invalid protected sign-in identity".into());
    }
    valid_owner(&identity.owner_sid)?;
    Ok(identity)
}
fn identity(machine: &str) -> Result<MachineIdentity, HostError> {
    let identity = private_identity(machine)?;
    let binding = read_binding(machine)?;
    if identity.version != 1
        || identity.machine != machine
        || identity.server != binding.server
        || identity.owner_sid != binding.owner_sid
        || STANDARD.encode(
            SigningKey::from_bytes(&identity.secret)
                .verifying_key()
                .as_bytes(),
        ) != binding.public_key
    {
        return Err("The protected sign-in identity does not match its public binding".into());
    }
    Ok(identity)
}
fn binary_hash(path: &Path) -> Result<String, HostError> {
    let bytes = signin_files::read(path, signin_files::PUBLIC_FILE, MAX_BINARY)?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}
fn version_name(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
/// Which check inside `validate_binary` ran last; a failing worker reports it in its exit status.
pub(crate) static VALIDATE_STEP: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0);
fn validated(step: u32) {
    VALIDATE_STEP.store(step, Ordering::Relaxed);
}

pub(crate) fn validate_binary(machine: &str, executable: &Path) -> Result<(), HostError> {
    validated(1);
    let (root, _) = roots()?;
    validated(2);
    signin_files::verify_directory(&root, availability::PUBLIC_ACL)?;
    validated(3);
    let (programs, _) = paths(machine)?;
    validated(4);
    signin_files::verify_directory(&programs, availability::PUBLIC_ACL)?;
    validated(5);
    reject_reparse(executable)?;
    validated(6);
    let version = executable
        .parent()
        .ok_or("Missing sign-in binary version")?;
    let hash = version
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid sign-in binary version")?;
    if executable.file_name().and_then(|name| name.to_str()) != Some("beacon-remote-agent.exe")
        || version.parent() != Some(programs.as_path())
        || !version_name(hash)
    {
        return Err("Service executable is outside the protected sign-in installation".into());
    }
    validated(7);
    signin_files::verify_directory(version, availability::PUBLIC_ACL)?;
    validated(8);
    if binary_hash(executable)? != hash {
        return Err("Sign-in service binary integrity check failed".into());
    }
    validated(9);
    Ok(())
}
fn command_parts(command: &Path) -> Result<Vec<String>, HostError> {
    let value = wide(&command.to_string_lossy());
    let mut count = 0;
    let args = unsafe { CommandLineToArgvW(value.as_ptr(), &mut count) };
    if args.is_null() {
        return Err("Cannot parse sign-in service configuration".into());
    }
    let result = (|| -> Result<Vec<String>, HostError> {
        if count != 3 {
            return Err("Unexpected sign-in service command".into());
        }
        let mut out = Vec::new();
        for arg in unsafe { std::slice::from_raw_parts(args, count as usize) } {
            let mut len = 0;
            unsafe {
                while *arg.add(len) != 0 {
                    len += 1;
                }
            }
            out.push(unsafe { String::from_utf16(std::slice::from_raw_parts(*arg, len))? });
        }
        Ok(out)
    })();
    unsafe {
        LocalFree(args.cast());
    }
    result
}
fn validate_service(service: &Service, machine: &str) -> Result<PathBuf, HostError> {
    signin_files::verify_service(service)?;
    let config = service.query_config()?;
    let system = config.account_name.as_deref().is_some_and(|name| {
        let name = name.to_string_lossy();
        name.eq_ignore_ascii_case("LocalSystem")
            || name.eq_ignore_ascii_case("NT AUTHORITY\\SYSTEM")
    });
    if config.service_type != ServiceType::OWN_PROCESS || !system {
        return Err("Unexpected sign-in service identity/type; refusing to modify it".into());
    }
    let parts = command_parts(&config.executable_path)?;
    if parts[1] != "signin-service" || parts[2] != machine {
        return Err("Unexpected sign-in service command; refusing to modify it".into());
    }
    let binary = PathBuf::from(&parts[0]);
    validate_binary(machine, &binary)?;
    Ok(binary)
}

fn recovery_policy() -> ServiceFailureActions {
    let mut actions: Vec<_> = [5, 20, 60]
        .into_iter()
        .map(|seconds| ServiceAction {
            action_type: ServiceActionType::Restart,
            delay: Duration::from_secs(seconds),
        })
        .collect();
    // SCM repeats its final action. An explicit None prevents a restart loop.
    actions.push(ServiceAction {
        action_type: ServiceActionType::None,
        delay: Duration::ZERO,
    });
    ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(86400)),
        reboot_msg: Some(OsString::new()),
        command: Some(OsString::new()),
        actions: Some(actions),
    }
}
fn recovery_matches(actual: &ServiceFailureActions, non_crash: bool) -> bool {
    let expected = recovery_policy();
    !non_crash
        && actual.reset_period == expected.reset_period
        && actual.actions == expected.actions
        && actual.command.as_ref().is_none_or(|value| value.is_empty())
        && actual
            .reboot_msg
            .as_ref()
            .is_none_or(|value| value.is_empty())
}
fn stopped_code(failed: bool, intentional: bool) -> u32 {
    // Stop/Disable must not trigger recovery even if an older SCM flag setting
    // remains effective until reboot or durable Disable persistence failed.
    u32::from(failed && !intentional)
}
fn matches_bundle(installed: &Path, bundle: &Path) -> Result<bool, HostError> {
    let version = installed
        .parent()
        .and_then(|path| path.file_name())
        .and_then(|value| value.to_str())
        .filter(|value| version_name(value))
        .ok_or("Invalid installed sign-in version")?;
    reject_reparse(bundle)?;
    let metadata = fs::metadata(bundle)?;
    if !metadata.is_file() || metadata.len() > MAX_BINARY as u64 {
        return Err("Invalid bundled sign-in binary".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(bundle)?
        .take(MAX_BINARY as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_BINARY {
        return Err("Bundled sign-in binary exceeded its limit".into());
    }
    Ok(version == format!("{:x}", Sha256::digest(bytes)))
}
fn stop(service: &Service) -> Result<(), HostError> {
    let initial = service.query_status()?;
    // Hold a process handle before asking SCM to stop it: SCM can report
    // Stopped while the process is still unwinding and mapping its executable.
    // This handle is wait-only; never terminate a PID obtained from SCM.
    let process = if initial.current_state != ServiceState::Stopped {
        match initial.process_id.filter(|pid| *pid != 0) {
            Some(pid) => {
                let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
                if handle.is_null() {
                    if service.query_status()?.current_state != ServiceState::Stopped {
                        return Err(
                            "Cannot observe sign-in service exit; installed files were preserved"
                                .into(),
                        );
                    }
                    None
                } else {
                    Some(unsafe { OwnedHandle::from_raw_handle(handle) })
                }
            }
            None => None,
        }
    } else {
        None
    };
    let current = service.query_status()?.current_state;
    if current != ServiceState::Stopped && current != ServiceState::StopPending {
        service.stop()?;
    }
    let deadline = Instant::now() + Duration::from_secs(15);
    for _ in 0..150 {
        if service.query_status()?.current_state == ServiceState::Stopped {
            if let Some(process) = process {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if unsafe {
                    WaitForSingleObject(process.as_raw_handle(), remaining.as_millis() as u32)
                } != 0
                {
                    return Err("The sign-in service process has not exited; installed files were preserved".into());
                }
            }
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("The sign-in service has not stopped; installed files were preserved".into())
}

fn install(machine: &str, server: &str, owner: &str, enable: bool) -> Result<(), HostError> {
    require_admin()?;
    valid_machine(machine)?;
    valid_owner(owner)?;
    let server = validate_server(server)?.to_string();
    let (program_root, data_root) = roots()?;
    secure_directory(&program_root, availability::PUBLIC_ACL)?;
    secure_directory(&data_root, availability::PRIVATE_ACL)?;
    let (programs, data) = paths(machine)?;
    secure_directory(&programs, availability::PUBLIC_ACL)?;
    secure_directory(&data, availability::PRIVATE_ACL)?;
    let _maintenance = signin_files::maintenance_lock(&data.join("maintenance.lock"))?;
    let state = data.join("identity.dpapi");
    let key = if state.exists() {
        // Repair may recreate a missing public manifest, but never replaces the
        // machine key or requires the paired user's DPAPI identity in the service.
        let identity = private_identity(machine)?;
        if identity.server != server || identity.owner_sid != owner {
            return Err("Sign-in endpoint belongs to a different server/owner".into());
        }
        identity
    } else {
        if programs.join("public.json").exists() {
            return Err("The sign-in private identity is missing; restore or explicitly re-enroll instead of replacing it".into());
        }
        let value = MachineIdentity {
            version: 1,
            machine: machine.into(),
            server: server.clone(),
            owner_sid: owner.into(),
            secret: SigningKey::generate(&mut rand::rng()).to_bytes(),
        };
        let serialized = Zeroizing::new(serde_json::to_vec(&value)?);
        signin_files::create(
            &state,
            &credentials::protect_machine(&serialized)?,
            signin_files::PRIVATE_FILE,
        )?;
        value
    };
    let binding = PublicBinding {
        version: 1,
        machine: machine.into(),
        server,
        owner_sid: owner.into(),
        public_key: STANDARD.encode(
            SigningKey::from_bytes(&key.secret)
                .verifying_key()
                .as_bytes(),
        ),
    };
    signin_files::create(
        &programs.join("public.json"),
        &serde_json::to_vec(&binding)?,
        signin_files::PUBLIC_FILE,
    )?;
    let source = std::env::current_exe()?;
    reject_reparse(&source)?;
    if fs::metadata(&source)?.len() > MAX_BINARY as u64 {
        return Err("Sign-in service binary is too large".into());
    }
    let bytes = fs::read(source)?;
    let version = programs.join(format!("{:x}", Sha256::digest(&bytes)));
    secure_directory(&version, availability::PUBLIC_ACL)?;
    let executable = version.join("beacon-remote-agent.exe");
    signin_files::create(&executable, &bytes, signin_files::PUBLIC_FILE)?;
    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    )?;
    let info = ServiceInfo {
        name: name(machine).into(),
        display_name: format!("Beacon Remote sign-in endpoint ({})", &machine[..8]).into(),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: executable,
        launch_arguments: vec!["signin-service".into(), machine.into()],
        dependencies: vec![],
        account_name: None,
        account_password: None,
    };
    let service = match manager.open_service(
        name(machine),
        ServiceAccess::QUERY_CONFIG
            | ServiceAccess::QUERY_STATUS
            | ServiceAccess::STOP
            | ServiceAccess::CHANGE_CONFIG
            | ServiceAccess::START
            | ServiceAccess::READ_CONTROL,
    ) {
        Ok(service) => {
            validate_service(&service, machine)?;
            // Keep queued SCM recovery from racing maintenance. A partial
            // repair remains disabled until its protected configuration is ready.
            let mut maintenance = info.clone();
            maintenance.start_type = ServiceStartType::Disabled;
            service.change_config(&maintenance)?;
            stop(&service)?;
            service
        }
        Err(windows_service::Error::Winapi(error)) if error.raw_os_error() == Some(1060) => {
            let mut initial = info.clone();
            initial.start_type = ServiceStartType::OnDemand;
            let service = signin_files::with_administrator_owner(|| {
                Ok(manager.create_service(
                    &initial,
                    ServiceAccess::START
                        | ServiceAccess::QUERY_CONFIG
                        | ServiceAccess::CHANGE_CONFIG
                        | ServiceAccess::READ_CONTROL
                        | ServiceAccess::WRITE_DAC
                        | ServiceAccess::WRITE_OWNER,
                )?)
            })?;
            signin_files::protect_new_service(&service)?;
            validate_service(&service, machine)?;
            service
        }
        Err(error) => return Err(error.into()),
    };
    service.update_failure_actions(recovery_policy())?;
    service.set_failure_actions_on_non_crash_failures(false)?;
    if enable {
        // This elevated, explicit enable is separate from ordinary repair.
        // Existing service/process has stopped before clearing its latch.
        signin_revoke::reset(&programs.join("disabled.latch"))?;
        signin_revoke::enable(&programs.join("disabled.latch"))?;
    }
    service.change_config(&info)?;
    service.start::<&str>(&[])?;
    Ok(())
}

fn uninstall(machine: &str, owner: &str) -> Result<(), HostError> {
    require_admin()?;
    valid_machine(machine)?;
    valid_owner(owner)?;
    let binding = read_binding(machine)?;
    if binding.owner_sid != owner {
        return Err("Sign-in installation belongs to a different Windows owner".into());
    }
    let (programs, data) = paths(machine)?;
    secure_directory(&data, availability::PRIVATE_ACL)?;
    let maintenance = signin_files::maintenance_lock(&data.join("maintenance.lock"))?;
    // Preflight the whole bounded, nonrecursive deletion plan before changing SCM.
    let mut versions = Vec::new();
    let entries: Vec<_> = fs::read_dir(&programs)?
        .take(132)
        .collect::<Result<_, _>>()?;
    if entries.len() > 131 {
        return Err("Too many sign-in versions for bounded cleanup; files were preserved".into());
    }
    for entry in entries {
        if entry.file_name() == "public.json" {
            continue;
        }
        if entry.file_name() == "disabled.latch" {
            signin_revoke::validate(&entry.path())?;
            continue;
        }
        if entry.file_name() == "enabled.marker" {
            signin_revoke::validate_enable(&entry.path())?;
            continue;
        }
        let path = entry.path();
        reject_reparse(&path)?;
        if versions.len() >= 128 || !entry.file_name().to_str().is_some_and(version_name) {
            return Err("Unexpected sign-in installation content; files were preserved".into());
        }
        signin_files::verify_directory(&path, availability::PUBLIC_ACL)?;
        let contents: Vec<_> = fs::read_dir(&path)?.take(2).collect::<Result<_, _>>()?;
        if contents.len() != 1 || contents[0].file_name() != "beacon-remote-agent.exe" {
            return Err("Unexpected sign-in version content; files were preserved".into());
        }
        validate_binary(machine, &path.join("beacon-remote-agent.exe"))?;
        versions.push(path);
    }
    for entry in fs::read_dir(&data)?.take(4) {
        let path = entry?.path();
        if !matches!(
            path.file_name().and_then(|name| name.to_str()),
            Some("identity.dpapi" | "maintenance.lock")
        ) {
            return Err("Unexpected sign-in private state; files were preserved".into());
        }
        signin_files::verify(&path, signin_files::PRIVATE_FILE)?;
    }
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    match manager.open_service(
        name(machine),
        ServiceAccess::QUERY_CONFIG
            | ServiceAccess::QUERY_STATUS
            | ServiceAccess::STOP
            | ServiceAccess::DELETE
            | ServiceAccess::READ_CONTROL,
    ) {
        Ok(service) => {
            validate_service(&service, machine)?;
            stop(&service)?;
            service.delete()?;
        }
        Err(windows_service::Error::Winapi(error)) if error.raw_os_error() == Some(1060) => (),
        Err(error) => return Err(error.into()),
    }
    for version in versions {
        fs::remove_file(version.join("beacon-remote-agent.exe"))?;
        fs::remove_dir(version)?;
    }
    signin_revoke::remove_enable(&programs.join("disabled.latch"))?;
    signin_revoke::reset(&programs.join("disabled.latch"))?;
    fs::remove_file(programs.join("public.json"))?;
    fs::remove_dir(programs)?;
    let state = data.join("identity.dpapi");
    if state.exists() {
        fs::remove_file(state)?;
    }
    drop(maintenance);
    fs::remove_file(data.join("maintenance.lock"))?;
    fs::remove_dir(data)?;
    Ok(())
}

fn elevate(action: &str, machine: &str, server: &str, owner: &str) -> Result<(), HostError> {
    if !matches!(
        action,
        "signin-install" | "signin-install-enable" | "signin-uninstall"
    ) {
        return Err("Unsupported sign-in setup action".into());
    }
    valid_machine(machine)?;
    valid_owner(owner)?;
    let server = validate_server(server)?.to_string();
    let executable = wide(
        &std::env::current_exe()?
            .with_file_name("beacon-remote-agent.exe")
            .to_string_lossy(),
    );
    let parameters = wide(&format!("{action} {machine} \"{server}\" {owner}"));
    let verb = wide("runas");
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: verb.as_ptr(),
        lpFile: executable.as_ptr(),
        lpParameters: parameters.as_ptr(),
        nShow: 0,
        ..unsafe { std::mem::zeroed() }
    };
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        return Err("Windows administrator setup was cancelled or unavailable".into());
    }
    let result = unsafe { WaitForSingleObject(info.hProcess, u32::MAX) };
    let mut code = 1;
    let ok = unsafe { GetExitCodeProcess(info.hProcess, &mut code) };
    unsafe {
        CloseHandle(info.hProcess);
    }
    if result != 0 || ok == 0 || code != 0 {
        return Err(
            "Sign-in endpoint setup did not complete; existing identities were preserved".into(),
        );
    }
    Ok(())
}
fn bind(public: Option<&str>) -> Result<(), HostError> {
    let user = load_identity()?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let nonce = uuid::Uuid::new_v4().to_string();
    let message = format!(
        "beacon-remote:signin-binding:v1\n{}\n{timestamp}\n{nonce}\n{}",
        user.machine_id,
        public.unwrap_or("off")
    );
    let signature = STANDARD.encode(
        SigningKey::from_bytes(&user.secret_key)
            .sign(message.as_bytes())
            .to_bytes(),
    );
    let response = crate::client()?.post(validate_server(&user.server)?.join("/api/agent/signin-binding")?).json(&serde_json::json!({
        "version":1,"machineId":user.machine_id,"timestamp":timestamp,"nonce":nonce,"publicKey":public,"signature":signature })).send()?;
    if !response.status().is_success() {
        return Err(
            "The backend did not accept sign-in authority; no sign-in media is available".into(),
        );
    }
    Ok(())
}
pub fn setup() -> Result<(), HostError> {
    let user = load_identity()?;
    let policy = crate::local_access();
    if !policy.trusted || !policy.allow_control {
        return Err(
            "Enable unattended owner control locally before setting up sign-in access".into(),
        );
    }
    let owner = availability::current_sid()?;
    elevate(
        "signin-install-enable",
        &user.machine_id,
        &user.server,
        &owner,
    )?;
    let binding = read_binding(&user.machine_id)?;
    if binding.owner_sid != owner || binding.server != validate_server(&user.server)?.to_string() {
        return Err("The new sign-in binding does not match this pairing".into());
    }
    bind(Some(&binding.public_key))
}

/// Repair preserves the durable Disable marker and existing backend binding.
/// It never re-enables access; that requires the separate explicit setup action.
pub fn repair() -> Result<(), HostError> {
    if !status()?.installed {
        return Err("Set up sign-in access before repairing its service".into());
    }
    let user = load_identity()?;
    let owner = availability::current_sid()?;
    let binding = read_binding(&user.machine_id)?;
    if binding.owner_sid != owner || binding.server != validate_server(&user.server)?.to_string() {
        return Err("The sign-in binding does not match this pairing".into());
    }
    elevate("signin-install", &user.machine_id, &user.server, &owner)
}

/// One-way local disable, independent of backend reachability and UAC. SCM
/// validates the caller's INTERACTIVE/SYSTEM rights; this never raises access.
pub fn disable() -> Result<(), HostError> {
    if !crate::is_paired() {
        return Ok(());
    }
    let local = disable_machine(&load_identity()?.machine_id);
    // The service may already be stopped. Its owning user can also lower the
    // backend binding, after local teardown, without waiting to confirm locally.
    // Network failure never changes the local outcome or re-enables anything.
    let _ = bind(None);
    local
}
fn disable_machine(machine: &str) -> Result<(), HostError> {
    let (programs, _) = paths(machine)?;
    reject_reparse(&programs)?;
    if !programs.exists() {
        return Ok(());
    }
    read_binding(machine)?;
    let removed = request_disable(machine);
    // Removing this fixed non-secret marker is one-way under the protected
    // directory ACL and works even while SCM/the supervisor is stopped.
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = match manager.open_service(
        name(machine),
        ServiceAccess::QUERY_CONFIG
            | ServiceAccess::QUERY_STATUS
            | ServiceAccess::READ_CONTROL
            | ServiceAccess::USER_DEFINED_CONTROL,
    ) {
        Ok(service) => service,
        Err(windows_service::Error::Winapi(error)) if error.raw_os_error() == Some(1060) => {
            return removed
        }
        Err(error) => return Err(error.into()),
    };
    validate_service(&service, machine)?;
    if service.query_status()?.current_state != ServiceState::Running {
        return removed;
    }
    service.notify(UserEventCode::from_raw(signin_revoke::REQUEST)?)?;
    // REQUEST merely queues work. CONFIRM succeeds only after worker teardown
    // and a successful durable flush, not after seeing a partially written file.
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        match service.notify(UserEventCode::from_raw(signin_revoke::CONFIRM)?) {
            Ok(_) => return Ok(()),
            Err(windows_service::Error::Winapi(error)) if error.raw_os_error() == Some(997) => (),
            Err(error) => return Err(error.into()),
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("Persistent sign-in disable could not be confirmed; administrator removal is needed".into())
}
pub(crate) fn request_disable(machine: &str) -> Result<(), HostError> {
    valid_machine(machine)?;
    read_binding(machine)?;
    signin_revoke::remove_enable(&paths(machine)?.0.join("disabled.latch"))
}
pub fn remove() -> Result<(), HostError> {
    if !crate::is_paired() {
        return Ok(());
    }
    let user = load_identity()?;
    let (programs, _) = paths(&user.machine_id)?;
    reject_reparse(&programs)?;
    if !programs.exists() {
        return Ok(());
    }
    // Stop locally before any network wait or administrator prompt. Even if
    // durable disable cannot be confirmed, still allow administrator cleanup.
    let _ = disable_machine(&user.machine_id);
    let _ = bind(None);
    elevate(
        "signin-uninstall",
        &user.machine_id,
        &user.server,
        &availability::current_sid()?,
    )
}
pub fn remove_for_user(interactive: bool) -> Result<(), HostError> {
    let (root, _) = roots()?;
    reject_reparse(&root)?;
    if !root.exists() {
        return Ok(());
    }
    let owner = availability::current_sid()?;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        reject_reparse(&entry.path())?;
        let machine = entry.file_name().to_string_lossy().into_owned();
        if valid_machine(&machine).is_err() {
            return Err(
                "Unexpected sign-in installation directory; cleanup was not attempted".into(),
            );
        }
        let binding = read_binding(&machine)?;
        if binding.owner_sid != owner {
            continue;
        }
        let _ = disable_machine(&machine);
        if !interactive {
            return Err("Installed sign-in access needs an interactive uninstall with Windows administrator approval".into());
        }
        elevate("signin-uninstall", &machine, &binding.server, &owner)?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub installed: bool,
    pub automatic: bool,
    pub running: bool,
    pub locally_disabled: bool,
    pub media_ready: bool,
    pub media_supported: bool,
    pub service_matches_build: Option<bool>,
    pub recovery_configured: bool,
}
impl Status {
    /// None means comparison is unavailable, never a healthy version claim.
    pub fn needs_repair(&self) -> Option<bool> {
        if !self.installed {
            Some(false)
        } else if self.service_matches_build == Some(false) || !self.recovery_configured {
            Some(true)
        } else {
            self.service_matches_build.map(|_| false)
        }
    }
}
pub fn status() -> Result<Status, HostError> {
    let absent = || Status {
        installed: false,
        automatic: false,
        running: false,
        locally_disabled: false,
        media_ready: false,
        media_supported: cfg!(feature = "signin-media"),
        service_matches_build: None,
        recovery_configured: false,
    };
    if !crate::is_paired() {
        return Ok(absent());
    }
    let user = load_identity()?;
    let (programs, _) = paths(&user.machine_id)?;
    reject_reparse(&programs)?;
    if !programs.exists() {
        return Ok(absent());
    }
    let binding = read_binding(&user.machine_id)?;
    if binding.owner_sid != availability::current_sid()?
        || binding.server != validate_server(&user.server)?.to_string()
    {
        return Err("Sign-in endpoint belongs to a different pairing".into());
    }
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    match manager.open_service(
        name(&user.machine_id),
        ServiceAccess::QUERY_CONFIG | ServiceAccess::QUERY_STATUS | ServiceAccess::READ_CONTROL,
    ) {
        Ok(service) => {
            let installed = validate_service(&service, &user.machine_id)?;
            let bundle = std::env::current_exe()?.with_file_name("beacon-remote-agent.exe");
            let service_matches_build = matches_bundle(&installed, &bundle).ok();
            let recovery_configured = service
                .get_failure_actions()
                .ok()
                .zip(service.get_failure_actions_on_non_crash_failures().ok())
                .is_some_and(|(policy, non_crash)| recovery_matches(&policy, non_crash));
            Ok(Status {
                installed: true,
                automatic: service.query_config()?.start_type == ServiceStartType::AutoStart,
                running: service.query_status()?.current_state == ServiceState::Running,
                locally_disabled: signin_revoke::blocked(&programs.join("disabled.latch"))?,
                media_ready: false,
                media_supported: cfg!(feature = "signin-media"),
                service_matches_build,
                recovery_configured,
            })
        }
        Err(windows_service::Error::Winapi(error)) if error.raw_os_error() == Some(1060) => {
            Ok(absent())
        }
        Err(error) => Err(error.into()),
    }
}

fn send_local_disable(
    http: &reqwest::blocking::Client,
    server: &reqwest::Url,
    machine: &str,
    key: &SigningKey,
) -> Result<(), HostError> {
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let nonce = uuid::Uuid::new_v4().to_string();
    let message = format!("beacon-remote:signin-disable:v1\n{machine}\n{timestamp}\n{nonce}");
    let response = http
        .post(server.join("/api/signin/disable")?)
        .json(&serde_json::json!({
            "version":1,"machineId":machine,"timestamp":timestamp,"nonce":nonce,
            "signature": STANDARD.encode(key.sign(message.as_bytes()).to_bytes())
        }))
        .send()?;
    if !response.status().is_success() {
        return Err("Backend Disable was not acknowledged".into());
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Ack {
        ok: bool,
    }
    let mut bytes = Vec::new();
    response.take(4097).read_to_end(&mut bytes)?;
    if bytes.len() > 4096 || !serde_json::from_slice::<Ack>(&bytes).is_ok_and(|ack| ack.ok) {
        return Err("Backend Disable acknowledgement was invalid".into());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HeartbeatAck {
    ok: bool,
    #[serde(default)]
    media_enabled: bool,
}
fn heartbeat_ack(bytes: &[u8]) -> Option<bool> {
    if bytes.len() > 4096 {
        return None;
    }
    serde_json::from_slice::<HeartbeatAck>(bytes)
        .ok()
        .filter(|ack| ack.ok)
        .map(|ack| ack.media_enabled)
}
fn signed_in_console(info: &WTSINFOEXW, session: u32) -> bool {
    info.Level == 1
        && unsafe {
            let state = &info.Data.WTSInfoExLevel1;
            state.SessionId == session
                && state.SessionFlags == 1
                && state.SessionState == windows_sys::Win32::System::RemoteDesktop::WTSActive
                && state.UserName[0] != 0
        }
}
fn console() -> Option<(u32, &'static str)> {
    let session =
        unsafe { windows_sys::Win32::System::RemoteDesktop::WTSGetActiveConsoleSessionId() };
    if session == 0 || session == u32::MAX {
        return None;
    }
    let mut buffer = null_mut();
    let mut length = 0;
    if unsafe {
        WTSQuerySessionInformationW(
            null_mut(),
            session,
            WTSSessionInfoEx,
            &mut buffer,
            &mut length,
        )
    } == 0
    {
        return Some((session, "unavailable"));
    }
    let state = if length as usize >= std::mem::size_of::<WTSINFOEXW>() {
        let info = unsafe { &*buffer.cast::<WTSINFOEXW>() };
        if signed_in_console(info, session) {
            "signed-in"
        } else {
            "unavailable"
        }
    } else {
        "unavailable"
    };
    unsafe {
        WTSFreeMemory(buffer.cast());
    }
    Some((session, state))
}
fn attempt_handoff(
    active: &mut crate::signin_worker::Worker,
    http: &reqwest::blocking::Client,
    server: &reqwest::Url,
    machine: &str,
    key: &SigningKey,
    cancel: &AtomicBool,
    revoke: &signin_revoke::LocalRevoke,
) -> Result<(), HostError> {
    let Some(retired) = active.retire_for_handoff() else {
        return Ok(());
    };
    // WTS notifications and desktop loss can precede the unlocked flag. End
    // SYSTEM authority first, then allow a short bounded observation window.
    let until = Instant::now() + Duration::from_millis(1500);
    while !cancel.load(Ordering::Acquire)
        && !revoke.pending()?
        && crate::signin_scope::tick() < retired.deadline
    {
        match console() {
            Some((session, "signed-in")) if session == retired.console => {
                if cancel.load(Ordering::Acquire)
                    || revoke.pending()?
                    || crate::signin_scope::tick() >= retired.deadline
                {
                    return Ok(());
                }
                let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
                let nonce = uuid::Uuid::new_v4().to_string();
                let message = format!(
                    "beacon-remote:signin-handoff:v1\n{machine}\n{timestamp}\n{nonce}\n{}\n{}\n{}",
                    retired.lease, retired.instance, retired.console
                );
                let _=http.post(server.join("/api/signin/handoff")?).json(&serde_json::json!({
                    "version":1,"machineId":machine,"timestamp":timestamp,"nonce":nonce,
                    "leaseId":retired.lease,"instanceId":retired.instance,"consoleSessionId":retired.console,
                    "signature":STANDARD.encode(key.sign(message.as_bytes()).to_bytes()),
                })).send();
                return Ok(());
            }
            Some((session, _)) if session != retired.console => return Ok(()),
            _ => {}
        }
        if Instant::now() >= until {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Ok(())
}
define_windows_service!(ffi_signin, service_main);
fn service_main(_: Vec<OsString>) {
    if let Err(error) = run_service() {
        if let Some(machine) = MACHINE.get() {
            diag(machine, &format!("supervisor stopped: {error}"));
        }
    }
}

/// Appends one line to the supervisor's protected log (SYSTEM and Administrators only, capped at 32 KiB).
/// Errors and states only: never grants, keys, pixels, input or credentials.
pub(crate) fn diag(machine: &str, line: &str) {
    // A repeating condition is recorded once, not every retry.
    static LAST: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
    if let Ok(mut last) = LAST.lock() {
        if *last == line {
            return;
        }
        last.clear();
        last.push_str(line);
    }
    let Ok((_, data)) = paths(machine) else {
        return;
    };
    let path = data.join("supervisor.log");
    if fs::metadata(&path).is_ok_and(|meta| meta.len() >= 32 * 1024) {
        return;
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        use std::io::Write;
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs());
        let _ = writeln!(file, "{seconds} {line}");
    }
}
fn run_service() -> Result<(), HostError> {
    if availability::current_sid()? != "S-1-5-18" {
        return Err("The sign-in endpoint requires its installed SYSTEM service identity".into());
    }
    let mut session = u32::MAX;
    if unsafe { ProcessIdToSessionId(std::process::id(), &mut session) } == 0 || session != 0 {
        return Err("The sign-in supervisor must run in Session 0".into());
    }
    let machine = MACHINE.get().ok_or("Missing sign-in service machine")?;
    let revoke = Arc::new(signin_revoke::LocalRevoke::new(
        paths(machine)?.0.join("disabled.latch"),
    ));
    let local_revoke = revoke.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    let stopping = cancel.clone();
    let session_epoch = Arc::new(AtomicU64::new(0));
    let changed_session = session_epoch.clone();
    let handle = service_control_handler::register(name(machine), move |event| match event {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            stopping.store(true, Ordering::Release);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::SessionChange(_) => {
            changed_session.fetch_add(1, Ordering::AcqRel);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        ServiceControl::UserEvent(code) => match local_revoke.control(code.to_raw()) {
            Some(0) => ServiceControlHandlerResult::NoError,
            Some(code) => ServiceControlHandlerResult::Other(code),
            None => ServiceControlHandlerResult::NotImplemented,
        },
        _ => ServiceControlHandlerResult::NotImplemented,
    })?;
    let status = |state, code| ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: if state == ServiceState::Running {
            ServiceControlAccept::STOP
                | ServiceControlAccept::SHUTDOWN
                | ServiceControlAccept::SESSION_CHANGE
        } else {
            ServiceControlAccept::empty()
        },
        exit_code: ServiceExitCode::Win32(code),
        checkpoint: 0,
        wait_hint: Duration::ZERO,
        process_id: None,
    };
    handle.set_service_status(status(ServiceState::Running, 0))?;
    let result = (|| -> Result<(), HostError> {
        let identity = identity(machine)?;
        validate_binary(machine, &std::env::current_exe()?)?;
        let server = validate_server(&identity.server)?;
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(3))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        let key = SigningKey::from_bytes(&identity.secret);
        let instance = uuid::Uuid::new_v4().to_string();
        let mut acknowledged = false;
        let mut ever_acknowledged = false;
        let mut worker: Option<crate::signin_worker::Worker> = None;
        let mut observed_epoch = session_epoch.load(Ordering::Acquire);
        let mut next_launch = Instant::now();
        let mut last_launch_error = String::new();
        let mut last_ack_note = String::new();
        let mut next_heartbeat = Instant::now();
        let mut disable_acknowledged = false;
        let mut next_disable = Instant::now();
        while !cancel.load(Ordering::Acquire) {
            if revoke.pending()? {
                // A locally disabled worker may keep its Retry window while
                // its bounded media teardown completes. It cannot accept any
                // new authorization. Unconfirmed/stalled cleanup is terminated.
                let retain = worker.as_mut().is_some_and(|active| {
                    active.disable_requested()
                        && active.retain_disabled_ui()
                        && active.probe().is_ok()
                });
                if !retain {
                    worker.take();
                }
                if worker
                    .as_ref()
                    .is_none_or(|active| active.cleanup_confirmed())
                    && revoke.persist().is_ok()
                {
                    worker.take();
                }
                // Failed persistence never resumes a worker or confirms saved
                // disable. The request is latched independently of marker I/O.
                // Lower remote reservations/transitions independently of disk
                // persistence. This purpose cannot enable access, and retries
                // do not require a live worker or the ordinary user's secret.
                if !disable_acknowledged && Instant::now() >= next_disable {
                    disable_acknowledged =
                        send_local_disable(&http, &server, machine, &key).is_ok();
                    next_disable = Instant::now() + Duration::from_secs(5);
                }
                crate::pause(&cancel, Duration::from_millis(500));
                continue;
            }
            let epoch = session_epoch.load(Ordering::Acquire);
            if worker.as_ref().is_some_and(|active| {
                epoch != observed_epoch || console() == Some((active.console, "signed-in"))
            }) {
                if let Some(active) = worker.as_mut() {
                    attempt_handoff(active, &http, &server, machine, &key, &cancel, &revoke)?;
                }
                worker.take();
                next_heartbeat = Instant::now();
            }
            if epoch != observed_epoch {
                worker.take();
                observed_epoch = epoch;
                next_heartbeat = Instant::now();
            }
            let probe_error = worker.as_mut().and_then(|active| active.probe().err());
            let failed = probe_error.is_some();
            if worker
                .as_ref()
                .is_some_and(|active| active.disable_requested())
            {
                revoke.request();
                continue;
            }
            if failed {
                if let Some(active) = worker.as_ref() {
                    diag(
                        machine,
                        &format!(
                            "worker ended: {} (probe: {})",
                            active.exit_status().map_or_else(
                                || "still running but not answering".to_owned(),
                                |code| format!("exit status {code:#010x}")
                            ),
                            probe_error
                                .as_ref()
                                .map_or_else(|| "none".to_owned(), ToString::to_string)
                        ),
                    );
                }
                if let Some(active) = worker.as_mut() {
                    attempt_handoff(active, &http, &server, machine, &key, &cancel, &revoke)?;
                }
                worker.take();
                next_launch = Instant::now() + Duration::from_secs(5);
                next_heartbeat = Instant::now();
            }
            if worker
                .as_ref()
                .is_some_and(|active| active.attention_pending())
            {
                next_heartbeat = Instant::now();
            }
            // Retirement can forward a final Disable after the last ordinary
            // probe. Observe it before any launch or new heartbeat.
            if revoke.pending()? {
                continue;
            }
            if acknowledged
                && worker.is_none()
                && Instant::now() >= next_launch
                && crate::signin_worker::locked_console().is_some()
            {
                match crate::signin_worker::Worker::start(machine, revoke.clone()) {
                    Ok(active) if !cancel.load(Ordering::Acquire) => {
                        worker = Some(active);
                        next_heartbeat = Instant::now();
                    }
                    Ok(_) => break,
                    Err(error) => {
                        let text = error.to_string();
                        if text != last_launch_error {
                            diag(machine, &format!("worker launch failed: {text}"));
                            last_launch_error = text;
                        }
                        next_launch = Instant::now() + Duration::from_secs(5);
                    }
                }
            }
            if Instant::now() >= next_heartbeat {
                if let Some((console, mut state)) = console() {
                    // A console switch/unlock can happen during the previous
                    // probe. Never publish that worker under another console.
                    if worker.as_ref().is_some_and(|active| {
                        active.console != console
                            || crate::signin_worker::locked_console() != Some(console)
                            || session_epoch.load(Ordering::Acquire) != observed_epoch
                    }) {
                        worker.take();
                    }
                    if revoke.pending()? {
                        continue;
                    }
                    let active_instance = worker
                        .as_ref()
                        .map_or(instance.as_str(), |active| active.instance.as_str());
                    if worker.is_some() {
                        state = "sign-in";
                    }
                    let timestamp =
                        SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
                    let nonce = uuid::Uuid::new_v4().to_string();
                    let worker_public_key = worker.as_ref().map(|active| active.public_key());
                    // A fresh private probe is connection readiness, not physical
                    // capture/input acceptance. Default builds cannot report it.
                    let worker_ready = worker.as_ref().is_some_and(|active| active.media_ready());
                    let readiness = if worker_ready { "ready" } else { "unavailable" };
                    let message = format!("beacon-remote:signin-heartbeat:v2\n{machine}\n{timestamp}\n{nonce}\n{active_instance}\n{console}\n{state}\n{readiness}\n{}",worker_public_key.unwrap_or("off"));
                    let response = http.post(server.join("/api/signin/heartbeat")?).json(&serde_json::json!({"version":1,"machineId":machine,"timestamp":timestamp,"nonce":nonce,
                    "instanceId":active_instance,"consoleSessionId":console,"state":state,"workerReady":worker_ready,"workerPublicKey":worker_public_key,"signature":STANDARD.encode(key.sign(message.as_bytes()).to_bytes())})).send();
                    acknowledged = false;
                    let mut media_allowed = false;
                    if let Ok(response) = response {
                        if ever_acknowledged
                            && matches!(response.status().as_u16(), 401 | 403 | 410)
                        {
                            break;
                        }
                        if response.status().is_success() {
                            let mut body = Vec::new();
                            if response.take(4097).read_to_end(&mut body).is_ok()
                                && body.len() <= 4096
                            {
                                if let Some(allowed) = heartbeat_ack(&body) {
                                    acknowledged = true;
                                    media_allowed = allowed;
                                }
                            }
                        }
                    }
                    ever_acknowledged |= acknowledged;
                    let note = format!(
                        "heartbeat console {console} state {state} acknowledged {acknowledged} worker {} | {}",
                        worker.is_some(),
                        crate::signin_worker::console_probe()
                    );
                    if note != last_ack_note {
                        diag(machine, &note);
                        last_ack_note = note;
                    }
                    if !acknowledged {
                        worker.take();
                    } else if let Some(active) = worker.as_mut().filter(|_| media_allowed) {
                        let failed = active
                            .refresh_lease(&http, &server, &key, machine, || {
                                !cancel.load(Ordering::Acquire)
                                    && session_epoch.load(Ordering::Acquire) == observed_epoch
                                    && revoke.pending().is_ok_and(|pending| !pending)
                            })
                            .is_err();
                        if active.disable_requested() {
                            revoke.request();
                        } else if failed {
                            worker.take();
                            next_launch = Instant::now() + Duration::from_secs(5);
                        }
                    }
                } else {
                    worker.take();
                    acknowledged = false;
                }
                next_heartbeat = Instant::now() + Duration::from_secs(5);
            }
            crate::pause(&cancel, Duration::from_millis(500));
        }
        drop(worker);
        if revoke.pending()? {
            let persisted = revoke.persist();
            // Retirement can forward a final Disable during service shutdown.
            // Try remote invalidation even when disk persistence has failed.
            if !disable_acknowledged {
                let _ = send_local_disable(&http, &server, machine, &key);
            }
            persisted?;
        }
        Ok(())
    })();
    handle.set_service_status(status(
        ServiceState::Stopped,
        stopped_code(
            result.is_err(),
            cancel.load(Ordering::Acquire) || revoke.requested(),
        ),
    ))?;
    result
}

pub fn command(arguments: &[String]) -> Option<Result<(), HostError>> {
    match arguments.get(1).map(String::as_str) {
        Some("signin-setup") if arguments.len() == 2 => Some((|| {
            setup()?;
            println!(
                "{}",
                if cfg!(feature = "signin-media") {
                    "Separate sign-in service prepared. Check your workspace for current connection availability."
                } else {
                    "Separate sign-in service prepared. Sign-in media is not enabled in this build."
                }
            );
            Ok(())
        })()),
        Some("signin-remove") if arguments.len() == 2 => Some(remove()),
        Some("signin-repair") if arguments.len() == 2 => Some(repair()),
        Some("signin-disable") if arguments.len() == 2 => Some(disable()),
        Some("signin-status") if arguments.len() == 2 => Some((|| {
            println!("{}", serde_json::to_string(&status()?)?);
            Ok(())
        })()),
        Some("signin-remove-local")
            if arguments.len() == 2 || (arguments.len() == 3 && arguments[2] == "--silent") =>
        {
            Some(remove_for_user(
                !arguments.iter().any(|arg| arg == "--silent"),
            ))
        }
        Some("signin-install") if arguments.len() == 5 => {
            Some(install(&arguments[2], &arguments[3], &arguments[4], false))
        }
        Some("signin-install-enable") if arguments.len() == 5 => {
            Some(install(&arguments[2], &arguments[3], &arguments[4], true))
        }
        Some("signin-uninstall") if arguments.len() == 5 => {
            Some(uninstall(&arguments[2], &arguments[4]))
        }
        Some("signin-service") if arguments.len() == 3 => Some((|| {
            valid_machine(&arguments[2])?;
            MACHINE
                .set(arguments[2].clone())
                .map_err(|_| "Sign-in service already initialized")?;
            service_dispatcher::start(name(&arguments[2]), ffi_signin)?;
            Ok(())
        })()),
        Some("signin-worker") => Some(crate::signin_worker::run_as_process(arguments)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn recovery_is_bounded_crash_only_and_cannot_run_commands_or_reboot() {
        let mut policy = super::recovery_policy();
        let actions = policy.actions.as_ref().unwrap();
        assert!(actions.len() <= 4);
        assert!(actions.iter().all(|action| matches!(
            action.action_type,
            super::ServiceActionType::None | super::ServiceActionType::Restart
        )));
        assert!(actions
            .iter()
            .filter(|action| action.action_type == super::ServiceActionType::Restart)
            .all(
                |action| (Duration::from_secs(5)..=Duration::from_secs(60)).contains(&action.delay)
            ));
        assert!(super::recovery_matches(&policy, false));
        assert!(!super::recovery_matches(&policy, true));
        assert_eq!(
            policy.actions.as_ref().unwrap().last().unwrap().action_type,
            super::ServiceActionType::None
        );
        policy.actions.as_mut().unwrap().pop();
        assert!(
            !super::recovery_matches(&policy, false),
            "a repeating final Restart is not our bounded policy"
        );
        let mut policy = super::recovery_policy();
        policy.command = Some("unexpected command".into());
        assert!(!super::recovery_matches(&policy, false));
        assert_eq!(
            super::stopped_code(true, true),
            0,
            "failed persistence during explicit Stop/Disable must stay stopped"
        );
        assert_eq!(super::stopped_code(false, false), 0);
        assert_eq!(
            super::stopped_code(true, false),
            1,
            "unhandled intent still retains its handled-error diagnostic"
        );
    }
    #[test]
    fn bundle_comparison_detects_upgrade_and_rollback_without_touching_service() {
        use sha2::{Digest, Sha256};
        let folder =
            std::env::temp_dir().join(format!("beacon-signin-version-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&folder).unwrap();
        let bundle = folder.join("beacon-remote-agent.exe");
        let original = b"owned fixture version one";
        std::fs::write(&bundle, original).unwrap();
        let installed = folder
            .join(format!("{:x}", Sha256::digest(original)))
            .join("beacon-remote-agent.exe");
        assert!(super::matches_bundle(&installed, &bundle).unwrap());
        std::fs::write(&bundle, b"owned fixture version two").unwrap();
        assert!(!super::matches_bundle(&installed, &bundle).unwrap());
        std::fs::write(&bundle, original).unwrap();
        assert!(super::matches_bundle(&installed, &bundle).unwrap());
        std::fs::remove_file(&bundle).unwrap();
        assert!(
            super::matches_bundle(&installed, &bundle).is_err(),
            "missing package is unknown, not matching"
        );
        std::fs::remove_dir(folder).unwrap();
    }
    #[test]
    fn presence_acknowledgement_does_not_implicitly_enable_media() {
        assert_eq!(super::heartbeat_ack(br#"{"ok":true}"#), Some(false));
        assert_eq!(
            super::heartbeat_ack(br#"{"ok":true,"mediaEnabled":false}"#),
            Some(false)
        );
        assert_eq!(
            super::heartbeat_ack(br#"{"ok":true,"mediaEnabled":true}"#),
            Some(true)
        );
        for bytes in [
            br#"{"ok":false,"mediaEnabled":true}"#.as_slice(),
            br#"{"ok":true,"mediaEnabled":"true"}"#,
            br#"{"ok":true,"mediaEnabled":true,"launch":true}"#,
            br#"{"mediaEnabled":true}"#,
        ] {
            assert_eq!(super::heartbeat_ack(bytes), None);
        }
        assert_eq!(super::heartbeat_ack(&[b' '; 4097]), None);
    }
    #[test]
    fn local_disable_uses_only_separate_signed_purpose_and_strict_bounded_ack() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let machine = uuid::Uuid::new_v4().to_string();
        let key = ed25519_dalek::SigningKey::from_bytes(&[7u8; 32]);
        let mut nonces = std::collections::HashSet::new();
        for (status, body, accepted) in [
            (200, "{\"ok\":true}".to_string(), true),
            (200, "{\"ok\":false}".to_string(), false),
            (200, "{\"ok\":true,\"ready\":true}".to_string(), false),
            (200, " ".repeat(4097), false),
            (503, "{\"ok\":true}".to_string(), false),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let server =
                reqwest::Url::parse(&format!("http://{}/", listener.local_addr().unwrap()))
                    .unwrap();
            let receiver = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                let header_end = loop {
                    let mut byte = [0u8; 1];
                    stream.read_exact(&mut byte).unwrap();
                    bytes.push(byte[0]);
                    assert!(bytes.len() < 4096);
                    if bytes.ends_with(b"\r\n\r\n") {
                        break bytes.len();
                    }
                };
                let headers = String::from_utf8(bytes.clone()).unwrap();
                assert!(headers.starts_with("POST /api/signin/disable HTTP/1.1\r\n"));
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|length| length.trim().parse::<usize>().unwrap())
                    })
                    .unwrap();
                assert!(length < 4096);
                bytes.resize(header_end + length, 0);
                stream.read_exact(&mut bytes[header_end..]).unwrap();
                write!(stream,"HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
                serde_json::from_slice::<serde_json::Value>(&bytes[header_end..]).unwrap()
            });
            let http = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(3))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap();
            assert_eq!(
                super::send_local_disable(&http, &server, &machine, &key).is_ok(),
                accepted
            );
            let value = receiver.join().unwrap();
            assert_eq!(value.as_object().unwrap().len(), 5);
            assert_eq!(value["machineId"], machine);
            assert_eq!(value["version"], 1);
            let nonce = value["nonce"].as_str().unwrap();
            assert!(nonces.insert(nonce.to_string()));
            let timestamp = value["timestamp"].as_u64().unwrap();
            let message =
                format!("beacon-remote:signin-disable:v1\n{machine}\n{timestamp}\n{nonce}");
            use base64::Engine;
            let signature = base64::engine::general_purpose::STANDARD
                .decode(value["signature"].as_str().unwrap())
                .unwrap();
            key.verifying_key()
                .verify_strict(
                    message.as_bytes(),
                    &ed25519_dalek::Signature::from_slice(&signature).unwrap(),
                )
                .unwrap();
        }
    }
    #[test]
    fn unlock_observation_requires_exact_active_session_and_a_logged_on_user() {
        let mut info = super::WTSINFOEXW {
            Level: 1,
            ..Default::default()
        };
        unsafe {
            let state = &mut info.Data.WTSInfoExLevel1;
            state.SessionId = 7;
            state.SessionState = windows_sys::Win32::System::RemoteDesktop::WTSActive;
            state.SessionFlags = 1;
            state.UserName[0] = b'x' as u16;
        }
        assert!(super::signed_in_console(&info, 7));
        assert!(!super::signed_in_console(&info, 8));
        unsafe {
            info.Data.WTSInfoExLevel1.UserName[0] = 0;
        }
        assert!(!super::signed_in_console(&info, 7));
        unsafe {
            info.Data.WTSInfoExLevel1.UserName[0] = b'x' as u16;
            info.Data.WTSInfoExLevel1.SessionFlags = 0;
        }
        assert!(!super::signed_in_console(&info, 7));
        info.Data.WTSInfoExLevel1.SessionFlags = 1;
        info.Data.WTSInfoExLevel1.SessionState =
            windows_sys::Win32::System::RemoteDesktop::WTSDisconnected;
        assert!(!super::signed_in_console(&info, 7));
        info.Level = 0;
        assert!(!super::signed_in_console(&info, 7));
    }
    use super::*;
    #[test]
    fn installer_scope_rejects_paths_commands_and_invalid_owners_without_machine_actions() {
        assert!(valid_machine("../other").is_err());
        assert!(valid_machine("00000000-0000-0000-0000-000000000000").is_err());
        assert!(valid_machine(&uuid::Uuid::new_v4().to_string()).is_ok());
        assert!(valid_owner("S-1-5-18 --anything").is_err());
        assert!(valid_owner("S-1--123").is_err());
        assert!(valid_owner("S-1-5-18").is_ok());
        assert!(!version_name("../anything"));
        assert!(version_name(&"a".repeat(64)));
        let command = PathBuf::from(
            r#""C:\Program Files\Beacon Remote Sign-in\test\beacon-remote-agent.exe" signin-service machine"#,
        );
        assert_eq!(command_parts(&command).unwrap()[1], "signin-service");
        assert!(command_parts(Path::new(r#""C:\safe.exe" signin-service machine extra"#)).is_err());
    }
}
