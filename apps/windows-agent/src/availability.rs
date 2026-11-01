//! Boot presence only. This service has no capture, input, session or process-launch authority.
use crate::{client, credentials, load_identity, validate_server, HostError};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    ptr::null_mut,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use windows_service::{
    define_windows_service,
    service::{
        ServiceAccess, ServiceControl, ServiceControlAccept, ServiceErrorControl, ServiceExitCode,
        ServiceInfo, ServiceStartType, ServiceState, ServiceStatus, ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
    service_manager::{ServiceManager, ServiceManagerAccess},
};
use windows_sys::{
    core::GUID,
    Win32::{
        Foundation::{CloseHandle, GetLastError, LocalFree, ERROR_ALREADY_EXISTS, HANDLE},
        Security::{
            Authorization::{
                ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertSidToStringSidW,
                ConvertStringSecurityDescriptorToSecurityDescriptorW,
            },
            GetFileSecurityW, GetTokenInformation, TokenUser, SECURITY_ATTRIBUTES, TOKEN_QUERY,
            TOKEN_USER,
        },
        Storage::FileSystem::CreateDirectoryW,
        System::{
            Com::CoTaskMemFree,
            RemoteDesktop::*,
            Threading::{
                GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, WaitForSingleObject,
            },
        },
        UI::Shell::{
            SHGetKnownFolderPath, ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
        },
    },
};
use zeroize::Zeroize;

const PRIVATE_ACL: &str = "O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";
// Explicit file read/execute bits: Windows maps generic GR/GX at creation, which
// would make an otherwise exact descriptor comparison reject its own directory.
const PUBLIC_ACL: &str = "O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)";
const SECURITY: u32 = 1 | 2 | 4; // owner, group, DACL
static MACHINE: OnceLock<String> = OnceLock::new();
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
fn name(machine: &str) -> String {
    format!("BeaconRemoteAvailability-{machine}")
}
fn valid_machine(machine: &str) -> Result<(), HostError> {
    uuid::Uuid::parse_str(machine)?;
    Ok(())
}

fn known_folder(id: &GUID) -> Result<PathBuf, HostError> {
    let mut raw = null_mut();
    if unsafe { SHGetKnownFolderPath(id, 0, null_mut(), &mut raw) } < 0 {
        return Err("Windows folder unavailable".into());
    }
    let path = unsafe {
        let mut len = 0;
        while *raw.add(len) != 0 {
            len += 1;
        }
        PathBuf::from(String::from_utf16_lossy(std::slice::from_raw_parts(
            raw, len,
        )))
    };
    unsafe {
        CoTaskMemFree(raw.cast());
    }
    Ok(path)
}
fn roots() -> Result<(PathBuf, PathBuf), HostError> {
    use windows_sys::Win32::UI::Shell::{FOLDERID_ProgramData, FOLDERID_ProgramFiles};
    Ok((
        known_folder(&FOLDERID_ProgramFiles)?.join("Beacon Remote Availability"),
        known_folder(&FOLDERID_ProgramData)?.join("BeaconRemoteAvailability"),
    ))
}
fn reject_reparse(path: &Path) -> Result<(), HostError> {
    use std::os::windows::fs::MetadataExt;
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if meta.file_attributes() & 0x400 != 0 => {
                return Err("Availability paths must not contain reparse points".into())
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}
unsafe fn descriptor_string(sd: *mut std::ffi::c_void) -> Result<String, HostError> {
    let mut output = null_mut();
    if ConvertSecurityDescriptorToStringSecurityDescriptorW(
        sd,
        1,
        SECURITY,
        &mut output,
        null_mut(),
    ) == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut len = 0;
    while *output.add(len) != 0 {
        len += 1;
    }
    let value = String::from_utf16_lossy(std::slice::from_raw_parts(output, len));
    LocalFree(output.cast());
    Ok(value)
}
// Atomic creation with an exact protected ACL; reject pre-created or modified directories.
fn secure_directory(path: &Path, acl: &str) -> Result<(), HostError> {
    reject_reparse(path)?;
    unsafe {
        let mut sd = null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide(acl).as_ptr(),
            1,
            &mut sd,
            null_mut(),
        ) == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let result = (|| -> Result<(), HostError> {
            let attributes = SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: sd,
                bInheritHandle: 0,
            };
            let path_wide = wide(&path.to_string_lossy());
            if CreateDirectoryW(path_wide.as_ptr(), &attributes) == 0
                && GetLastError() != ERROR_ALREADY_EXISTS
            {
                return Err(std::io::Error::last_os_error().into());
            }
            reject_reparse(path)?;
            let mut needed = 0;
            GetFileSecurityW(path_wide.as_ptr(), SECURITY, null_mut(), 0, &mut needed);
            let mut current = vec![0u8; needed as usize];
            if GetFileSecurityW(
                path_wide.as_ptr(),
                SECURITY,
                current.as_mut_ptr().cast(),
                needed,
                &mut needed,
            ) == 0
            {
                return Err(std::io::Error::last_os_error().into());
            }
            // Windows may add the auto-inheritance bookkeeping flag to a protected ACL at creation.
            // Compare the complete owner/group/ACE list; only that non-authorizing flag is ignored.
            if descriptor_string(current.as_mut_ptr().cast())?.replace("D:PAI", "D:P")
                != descriptor_string(sd)?.replace("D:PAI", "D:P")
            {
                return Err(
                    "Availability directory permissions changed; refusing to use it".into(),
                );
            }
            Ok(())
        })();
        LocalFree(sd);
        result
    }
}

