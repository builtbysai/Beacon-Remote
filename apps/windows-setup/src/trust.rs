//! One-time trust of Beacon Remote's own signing certificate (ADR 0035).
//!
//! The installer carries the public certificate. With the person's approval (one Windows administrator prompt) it
//! is added to this computer's Trusted Root Certification Authorities and Trusted Publishers, after its SHA-256
//! fingerprint is checked against the one fixed at build time. Certificates the owner has revoked are removed from
//! both and added to Disallowed. Nothing here touches the machine's stores except from the elevated worker
//! (`--trust-certificate`, `--remove-trust`), which the installer starts only after the person says yes.
use sha2::{Digest, Sha256};
use std::{env, ffi::c_void, iter::once};
use windows::{
    core::{w, HSTRING, PCWSTR},
    Win32::{
        Foundation::{CloseHandle, HANDLE},
        Security::Cryptography::{
            CertAddEncodedCertificateToStore, CertCloseStore, CertCreateCertificateContext,
            CertDeleteCertificateFromStore, CertFindCertificateInStore, CertFreeCertificateContext,
            CertOpenStore, CERT_FIND_EXISTING, CERT_OPEN_STORE_FLAGS, CERT_QUERY_ENCODING_TYPE,
            CERT_STORE_ADD_REPLACE_EXISTING, CERT_STORE_PROV_SYSTEM_W, CERT_STORE_READONLY_FLAG,
            CERT_SYSTEM_STORE_LOCAL_MACHINE, HCERTSTORE, X509_ASN_ENCODING,
        },
        System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE},
        UI::{
            Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW},
            WindowsAndMessaging::SW_HIDE,
        },
    },
};

type Error = Box<dyn std::error::Error>;

/// The public signing certificate (DER), or empty when this build was made without one.
const CERTIFICATE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/signing.cer"));
const REVOKED: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/revoked.bin"));
/// Its SHA-256, fixed when the installer was built.
const EXPECTED_SHA256: &str = env!("BEACON_CERT_SHA256");

pub const TRUST_FLAG: &str = "--trust-certificate";
pub const REMOVE_FLAG: &str = "--remove-trust";

/// Upper-case hex SHA-256 of some bytes.
pub fn fingerprint(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect()
}

/// Four-character groups, two lines, easy to compare by eye.
pub fn grouped(hex: &str) -> String {
    let groups: Vec<&str> = hex
        .as_bytes()
        .chunks(4)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or(""))
        .collect();
    groups
        .chunks(8)
        .map(|line| line.join(" "))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The revoked certificates bundled at build time: each is a little-endian u32 length and its bytes.
fn parse_revoked(mut blob: &[u8]) -> Vec<&[u8]> {
    let mut found = Vec::new();
    while blob.len() >= 4 {
        let length = u32::from_le_bytes([blob[0], blob[1], blob[2], blob[3]]) as usize;
        blob = &blob[4..];
        if length == 0 || length > blob.len() {
            break;
        }
        found.push(&blob[..length]);
        blob = &blob[length..];
    }
    found
}

/// Whether this build carries a certificate whose bytes match the fingerprint it was built with.
pub fn available() -> bool {
    !CERTIFICATE.is_empty() && fingerprint(CERTIFICATE) == EXPECTED_SHA256
}

pub fn certificate_fingerprint() -> String {
    fingerprint(CERTIFICATE)
}

struct Store(HCERTSTORE);

impl Store {
    fn system(name: &str, write: bool) -> Result<Self, Error> {
        let wide: Vec<u16> = name.encode_utf16().chain(once(0)).collect();
        let flags = CERT_OPEN_STORE_FLAGS(
            CERT_SYSTEM_STORE_LOCAL_MACHINE | if write { 0 } else { CERT_STORE_READONLY_FLAG.0 },
        );
        let handle = unsafe {
            CertOpenStore(
                CERT_STORE_PROV_SYSTEM_W,
                CERT_QUERY_ENCODING_TYPE(0),
                None,
                flags,
                Some(wide.as_ptr() as *const c_void),
            )
        }
        .map_err(|error| format!("Could not open the {name} certificate store: {error}"))?;
        Ok(Self(handle))
    }

