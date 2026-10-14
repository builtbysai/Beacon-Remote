use crate::{display_version, trust, OWNED};
use std::{
    env, fs, io,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
};
use windows::{
    core::{Interface, HSTRING, PCWSTR},
    Win32::{
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            Registry::{
                RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegDeleteValueW, RegOpenKeyExW,
                RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE,
                KEY_SET_VALUE, REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SZ,
            },
        },
        UI::{
            Shell::{IShellLinkW, ShellLink},
            WindowsAndMessaging::{
                MessageBoxW, IDYES, MB_ICONERROR, MB_ICONINFORMATION, MB_ICONQUESTION, MB_OK,
                MB_YESNO,
            },
        },
    },
};

pub(crate) type Error = Box<dyn std::error::Error>;

pub(crate) const AGENT: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/beacon-remote-agent.exe"));
pub(crate) const HOST: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/beacon-remote-host.exe"));
pub(crate) const SESSION: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/beacon-remote-session.exe"));
pub(crate) const MANIFEST: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/manifest.json"));
const UNINSTALLER: &str = "Uninstall Beacon Remote.exe";
const RUN_VALUE: &str = "BeaconRemoteHost";
const NO_WINDOW: u32 = 0x0800_0000;
const TITLE: &str = "Beacon Remote";

struct Context {
    silent: bool,
    sandbox: bool,
    install: PathBuf,
    credentials: PathBuf,
    shortcut: PathBuf,
}

impl Context {
    fn new(silent: bool) -> Result<Self, Error> {
        let local = PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is not set")?);
        let appdata = PathBuf::from(env::var_os("APPDATA").ok_or("APPDATA is not set")?);
        Ok(Self {
            silent,
            sandbox: env::var("BEACON_SETUP_SANDBOX").is_ok_and(|value| value == "1"),
            install: local.join("Programs").join("Beacon Remote"),
            credentials: local.join("BeaconRemote"),
            shortcut: appdata
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
                .join("Beacon Remote.lnk"),
        })
    }
    fn uninstall_key(&self) -> &'static str {
        if self.sandbox {
            "Software\\BeaconRemoteSetupTest\\Uninstall"
        } else {
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\BeaconRemote"
        }
    }
    fn run_key(&self) -> &'static str {
        if self.sandbox {
            "Software\\BeaconRemoteSetupTest\\Run"
        } else {
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run"
        }
    }
    fn say(&self, text: &str, flags: windows::Win32::UI::WindowsAndMessaging::MESSAGEBOX_STYLE) {
        if !self.silent {
            unsafe {
                MessageBoxW(None, &HSTRING::from(text), &HSTRING::from(TITLE), flags);
            }
        }
    }
    fn ask(&self, text: &str) -> bool {
        self.silent
            || unsafe {
                MessageBoxW(
                    None,
                    &HSTRING::from(text),
                    &HSTRING::from(TITLE),
                    MB_YESNO | MB_ICONQUESTION,
                ) == IDYES
            }
    }
}