#[derive(Serialize, Deserialize)]
struct BootIdentity {
    machine: String,
    server: String,
    owner_sid: String,
    secret: [u8; 32],
}
impl Drop for BootIdentity {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}
#[derive(Serialize, Deserialize)]
struct PublicBinding {
    machine: String,
    server: String,
    public_key: String,
    owner_sid: String,
}

unsafe fn sid_of_token(token: HANDLE) -> Result<String, HostError> {
    let mut len = 0;
    GetTokenInformation(token, TokenUser, null_mut(), 0, &mut len);
    let mut buffer = vec![0u8; len as usize];
    if GetTokenInformation(token, TokenUser, buffer.as_mut_ptr().cast(), len, &mut len) == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
    let mut sid = null_mut();
    if ConvertSidToStringSidW(user.User.Sid, &mut sid) == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut len = 0;
    while *sid.add(len) != 0 {
        len += 1;
    }
    let value = String::from_utf16_lossy(std::slice::from_raw_parts(sid, len));
    LocalFree(sid.cast());
    Ok(value)
}
fn current_sid() -> Result<String, HostError> {
    unsafe {
        let mut token = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let result = sid_of_token(token);
        CloseHandle(token);
        result
    }
}

/// Installation is the only elevated operation. All arguments are public, never machine secrets.
pub fn elevate(action: &str, machine: &str, server: &str, owner: &str) -> Result<(), HostError> {
    valid_machine(machine)?;
    if !matches!(action, "boot-install" | "boot-uninstall") {
        return Err("Unknown availability action".into());
    }
    let server = validate_server(server)?.to_string();
    if !owner.starts_with("S-1-")
        || !owner
            .bytes()
            .all(|c| c.is_ascii_digit() || c == b'S' || c == b'-')
    {
        return Err("Invalid Windows owner".into());
    }
    let exe = std::env::current_exe()?.with_file_name("beacon-remote-agent.exe");
    let file = wide(&exe.to_string_lossy());
    let args = wide(&format!("{action} {machine} \"{server}\" {owner}"));
    let verb = wide("runas");
    unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of_val(&info) as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = args.as_ptr();
        info.nShow = 0;
        if ShellExecuteExW(&mut info) == 0 {
            return Err("Windows administrator approval was cancelled or unavailable".into());
        }
        WaitForSingleObject(info.hProcess, u32::MAX);
        let mut code = 1;
        let ok = GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
        if ok == 0 || code != 0 {
            return Err(
                "Boot availability setup failed; unattended desktop access was not enabled".into(),
            );
        }
    }
    Ok(())
}

