//! Ctrl+Alt+Del for unattended sign-in. Windows ignores injected key presses on the lock-screen picture, so the only
//! program-driven way from the picture to the password prompt is the secure attention sequence, sent with `SendSAS`.
//! Windows honours that only when the `SoftwareSASGeneration` policy allows services to send it. The owner's one-time
//! elevated setup (and Repair) turns the services bit on and remembers what was there; removing the last sign-in
//! installation puts the remembered value back, and only if nobody changed it since.
use crate::HostError;
use std::{fs, io, path::Path};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, KEY_SET_VALUE, KEY_WOW64_64KEY, REG_DWORD,
};

const KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System";
const VALUE: &str = "SoftwareSASGeneration";
/// Bit 1 lets services send the sequence; bit 2 is Ease of Access applications, which Beacon never sets.
const SERVICES: u32 = 1;
/// Where the value from before Beacon is kept, inside the private sign-in data folder.
pub(crate) const RECORD: &str = "sas-policy.previous";

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

struct Key(HKEY);
impl Drop for Key {
    fn drop(&mut self) {
        unsafe {
            RegCloseKey(self.0);
        }
    }
}
fn open(access: u32) -> Result<Option<Key>, HostError> {
    let mut key: HKEY = std::ptr::null_mut();
    let status = unsafe {
        RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            wide(KEY).as_ptr(),
            0,
            access | KEY_WOW64_64KEY,
            &mut key,
        )
    };
    match status {
        0 => Ok(Some(Key(key))),
        2 => Ok(None),
        status => Err(io::Error::from_raw_os_error(status as i32).into()),
    }
}

/// The policy value now (None when it is not set).
pub(crate) fn current() -> Result<Option<u32>, HostError> {
    let Some(key) = open(KEY_QUERY_VALUE)? else {
        return Ok(None);
    };
    let mut kind = 0u32;
    let mut data = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            wide(VALUE).as_ptr(),
            std::ptr::null(),
            &mut kind,
            std::ptr::from_mut(&mut data).cast(),
            &mut size,
        )
    };
    match status {
        0 if kind == REG_DWORD => Ok(Some(data)),
        0 => Err("SoftwareSASGeneration is not a number; left as it is".into()),
        2 => Ok(None),
        status => Err(io::Error::from_raw_os_error(status as i32).into()),
    }
}

fn set(value: Option<u32>) -> Result<(), HostError> {
    let key = open(KEY_SET_VALUE)?.ok_or("The Windows system policy key is missing")?;
    let status = match value {
        Some(value) => unsafe {
            RegSetValueExW(
                key.0,
                wide(VALUE).as_ptr(),
                0,
                REG_DWORD,
                std::ptr::from_ref(&value).cast(),
                std::mem::size_of::<u32>() as u32,
            )
        },
        None => match unsafe { RegDeleteValueW(key.0, wide(VALUE).as_ptr()) } {
            2 => 0,
            status => status,
        },
    };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status as i32).into());
    }
    Ok(())
}

/// What to remember and what to write, from the value found before Beacon touches it. None: nothing to change.
fn plan_allow(found: Option<u32>) -> Option<u32> {
    match found {
        Some(value) if value & SERVICES != 0 => None,
        Some(value) => Some(value | SERVICES),
        None => Some(SERVICES),
    }
}

/// The value to put back when the last installation goes: the remembered one, but only while the policy still holds
/// exactly what Beacon wrote. `Err(())` means someone changed it since, so it is left alone.
fn plan_restore(previous: Option<u32>, now: Option<u32>) -> Result<Option<u32>, ()> {
    let written = plan_allow(previous).or(previous);
    if now == written {
        Ok(previous)
    } else {
        Err(())
    }
}

fn encode(value: Option<u32>) -> String {
    value.map_or_else(|| "absent".into(), |value| value.to_string())
}
fn decode(text: &str) -> Result<Option<u32>, HostError> {
    match text.trim() {
        "absent" => Ok(None),
        value => Ok(Some(value.parse()?)),
    }
}

/// Elevated setup and Repair: lets services send Ctrl+Alt+Del. The value from before is remembered once, the first
/// time, in `data_root` (the protected sign-in data folder), so a later Repair does not overwrite it.
pub(crate) fn allow_services(data_root: &Path) -> Result<(), HostError> {
    let found = current()?;
    let record = data_root.join(RECORD);
    if !record.exists() {
        fs::write(&record, encode(found))?;
    }
    if let Some(value) = plan_allow(found) {
        set(Some(value))?;
    }
    Ok(())
}

/// After the last sign-in installation is gone: puts the remembered value back (if the policy still holds Beacon's
/// value) and forgets it. Nothing to do when nothing was remembered.
pub(crate) fn restore(data_root: &Path) -> Result<(), HostError> {
    let record = data_root.join(RECORD);
    let previous = match fs::read_to_string(&record) {
        Ok(text) => decode(&text)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if let Ok(value) = plan_restore(previous, current()?) {
        set(value)?;
    }
    fs::remove_file(record)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_services_bit_is_added_and_what_was_there_comes_back() {
        assert_eq!(plan_allow(None), Some(1));
        assert_eq!(plan_allow(Some(0)), Some(1));
        assert_eq!(plan_allow(Some(2)), Some(3));
        assert_eq!(plan_allow(Some(1)), None);
        assert_eq!(plan_allow(Some(3)), None);
        // Put back as found while the policy still holds what Beacon wrote.
        assert_eq!(plan_restore(None, Some(1)), Ok(None));
        assert_eq!(plan_restore(Some(0), Some(1)), Ok(Some(0)));
        assert_eq!(plan_restore(Some(2), Some(3)), Ok(Some(2)));
        assert_eq!(plan_restore(Some(1), Some(1)), Ok(Some(1)));
        // Someone changed it since: left alone.
        assert_eq!(plan_restore(None, Some(3)), Err(()));
        assert_eq!(plan_restore(Some(0), None), Err(()));
    }

    #[test]
    fn the_remembered_value_round_trips() {
        for value in [None, Some(0), Some(2)] {
            assert_eq!(decode(&encode(value)).unwrap(), value);
        }
        assert!(decode("lots").is_err());
    }
}
