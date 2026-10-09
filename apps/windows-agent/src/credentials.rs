#[cfg(windows)]
pub fn protect(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes
            .len()
            .try_into()
            .map_err(|_| std::io::Error::other("Credential too large"))?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // User-scoped DPAPI: same account and Windows installation, no machine scope.
    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        windows_sys::Win32::Foundation::LocalFree(output.pbData as *mut _);
    }
    Ok(result)
}

#[cfg(windows)]
pub fn unprotect(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes
            .len()
            .try_into()
            .map_err(|_| std::io::Error::other("Credential too large"))?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        windows_sys::Win32::Foundation::LocalFree(output.pbData as *mut _);
    }
    Ok(result)
}

#[cfg(not(windows))]
pub fn protect(_: &[u8]) -> std::io::Result<Vec<u8>> {
    Err(std::io::Error::other(
        "Windows DPAPI required; refusing plaintext credentials",
    ))
}

#[cfg(not(windows))]
pub fn unprotect(_: &[u8]) -> std::io::Result<Vec<u8>> {
    Err(std::io::Error::other("Windows DPAPI required"))
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn dpapi_round_trip_and_tamper_rejection() {
        let secret = b"test-only machine credential";
        let mut encrypted = super::protect(secret).unwrap();
        assert_ne!(encrypted, secret);
        assert_eq!(super::unprotect(&encrypted).unwrap(), secret);
        let last = encrypted.len() - 1;
        encrypted[last] ^= 0x80;
        assert!(super::unprotect(&encrypted).is_err());
    }
}