    #[cfg(test)]
    fn memory() -> Result<Self, Error> {
        let handle = unsafe {
            CertOpenStore(
                windows::Win32::Security::Cryptography::CERT_STORE_PROV_MEMORY,
                CERT_QUERY_ENCODING_TYPE(0),
                None,
                CERT_OPEN_STORE_FLAGS(0),
                None,
            )
        }?;
        Ok(Self(handle))
    }

    fn add(&self, der: &[u8]) -> Result<(), Error> {
        unsafe {
            CertAddEncodedCertificateToStore(
                Some(self.0),
                X509_ASN_ENCODING,
                der,
                CERT_STORE_ADD_REPLACE_EXISTING,
                None,
            )
        }
        .map_err(|error| format!("Could not add the certificate: {error}").into())
    }

    /// Runs `then` with the identical certificate found in this store, if there is one.
    fn find<T>(
        &self,
        der: &[u8],
        then: impl FnOnce(*const windows::Win32::Security::Cryptography::CERT_CONTEXT) -> T,
    ) -> Option<T> {
        unsafe {
            let wanted = CertCreateCertificateContext(X509_ASN_ENCODING, der);
            if wanted.is_null() {
                return None;
            }
            let found = CertFindCertificateInStore(
                self.0,
                X509_ASN_ENCODING,
                0,
                CERT_FIND_EXISTING,
                Some(wanted as *const c_void),
                None,
            );
            let result = (!found.is_null()).then(|| then(found));
            let _ = CertFreeCertificateContext(Some(wanted));
            result
        }
    }

    fn contains(&self, der: &[u8]) -> bool {
        self.find(der, |found| unsafe {
            let _ = CertFreeCertificateContext(Some(found));
        })
        .is_some()
    }

    fn remove(&self, der: &[u8]) {
        // Deleting a context also frees it.
        self.find(der, |found| unsafe {
            let _ = CertDeleteCertificateFromStore(found);
        });
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        unsafe {
            let _ = CertCloseStore(Some(self.0), 0);
        }
    }
}

/// The three stores this module works with.
struct Stores {
    root: Store,
    publisher: Store,
    disallowed: Store,
}

impl Stores {
    fn machine(write: bool) -> Result<Self, Error> {
        Ok(Self {
            root: Store::system("Root", write)?,
            publisher: Store::system("TrustedPublisher", write)?,
            disallowed: Store::system("Disallowed", write)?,
        })
    }

    fn is_trusted(&self, der: &[u8]) -> bool {
        self.root.contains(der) && self.publisher.contains(der)
    }

    fn revocations_pending(&self, revoked: &[&[u8]]) -> bool {
        revoked.iter().any(|der| {
            self.root.contains(der)
                || self.publisher.contains(der)
                || !self.disallowed.contains(der)
        })
    }

    fn apply(&self, der: &[u8], revoked: &[&[u8]]) -> Result<(), Error> {
        if !self.root.contains(der) {
            self.root.add(der)?;
        }
        if !self.publisher.contains(der) {
            self.publisher.add(der)?;
        }
        for old in revoked {
            self.root.remove(old);
            self.publisher.remove(old);
            if !self.disallowed.contains(old) {
                self.disallowed.add(old)?;
            }
        }
        Ok(())
    }

    fn withdraw(&self, der: &[u8]) {
        self.root.remove(der);
        self.publisher.remove(der);
    }
}

/// True when this computer has nothing left to do: the certificate is trusted and revocations are applied.
/// Also true when this build has no certificate. Reads only; needs no administrator rights.
pub fn settled() -> bool {
    if !available() {
        return true;
    }
    match Stores::machine(false) {
        Ok(stores) => {
            stores.is_trusted(CERTIFICATE) && !stores.revocations_pending(&parse_revoked(REVOKED))
        }
        Err(_) => false,
    }
}

/// True when the certificate is trusted here (so uninstall can offer to withdraw it).
pub fn trusted() -> bool {
    available()
        && Stores::machine(false)
            .map(|stores| stores.is_trusted(CERTIFICATE))
            .unwrap_or(false)
}