fn bind(public_key: Option<&str>) -> Result<(), HostError> {
    let identity = load_identity()?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let nonce = uuid::Uuid::new_v4().to_string();
    let message = format!(
        "beacon-remote:boot-binding:v1\n{}\n{}\n{}\n{}",
        identity.machine_id,
        timestamp,
        nonce,
        public_key.unwrap_or("off")
    );
    let key = SigningKey::from_bytes(&identity.secret_key);
    let response=client()?.post(validate_server(&identity.server)?.join("/api/agent/boot-binding")?).json(&serde_json::json!({"version":1,"machineId":identity.machine_id,"timestamp":timestamp,"nonce":nonce,"publicKey":public_key,"signature":STANDARD.encode(key.sign(message.as_bytes()).to_bytes())})).send()?;
    if !response.status().is_success() {
        return Err("The server did not accept boot availability".into());
    }
    Ok(())
}
pub fn setup() -> Result<(), HostError> {
    let identity = load_identity()?;
    elevate(
        "boot-install",
        &identity.machine_id,
        &identity.server,
        &current_sid()?,
    )?;
    let (programs, _) = roots()?;
    let path = programs.join(&identity.machine_id).join("public.json");
    reject_reparse(&path)?;
    let binding: PublicBinding = serde_json::from_slice(&fs::read(path)?)?;
    if binding.machine != identity.machine_id
        || binding.server != validate_server(&identity.server)?.to_string()
    {
        return Err("Availability binding did not match this computer".into());
    }
    bind(Some(&binding.public_key))
}

/// Read the actual SCM startup configuration; a manifest alone is not proof that
/// Windows will start the service. This never installs, starts or elevates anything.
pub fn starts_at_boot() -> Result<bool, HostError> {
    if !crate::is_paired() {
        return Ok(false);
    }
    let identity = load_identity()?;
    let (programs, _) = roots()?;
    let manifest = programs.join(&identity.machine_id).join("public.json");
    reject_reparse(&manifest)?;
    if !manifest.exists() {
        return Ok(false);
    }
    let binding: PublicBinding = serde_json::from_slice(&fs::read(manifest)?)?;
    if binding.machine != identity.machine_id
        || binding.server != validate_server(&identity.server)?.to_string()
        || binding.owner_sid != current_sid()?
    {
        return Err("Boot availability belongs to a different pairing".into());
    }
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    match manager.open_service(name(&identity.machine_id), ServiceAccess::QUERY_CONFIG) {
        Ok(service) => Ok(service.query_config()?.start_type == ServiceStartType::AutoStart),
        Err(windows_service::Error::Winapi(error)) if error.raw_os_error() == Some(1060) => {
            Ok(false)
        }
        Err(error) => Err(error.into()),
    }
}

pub fn remove() -> Result<(), HostError> {
    let identity = load_identity()?;
    let (programs, _) = roots()?;
    let installed = programs.join(&identity.machine_id).join("public.json");
    reject_reparse(&installed)?;
    if !installed.exists() {
        let _ = bind(None);
        return Ok(());
    }
    elevate(
        "boot-uninstall",
        &identity.machine_id,
        &identity.server,
        &current_sid()?,
    )?;
    // Local removal works offline; a leftover public binding has no key that can report presence.
    let _ = bind(None);
    Ok(())
}