/// The hidden, elevated side of the trust step: no dialogs, just an exit code.
fn worker(result: Result<(), Error>) -> ! {
    match result {
        Ok(()) => std::process::exit(0),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

pub fn run() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    if arguments
        .iter()
        .any(|argument| argument == trust::TRUST_FLAG)
    {
        worker(trust::trust_now());
    }
    if arguments
        .iter()
        .any(|argument| argument == trust::REMOVE_FLAG)
    {
        worker(trust::withdraw_now());
    }
    // Started from a technician's link (the file is named for it): temporary support, not an install.
    let support = arguments
        .windows(2)
        .find(|pair| pair[0] == "--support")
        .map(|pair| pair[1].clone())
        .or_else(|| {
            env::current_exe()
                .ok()
                .and_then(|exe| crate::support::token_from_name(&exe))
        });
    if let Some(token) = support {
        if let Err(error) = crate::support::run(&token) {
            fail(false, &error);
        }
        return;
    }
    let silent = arguments.iter().any(|argument| argument == "--silent");
    let uninstall = arguments.iter().any(|argument| argument == "--uninstall");
    // The owner asked for this in their account (ADR 0039): no question, but it says so on screen.
    let by_owner = arguments
        .iter()
        .any(|argument| argument == "--removed-by-owner");
    let context = match Context::new(silent) {
        Ok(context) => context,
        Err(error) => return fail(silent, &error),
    };
    let result = if uninstall {
        remove(&context, by_owner)
    } else {
        add(&context)
    };
    match result {
        Ok(()) => {}
        Err(error) => fail(silent, &error),
    }
}

fn fail(silent: bool, error: &Error) {
    eprintln!("{error}");
    if !silent {
        unsafe {
            MessageBoxW(
                None,
                &HSTRING::from(format!("Beacon Remote could not finish.\n\n{error}")),
                &HSTRING::from(TITLE),
                MB_OK | MB_ICONERROR,
            );
        }
    }
    std::process::exit(1);
}

fn add(context: &Context) -> Result<(), Error> {
    if AGENT.is_empty() || HOST.is_empty() || SESSION.is_empty() {
        return Err("This is a development stub without the Beacon Remote programs inside.".into());
    }
    if !context.ask(
        "Install Beacon Remote for this Windows account?\n\n\
         It runs in the background and starts when you sign in. Nothing on this computer is shared \
         until you approve a connection here. You can change this in the Beacon Remote window.",
    ) {
        return Ok(());
    }
    offer_trust(context);
    let fresh = !context.install.exists();
    if !fresh {
        stop_running(&context.install);
    }
    let was_enabled = !fresh && autostart_value(context).is_some();
    let result = lay_down(context, fresh || was_enabled);
    if let Err(error) = result {
        if fresh {
            clean(context, false);
        }
        return Err(error);
    }
    context.say(
        "Beacon Remote is installed.\n\nThe Beacon Remote window is opening so you can pair this computer.",
        MB_OK | MB_ICONINFORMATION,
    );
    if !context.silent {
        Command::new(context.install.join("beacon-remote-host.exe"))
            .current_dir(&context.install)
            .spawn()?;
    }
    Ok(())
}

fn lay_down(context: &Context, autostart: bool) -> Result<(), Error> {
    fs::create_dir_all(&context.install)?;
    for (name, bytes) in [
        ("beacon-remote-agent.exe", AGENT),
        ("beacon-remote-host.exe", HOST),
        ("beacon-remote-session.exe", SESSION),
        ("manifest.json", MANIFEST),
    ] {
        fs::write(context.install.join(name), bytes).map_err(|error| {
            format!("Could not write {name}: {error}. Close Beacon Remote and try again.")
        })?;
    }
    let uninstaller = context.install.join(UNINSTALLER);
    if env::current_exe()? != uninstaller {
        fs::copy(env::current_exe()?, &uninstaller)?;
    }
    let host = context.install.join("beacon-remote-host.exe");
    make_shortcut(&context.shortcut, &host, &context.install)?;
    register(context, &host, &uninstaller)?;
    if autostart {
        set_string(
            context.run_key(),
            RUN_VALUE,
            &format!("\"{}\" --background", host.display()),
        )?;
    }
    Ok(())
}

fn remove(context: &Context, by_owner: bool) -> Result<(), Error> {
    if !by_owner
        && !context.ask(
        "Remove Beacon Remote from this computer?\n\n\
         This stops Beacon Remote and deletes the sign-in it saved here. The computer stays in your \
         account until you remove it on the Beacon Remote website.",
    ) {
        return Ok(());
    }
    stop_running(&context.install);
    clean(context, true);
    if by_owner {
        context.say(
            "Beacon Remote was removed from this computer because its owner removed it in their account.

Nothing else on this computer was changed.",
            MB_OK | MB_ICONINFORMATION,
        );
        return Ok(());
    }
    offer_untrust(context);
    context.say("Beacon Remote was removed.", MB_OK | MB_ICONINFORMATION);
    Ok(())
}

/// Offers, once, to trust Beacon Remote's own signing certificate. Skipped on computers already set up, for
/// `--silent`, in tests, and when this build carries no certificate. Declining never stops the install.
fn offer_trust(context: &Context) {
    if context.silent || context.sandbox || trust::settled() {
        return;
    }
    let fingerprint = trust::grouped(&trust::certificate_fingerprint());
    if !context.ask(&format!(
        "Let Windows trust Beacon Remote?

         Beacon Remote is signed with its own free certificate, not one bought from a certificate authority.          Trusting it once lets Windows recognise Beacon Remote's programs as coming from Beacon Remote and          stops \"unknown publisher\" warnings on this computer.

         This needs administrator approval. It adds only this certificate to Windows' Trusted Root and          Trusted Publishers lists, and uninstalling Beacon Remote offers to remove it again.

         Certificate fingerprint (SHA-256):
{fingerprint}

         It should match the fingerprint on the Beacon Remote Downloads page. Choose Yes to approve, or No to          install without it."
    )) {
        return;
    }
    match trust::elevated(trust::TRUST_FLAG) {
        Ok(0) => {}
        _ => context.say(
            "The certificate was not trusted (the approval was declined or did not finish). Beacon Remote              is installing anyway; Windows may warn that its publisher is unknown. Running the installer              again offers it once more.",
            MB_OK | MB_ICONINFORMATION,
        ),
    }
}

/// On uninstall, offers to stop trusting the certificate (administrator approval again).
fn offer_untrust(context: &Context) {
    if context.silent || context.sandbox || !trust::trusted() {
        return;
    }
    if context.ask(
        "Also stop trusting the Beacon Remote certificate on this computer?

         This needs administrator approval. Choose No if you may reinstall Beacon Remote or run other          programs signed with it.",
    ) {
        let _ = trust::elevated(trust::REMOVE_FLAG);
    }
}

/// Removes what this program added. `credentials` also deletes the saved sign-in (uninstall only).
fn clean(context: &Context, credentials: bool) {
    let _ = delete_value(context.run_key(), RUN_VALUE);
    let _ = fs::remove_file(&context.shortcut);
    unsafe {
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(context.uninstall_key()));
    }
    if credentials {
        // A fixed child of the profile's local data folder; never a computed or user-supplied path.
        if context
            .credentials
            .file_name()
            .is_some_and(|name| name == "BeaconRemote")
        {
            let _ = fs::remove_dir_all(&context.credentials);
        }
    }
    let own = env::current_exe().ok();
    for name in OWNED {
        let path = context.install.join(name);
        if own.as_deref() == Some(path.as_path()) {
            continue;
        }
        if path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        } else {
            let _ = fs::remove_file(&path);
        }
    }
    match own {
        Some(exe) if exe.starts_with(&context.install) => {
            // The running uninstaller cannot delete itself; a short detached command does it once we exit.
            let _ = Command::new("cmd")
                .raw_arg(format!(
                    "/c ping 127.0.0.1 -n 3 >nul & del /f /q \"{}\" & rmdir \"{}\"",
                    exe.display(),
                    context.install.display()
                ))
                .creation_flags(NO_WINDOW)
                .spawn();
        }
        _ => {
            // Unknown files are left in place; rmdir only removes an empty folder.
            let _ = fs::remove_dir(&context.install);
        }
    }
}

