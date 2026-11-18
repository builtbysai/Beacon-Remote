//! The owner's folder choice for drive mapping (P1-4). Run as `beacon-remote-session --choose-drive-folder`, it
//! shows the standard Windows folder picker on this computer and stores the chosen folder for later sessions.
//! Nothing here runs during a remote session, and nothing leaves the computer.

use std::path::{Path, PathBuf};

/// Where the chosen folder is stored: one line with the folder, and optionally a second line `write`.
pub fn config_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(
        PathBuf::from(base)
            .join("BeaconRemote")
            .join("drive-folder.txt"),
    )
}

/// The folder and rights the owner chose, if any. An environment variable overrides the stored choice.
pub fn stored_choice() -> Option<(PathBuf, bool)> {
    if let Some(folder) = std::env::var_os("BEACON_DRIVE_FOLDER") {
        let write = std::env::var("BEACON_DRIVE_RIGHTS").as_deref() == Ok("write");
        return Some((PathBuf::from(folder), write));
    }
    let text = std::fs::read_to_string(config_path()?).ok()?;
    let mut lines = text.lines();
    let folder = PathBuf::from(lines.next()?.trim());
    let write = lines.next().map(str::trim) == Some("write");
    Some((folder, write))
}

/// Saves the owner's choice. Only an existing folder can be stored.
pub fn store(folder: &Path, write: bool) -> std::io::Result<()> {
    let path = config_path().ok_or_else(|| std::io::Error::other("LOCALAPPDATA is not set"))?;
    if !folder.is_dir() {
        return Err(std::io::Error::other("the chosen folder does not exist"));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = format!(
        "{}\n{}\n",
        folder.display(),
        if write { "write" } else { "read" }
    );
    std::fs::write(path, body)
}

/// Shows the Windows folder picker. `Ok(None)` means the owner cancelled.
#[cfg(windows)]
pub fn pick() -> windows::core::Result<Option<PathBuf>> {
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, IShellItem, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS,
        SIGDN_FILESYSPATH,
    };
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| -> windows::core::Result<Option<PathBuf>> {
            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            let options = dialog.GetOptions()?;
            dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)?;
            if dialog.Show(None).is_err() {
                return Ok(None);
            }
            let item: IShellItem = dialog.GetResult()?;
            let name = item.GetDisplayName(SIGDN_FILESYSPATH)?;
            let text = name.to_string()?;
            CoTaskMemFree(Some(name.0 as *const _));
            Ok(Some(PathBuf::from(text)))
        })();
        if initialized {
            CoUninitialize();
        }
        result
    }
}

/// The command-line entry: `beacon-remote-session --choose-drive-folder [--write]`.
#[cfg(windows)]
pub fn run_chooser(write: bool) -> Result<(), Box<dyn std::error::Error>> {
    match pick()? {
        Some(folder) => {
            store(&folder, write)?;
            println!(
                "Shared folder set to {} ({}).",
                folder.display(),
                if write { "read and write" } else { "read only" }
            );
        }
        None => println!("No folder chosen; nothing changed."),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_folder_is_never_stored() {
        let missing = std::env::temp_dir().join("beacon-picker-definitely-missing");
        assert!(store(&missing, false).is_err());
    }
}