/// The uninstaller calls this before deleting the user's identity or installed binaries.
/// Public manifests are administrator-controlled, so cleanup also works after local unpairing.
fn remove_for_user(interactive: bool) -> Result<(), HostError> {
    let (programs, _) = roots()?;
    if !programs.exists() {
        return Ok(());
    }
    reject_reparse(&programs)?;
    let owner = current_sid()?;
    for directory in fs::read_dir(programs)? {
        let path = directory?.path().join("public.json");
        if !path.exists() {
            continue;
        }
        reject_reparse(&path)?;
        let binding: PublicBinding = serde_json::from_slice(&fs::read(&path)?)?;
        if binding.owner_sid != owner {
            continue;
        }
        if !interactive {
            return Err("Unattended boot availability needs an interactive uninstall with Windows administrator approval".into());
        }
        elevate("boot-uninstall", &binding.machine, &binding.server, &owner)?;
    }
    if crate::is_paired() {
        let _ = bind(None);
    }
    Ok(())
}

pub fn command(arguments: &[String]) -> Option<Result<(), HostError>> {
    match arguments.get(1).map(String::as_str) {
        Some("boot-status") if arguments.len() == 2 => Some((|| {
            println!(
                "{}",
                if starts_at_boot()? {
                    "enabled"
                } else {
                    "disabled"
                }
            );
            Ok(())
        })()),
        Some("boot-remove-local") => Some(remove_for_user(
            !arguments.iter().any(|arg| arg == "--silent"),
        )),
        Some("boot-install") if arguments.len() == 5 => {
            Some(install(&arguments[2], &arguments[3], &arguments[4]))
        }
        Some("boot-uninstall") if arguments.len() >= 3 => Some(uninstall(&arguments[2])),
        Some("boot-service") if arguments.len() == 3 => Some((|| {
            valid_machine(&arguments[2])?;
            let _ = MACHINE.set(arguments[2].clone());
            service_dispatcher::start(name(&arguments[2]), ffi_main)?;
            Ok(())
        })()),
        _ => None,
    }
}