fn stop_running(install: &Path) {
    // Only processes started from the install folder; another copy elsewhere is left alone.
    let script = format!(
        "Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -ne {} -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith('{}\\', [StringComparison]::OrdinalIgnoreCase) }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}",
        std::process::id(),
        install.display().to_string().replace('\'', "''")
    );
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(NO_WINDOW)
        .status();
    std::thread::sleep(std::time::Duration::from_millis(500));
}

fn make_shortcut(link: &Path, target: &Path, folder: &Path) -> Result<(), Error> {
    if let Some(parent) = link.parent() {
        fs::create_dir_all(parent)?;
    }
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| -> Result<(), Error> {
            let shell: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            shell.SetPath(&HSTRING::from(target.as_os_str()))?;
            shell.SetWorkingDirectory(&HSTRING::from(folder.as_os_str()))?;
            shell.SetDescription(&HSTRING::from("Beacon Remote"))?;
            shell.SetIconLocation(&HSTRING::from(target.as_os_str()), 0)?;
            let file: IPersistFile = shell.cast()?;
            file.Save(&HSTRING::from(link.as_os_str()), true)?;
            Ok(())
        })();
        if initialized {
            CoUninitialize();
        }
        result
    }
}

fn register(context: &Context, host: &Path, uninstaller: &Path) -> Result<(), Error> {
    let key = context.uninstall_key();
    set_string(key, "DisplayName", "Beacon Remote")?;
    set_string(key, "DisplayVersion", &display_version(MANIFEST))?;
    set_string(key, "Publisher", "Beacon")?;
    set_string(
        key,
        "InstallLocation",
        &context.install.display().to_string(),
    )?;
    set_string(key, "DisplayIcon", &host.display().to_string())?;
    set_string(
        key,
        "UninstallString",
        &format!("\"{}\" --uninstall", uninstaller.display()),
    )?;
    set_dword(key, "NoModify", 1)?;
    set_dword(key, "NoRepair", 1)?;
    let size: u64 = [AGENT.len(), HOST.len(), SESSION.len()]
        .iter()
        .map(|length| *length as u64)
        .sum();
    set_dword(key, "EstimatedSize", (size / 1024) as u32)?;
    Ok(())
}

