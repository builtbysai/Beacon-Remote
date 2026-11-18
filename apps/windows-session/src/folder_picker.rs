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

/// Asks the person for a folder through a short-lived copy of this program (`--pick-folder`), so the dialog runs in
/// its own process. `None` means they cancelled or the dialog could not open.
#[cfg(windows)]
pub fn pick_in_child() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let output = std::process::Command::new(exe)
        .arg("--pick-folder")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.lines().next()?.trim();
    (!line.is_empty()).then(|| PathBuf::from(line))
}

/// Shows the standard Windows print dialog and returns the printer the person picked, if any.
#[cfg(windows)]
pub fn pick_printer() -> Option<String> {
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows_sys::Win32::UI::Controls::Dialogs::{
        PrintDlgW, DEVNAMES, PD_HIDEPRINTTOFILE, PD_NOCURRENTPAGE, PD_NOPAGENUMS, PD_NOSELECTION,
        PRINTDLGW,
    };
    unsafe {
        let mut dialog: PRINTDLGW = std::mem::zeroed();
        dialog.lStructSize = std::mem::size_of::<PRINTDLGW>() as u32;
        dialog.Flags = PD_NOSELECTION | PD_NOPAGENUMS | PD_NOCURRENTPAGE | PD_HIDEPRINTTOFILE;
        if PrintDlgW(&mut dialog) == 0 {
            return None;
        }
        let mut name = None;
        if !dialog.hDevNames.is_null() {
            let names = GlobalLock(dialog.hDevNames) as *const DEVNAMES;
            if !names.is_null() {
                let base = names as *const u16;
                let start = base.add((*names).wDeviceOffset as usize);
                let mut length = 0;
                while *start.add(length) != 0 && length < 256 {
                    length += 1;
                }
                name = String::from_utf16(std::slice::from_raw_parts(start, length)).ok();
                GlobalUnlock(dialog.hDevNames);
            }
            GlobalFree(dialog.hDevNames);
        }
        if !dialog.hDevMode.is_null() {
            GlobalFree(dialog.hDevMode);
        }
        name.filter(|name| !name.trim().is_empty())
    }
}

/// Asks which printer to use through a short-lived copy of this program (`--pick-printer`), like the folder pick.
#[cfg(windows)]
pub fn pick_printer_in_child() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let output = std::process::Command::new(exe)
        .arg("--pick-printer")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.lines().next()?.trim();
    (!line.is_empty()).then(|| line.to_string())
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

/// Where the owner's printer selection is stored: one installed printer name per line.
pub fn printer_selection_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(
        PathBuf::from(base)
            .join("BeaconRemote")
            .join("print-printers.txt"),
    )
}

/// Stores the printers the owner chose. Every name must be installed on this computer; anything else is refused.
pub fn store_printers(chosen: &[String], installed: &[String]) -> std::io::Result<()> {
    if chosen.is_empty() {
        return Err(std::io::Error::other("choose at least one printer"));
    }
    if let Some(unknown) = chosen.iter().find(|name| !installed.contains(name)) {
        return Err(std::io::Error::other(format!(
            "{unknown} is not installed here"
        )));
    }
    let path =
        printer_selection_path().ok_or_else(|| std::io::Error::other("LOCALAPPDATA is not set"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, chosen.join("\n") + "\n")
}

/// `--choose-printers`: with no names it lists the installed printers; with names it stores them.
#[cfg(windows)]
pub fn run_printer_chooser(names: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let installed = beacon_remote_session::printers::installed()?;
    if names.is_empty() {
        println!("Installed printers:");
        for name in &installed {
            println!("  {name}");
        }
        println!("Run again with the exact names to allow remote printing on them.");
        return Ok(());
    }
    store_printers(names, &installed)?;
    println!("Remote printing allowed on: {}", names.join(", "));
    Ok(())
}

#[cfg(test)]
mod printer_tests {
    use super::*;

    #[test]
    fn only_installed_printers_can_be_stored() {
        let installed = vec!["Office Laser".to_string()];
        assert!(store_printers(&[], &installed).is_err());
        assert!(store_printers(&["Unknown".to_string()], &installed).is_err());
    }
}