fn install(machine: &str, server: &str, owner: &str) -> Result<(), HostError> {
    valid_machine(machine)?;
    let server = validate_server(server)?.to_string();
    // Only a syntactically valid SID can enter service state, even through a direct elevated invocation.
    if !owner.starts_with("S-1-")
        || !owner
            .bytes()
            .all(|c| c.is_ascii_digit() || c == b'S' || c == b'-')
    {
        return Err("Invalid owner SID".into());
    }
    let (programs, data) = roots()?;
    secure_directory(&programs, PUBLIC_ACL)?;
    secure_directory(&data, PRIVATE_ACL)?;
    let programs = programs.join(machine);
    let data = data.join(machine);
    secure_directory(&programs, PUBLIC_ACL)?;
    secure_directory(&data, PRIVATE_ACL)?;
    let state = data.join("identity.dpapi");
    let identity = if state.exists() {
        reject_reparse(&state)?;
        let mut bytes = credentials::unprotect(&fs::read(&state)?)?;
        let parsed = serde_json::from_slice::<BootIdentity>(&bytes);
        bytes.zeroize();
        let identity = parsed?;
        if identity.machine != machine || identity.server != server || identity.owner_sid != owner {
            return Err("Availability is already bound to another owner or server".into());
        }
        identity
    } else {
        let identity = BootIdentity {
            machine: machine.into(),
            server: server.clone(),
            owner_sid: owner.into(),
            secret: SigningKey::generate(&mut rand::rng()).to_bytes(),
        };
        let mut bytes = serde_json::to_vec(&identity)?;
        let encrypted = credentials::protect_machine(&bytes);
        bytes.zeroize();
        use std::io::Write;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&state)?
            .write_all(&encrypted?)?;
        identity
    };
    let public = PublicBinding {
        machine: machine.into(),
        server,
        owner_sid: owner.into(),
        public_key: STANDARD.encode(
            SigningKey::from_bytes(&identity.secret)
                .verifying_key()
                .as_bytes(),
        ),
    };
    fs::write(programs.join("public.json"), serde_json::to_vec(&public)?)?;
    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    )?;
    let service_name = name(machine);
    if let Ok(existing) = manager.open_service(
        &service_name,
        ServiceAccess::QUERY_STATUS | ServiceAccess::STOP,
    ) {
        if existing.query_status()?.current_state != ServiceState::Stopped {
            let _ = existing.stop();
            for _ in 0..100 {
                if existing.query_status()?.current_state == ServiceState::Stopped {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        if existing.query_status()?.current_state != ServiceState::Stopped {
            return Err("Availability service did not stop".into());
        }
    }
    let executable = programs.join("beacon-remote-agent.exe");
    reject_reparse(&executable)?;
    fs::copy(std::env::current_exe()?, &executable)?;
    let info = ServiceInfo {
        name: service_name.clone().into(),
        display_name: format!("Beacon Remote boot availability ({})", &machine[..8]).into(),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: executable,
        launch_arguments: vec!["boot-service".into(), machine.into()],
        dependencies: vec![],
        account_name: None,
        account_password: None,
    };
    let service = match manager.open_service(
        &service_name,
        ServiceAccess::CHANGE_CONFIG | ServiceAccess::START,
    ) {
        Ok(s) => {
            s.change_config(&info)?;
            s
        }
        Err(windows_service::Error::Winapi(e)) if e.raw_os_error() == Some(1060) => {
            manager.create_service(&info, ServiceAccess::START)?
        }
        Err(e) => return Err(e.into()),
    };
    service.start::<&str>(&[])?;
    Ok(())
}
fn uninstall(machine: &str) -> Result<(), HostError> {
    valid_machine(machine)?;
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    match manager.open_service(
        name(machine),
        ServiceAccess::STOP | ServiceAccess::QUERY_STATUS | ServiceAccess::DELETE,
    ) {
        Ok(service) => {
            if service.query_status()?.current_state != ServiceState::Stopped {
                let _ = service.stop();
            }
            for _ in 0..100 {
                if service.query_status()?.current_state == ServiceState::Stopped {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            if service.query_status()?.current_state != ServiceState::Stopped {
                return Err("Availability service did not stop".into());
            }
            service.delete()?;
        }
        Err(windows_service::Error::Winapi(e)) if e.raw_os_error() == Some(1060) => (),
        Err(e) => return Err(e.into()),
    }
    let (programs, data) = roots()?;
    for (root, files) in [
        (programs, vec!["public.json", "beacon-remote-agent.exe"]),
        (data, vec!["identity.dpapi"]),
    ] {
        let folder = root.join(machine);
        reject_reparse(&folder)?;
        for file in files {
            let path = folder.join(file);
            reject_reparse(&path)?;
            if path.exists() {
                fs::remove_file(path)?;
            }
        }
        if folder.exists() {
            fs::remove_dir(folder)?;
        } // Preserve unexpected files; no recursive deletion.
    }
    Ok(())
}

fn desktop_state(owner: &str) -> &'static str {
    unsafe {
        let mut sessions = null_mut();
        let mut count = 0;
        if WTSEnumerateSessionsW(null_mut(), 0, 1, &mut sessions, &mut count) == 0 {
            return "starting";
        }
        let mut state = "signed-out";
        for entry in std::slice::from_raw_parts(sessions, count as usize) {
            let mut token = null_mut();
            if WTSQueryUserToken(entry.SessionId, &mut token) == 0 {
                continue;
            }
            let matches = sid_of_token(token).is_ok_and(|sid| sid == owner);
            CloseHandle(token);
            if !matches {
                continue;
            }
            state = "locked";
            let mut buffer = null_mut();
            let mut bytes = 0;
            if WTSQuerySessionInformationW(
                null_mut(),
                entry.SessionId,
                WTSSessionInfoEx,
                &mut buffer,
                &mut bytes,
            ) != 0
            {
                if bytes as usize >= std::mem::size_of::<WTSINFOEXW>() {
                    let info = &*buffer.cast::<WTSINFOEXW>();
                    if info.Level == 1
                        && info.Data.WTSInfoExLevel1.SessionFlags == 1
                        && entry.State == WTSActive
                    {
                        state = "starting";
                    }
                }
                WTSFreeMemory(buffer.cast());
            }
            if state == "starting" {
                break;
            }
        }
        WTSFreeMemory(sessions.cast());
        state
    }
}
define_windows_service!(ffi_main, service_main);
fn service_main(_: Vec<OsString>) {
    let _ = run_service();
}
fn run_service() -> Result<(), HostError> {
    let machine = MACHINE.get().ok_or("Missing service identity")?;
    let cancel = Arc::new(AtomicBool::new(false));
    let stopping = cancel.clone();
    let handle = service_control_handler::register(name(machine), move |event| match event {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            stopping.store(true, Ordering::Release);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    })?;
    let status = |state, code| ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: if state == ServiceState::Running {
            ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN
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
        let (programs, data) = roots()?;
        secure_directory(&programs, PUBLIC_ACL)?;
        secure_directory(&data, PRIVATE_ACL)?;
        secure_directory(&data.join(machine), PRIVATE_ACL)?;
        let path = data.join(machine).join("identity.dpapi");
        reject_reparse(&path)?;
        let mut bytes = credentials::unprotect(&fs::read(path)?)?;
        let parsed = serde_json::from_slice::<BootIdentity>(&bytes);
        bytes.zeroize();
        let identity = parsed?;
        if identity.machine != *machine {
            return Err("Service identity mismatch".into());
        }
        let server = validate_server(&identity.server)?;
        let http = client()?;
        let key = SigningKey::from_bytes(&identity.secret);
        while !cancel.load(Ordering::Acquire) {
            let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
            let nonce = uuid::Uuid::new_v4().to_string();
            let state = desktop_state(&identity.owner_sid);
            let message = format!(
                "beacon-remote:boot-heartbeat:v1\n{machine}\n{timestamp}\n{nonce}\n{state}"
            );
            // A rejected binding may be waiting for first setup to finish. No commands are processed.
            let response=http.post(server.join("/api/boot/heartbeat")?).json(&serde_json::json!({"version":1,"machineId":machine,"timestamp":timestamp,"nonce":nonce,"state":state,"signature":STANDARD.encode(key.sign(message.as_bytes()).to_bytes())})).send();
            if response.is_ok_and(|reply| reply.status() == reqwest::StatusCode::GONE) {
                break;
            }
            crate::pause(&cancel, Duration::from_secs(15));
        }
        Ok(())
    })();
    handle.set_service_status(status(
        ServiceState::Stopped,
        if result.is_ok() { 0 } else { 1 },
    ))?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protected_directories_are_reusable_but_different_permissions_are_rejected() {
        // Real NTFS security boundary, under a disposable user-owned directory; no SCM or elevation.
        let root =
            std::env::temp_dir().join(format!("beacon-availability-acl-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let sid = current_sid().unwrap();
        let acl = format!("O:{sid}G:{sid}D:P(A;OICI;FA;;;{sid})");
        let folder = root.join("protected");
        let public = root.join("public");
        let result = (|| -> Result<(), HostError> {
            secure_directory(&folder, &acl)?;
            secure_directory(&folder, &acl)?;
            let different = format!("O:{sid}G:{sid}D:P(A;OICI;FA;;;{sid})(A;OICI;GR;;;BU)");
            assert!(secure_directory(&folder, &different).is_err());
            let readable = format!("O:{sid}G:{sid}D:P(A;OICI;FA;;;{sid})(A;OICI;0x1200a9;;;BU)");
            secure_directory(&public, &readable)?;
            secure_directory(&public, &readable)?;
            Ok(())
        })();
        fs::remove_dir(&folder).unwrap();
        if public.exists() {
            fs::remove_dir(&public).unwrap();
        }
        fs::remove_dir(&root).unwrap();
        result.unwrap();
    }
}