fn open_for_write(path: &str) -> Result<HKEY, Error> {
    let mut key = HKEY::default();
    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(path),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
        .ok()?;
    }
    Ok(key)
}

fn set_string(path: &str, name: &str, value: &str) -> Result<(), Error> {
    let key = open_for_write(path)?;
    let wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes: Vec<u8> = wide.iter().flat_map(|unit| unit.to_le_bytes()).collect();
    let result = unsafe { RegSetValueExW(key, &HSTRING::from(name), None, REG_SZ, Some(&bytes)) };
    unsafe {
        let _ = RegCloseKey(key);
    }
    result.ok().map_err(|error| io::Error::other(error).into())
}

fn set_dword(path: &str, name: &str, value: u32) -> Result<(), Error> {
    let key = open_for_write(path)?;
    let result = unsafe {
        RegSetValueExW(
            key,
            &HSTRING::from(name),
            None,
            REG_DWORD,
            Some(&value.to_le_bytes()),
        )
    };
    unsafe {
        let _ = RegCloseKey(key);
    }
    result.ok().map_err(|error| io::Error::other(error).into())
}

fn delete_value(path: &str, name: &str) -> Result<(), Error> {
    let mut key = HKEY::default();
    unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(path),
            None,
            KEY_SET_VALUE,
            &mut key,
        )
        .ok()?;
        let result = RegDeleteValueW(key, &HSTRING::from(name));
        let _ = RegCloseKey(key);
        result.ok()?;
    }
    Ok(())
}

fn autostart_value(context: &Context) -> Option<()> {
    let mut key = HKEY::default();
    unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(context.run_key()),
            None,
            KEY_QUERY_VALUE,
            &mut key,
        )
        .ok()
        .ok()?;
        let found =
            RegQueryValueExW(key, &HSTRING::from(RUN_VALUE), None, None, None, None).is_ok();
        let _ = RegCloseKey(key);
        found.then_some(())
    }
}