/// The elevated worker for `--trust-certificate`. Checks the fingerprint, then trusts and applies revocations.
pub fn trust_now() -> Result<(), Error> {
    if !available() {
        return Err("This installer has no certificate to trust.".into());
    }
    Stores::machine(true)?.apply(CERTIFICATE, &parse_revoked(REVOKED))
}

/// The elevated worker for `--remove-trust`.
pub fn withdraw_now() -> Result<(), Error> {
    if !available() {
        return Err("This installer has no certificate to remove.".into());
    }
    Stores::machine(true)?.withdraw(CERTIFICATE);
    Ok(())
}

/// Runs this executable again with `argument`, asking Windows for administrator approval first, and waits.
/// Returns the worker's exit code; `Err` if the person declined the prompt or it could not start.
pub fn elevated(argument: &str) -> Result<u32, Error> {
    let exe = HSTRING::from(env::current_exe()?.as_os_str());
    let parameters = HSTRING::from(argument);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(exe.as_ptr()),
        lpParameters: PCWSTR(parameters.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        ShellExecuteExW(&mut info)?;
        let process: HANDLE = info.hProcess;
        WaitForSingleObject(process, INFINITE);
        let mut code = 1u32;
        let _ = GetExitCodeProcess(process, &mut code);
        let _ = CloseHandle(process);
        Ok(code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Two throwaway self-signed certificates made only for these tests; they secure nothing.
    const ONE: &[u8] = include_bytes!("../tests/fixtures/test-one.cer");
    const TWO: &[u8] = include_bytes!("../tests/fixtures/test-two.cer");

    fn stores() -> Stores {
        Stores {
            root: Store::memory().unwrap(),
            publisher: Store::memory().unwrap(),
            disallowed: Store::memory().unwrap(),
        }
    }

    #[test]
    fn fingerprints_are_upper_case_hex_in_readable_groups() {
        let hex = fingerprint(b"beacon");
        assert_eq!(hex.len(), 64);
        assert!(hex
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_lowercase()));
        let shown = grouped(&hex);
        assert_eq!(shown.lines().count(), 2);
        assert_eq!(shown.replace([' ', '\n'], ""), hex);
    }

    #[test]
    fn the_revoked_bundle_is_read_and_a_truncated_one_is_not_trusted() {
        let mut blob = Vec::new();
        for item in [ONE, TWO] {
            blob.extend_from_slice(&(item.len() as u32).to_le_bytes());
            blob.extend_from_slice(item);
        }
        assert_eq!(parse_revoked(&blob), vec![ONE, TWO]);
        assert_eq!(parse_revoked(&blob[..blob.len() - 1]), vec![ONE]);
        assert!(parse_revoked(&[]).is_empty());
    }

    #[test]
    fn trusting_adds_to_both_stores_once_and_withdrawing_removes_only_that_certificate() {
        let stores = stores();
        assert!(!stores.is_trusted(ONE));
        stores.apply(ONE, &[]).unwrap();
        stores.apply(ONE, &[]).unwrap();
        assert!(stores.is_trusted(ONE));
        assert!(!stores.is_trusted(TWO));
        stores.root.add(TWO).unwrap();
        stores.withdraw(ONE);
        assert!(!stores.root.contains(ONE) && !stores.publisher.contains(ONE));
        assert!(
            stores.root.contains(TWO),
            "another certificate is left alone"
        );
    }

    #[test]
    fn a_revoked_certificate_is_removed_from_trust_and_blocked() {
        let stores = stores();
        stores.apply(TWO, &[]).unwrap();
        assert!(stores.is_trusted(TWO));
        assert!(!stores.revocations_pending(&[]));
        assert!(stores.revocations_pending(&[TWO]));
        stores.apply(ONE, &[TWO]).unwrap();
        assert!(!stores.root.contains(TWO) && !stores.publisher.contains(TWO));
        assert!(stores.disallowed.contains(TWO));
        assert!(stores.is_trusted(ONE));
        assert!(
            !stores.revocations_pending(&[TWO]),
            "nothing left to do once applied"
        );
    }
}
