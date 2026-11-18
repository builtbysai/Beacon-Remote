//! Read-only printer discovery for P2-1: lists the printers installed on this computer so the owner can pick
//! which ones a remote session may use. It only enumerates names; it does not install, change or submit anything.

#[cfg(windows)]
pub fn installed() -> Result<Vec<String>, std::io::Error> {
    use windows_sys::Win32::Graphics::Printing::{
        EnumPrintersW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_4W,
    };
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed: u32 = 0;
    let mut returned: u32 = 0;
    // First call learns the buffer size; the second fills it.
    unsafe {
        EnumPrintersW(
            flags,
            std::ptr::null(),
            4,
            std::ptr::null_mut(),
            0,
            &mut needed,
            &mut returned,
        );
    }
    if needed == 0 {
        return Ok(Vec::new());
    }
    let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
    let ok = unsafe {
        EnumPrintersW(
            flags,
            std::ptr::null(),
            4,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
            &mut returned,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let entries = unsafe {
        std::slice::from_raw_parts(buffer.as_ptr().cast::<PRINTER_INFO_4W>(), returned as usize)
    };
    let mut names = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.pPrinterName.is_null() {
            continue;
        }
        let mut length = 0usize;
        // Names are NUL-terminated UTF-16 owned by the buffer above, which outlives this loop.
        while unsafe { *entry.pPrinterName.add(length) } != 0 {
            length += 1;
        }
        let slice = unsafe { std::slice::from_raw_parts(entry.pPrinterName, length) };
        names.push(String::from_utf16_lossy(slice));
    }
    Ok(names)
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn enumeration_returns_names_or_an_empty_list_without_failing() {
        let names = super::installed().expect("printer enumeration should not fail");
        assert!(names.iter().all(|name| !name.is_empty()));
    }
}
