//! A SYSTEM service removing itself after its owner removed the computer in their account and the server said so to
//! a correctly signed heartbeat (410). Lower-only: nothing is started, raised or kept, and no folder is deleted
//! recursively. The running program cannot delete itself, so a short detached command does that once it has exited.
use crate::HostError;
use std::{
    fs, io,
    path::{Path, PathBuf},
};

/// Marks `service` for deletion (Windows removes it once it stops), deletes `files` now, and after this process exits
/// deletes the running program and then each of `folders` (deepest first) if it is empty.
pub(crate) fn remove_after_exit(
    service: &str,
    files: &[PathBuf],
    folders: &[PathBuf],
) -> Result<(), HostError> {
    use windows_service::{
        service::ServiceAccess,
        service_manager::{ServiceManager, ServiceManagerAccess},
    };
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    match manager.open_service(service, ServiceAccess::DELETE) {
        Ok(service) => service.delete()?,
        Err(windows_service::Error::Winapi(error)) if error.raw_os_error() == Some(1060) => {}
        Err(error) => return Err(error.into()),
    }
    for file in files {
        match fs::remove_file(file) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    let exe = std::env::current_exe()?;
    let system = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    let powershell = PathBuf::from(system)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    use std::os::windows::process::CommandExt;
    std::process::Command::new(powershell)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &script(std::process::id(), &exe, folders),
        ])
        // CREATE_NO_WINDOW | DETACHED_PROCESS
        .creation_flags(0x0800_0000 | 0x0000_0008)
        .spawn()?;
    Ok(())
}

fn quote(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', "''"))
}

/// Waits for `pid` (at most two minutes), deletes `exe`, then removes each folder only when it is empty.
fn script(pid: u32, exe: &Path, folders: &[PathBuf]) -> String {
    let mut text = format!(
        "Wait-Process -Id {pid} -Timeout 120 -ErrorAction SilentlyContinue; \
         for ($i = 0; $i -lt 20 -and (Test-Path -LiteralPath {exe}); $i++) {{ \
         Remove-Item -LiteralPath {exe} -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500 }}",
        exe = quote(exe)
    );
    for folder in folders {
        let folder = quote(folder);
        text.push_str(&format!(
            "; if (-not (Get-ChildItem -LiteralPath {folder} -Force -ErrorAction SilentlyContinue)) {{ \
             Remove-Item -LiteralPath {folder} -Force -ErrorAction SilentlyContinue }}"
        ));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::script;
    use std::path::PathBuf;

    #[test]
    fn the_program_goes_after_exit_and_folders_only_when_empty() {
        let text = script(
            77,
            &PathBuf::from(r"C:\Program Files\Beacon Remote Sign-in\m\v\beacon-remote-agent.exe"),
            &[
                PathBuf::from(r"C:\Program Files\Beacon Remote Sign-in\m\v"),
                PathBuf::from(r"C:\Program Files\Beacon Remote Sign-in\m"),
            ],
        );
        assert!(text.starts_with("Wait-Process -Id 77 "));
        assert!(!text.to_lowercase().contains("-recurse"));
        assert_eq!(text.matches("if (-not (Get-ChildItem").count(), 2);
        assert!(
            text.contains(r"'C:\Program Files\Beacon Remote Sign-in\m\v\beacon-remote-agent.exe'")
        );
    }
}
