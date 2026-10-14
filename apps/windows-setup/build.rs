// Embeds the icon and an asInvoker manifest (so Windows does not guess that a file named "setup" needs
// administrator rights), and bundles the payload the installer lays down.
//
// BEACON_PAYLOAD_DIR points at a built package directory (the three executables and manifest.json). Without
// it, empty placeholders are bundled and the installer refuses to run, which keeps `cargo check` working.
//
// BEACON_TRUST_DIR points at the output of `scripts/Beacon-Signing.ps1 -Action Package`: the public signing
// certificate (beacon-remote-signing.cer) and any revoked certificates (revoked\*.cer). They are bundled so the
// installer can offer one-time trust; without them the installer simply has no trust step (ADR 0035).
use sha2::{Digest, Sha256};
use std::{env, fs, path::PathBuf};

const FILES: [&str; 4] = [
    "beacon-remote-agent.exe",
    "beacon-remote-host.exe",
    "beacon-remote-session.exe",
    "manifest.json",
];

fn main() {
    #[cfg(windows)]
    embed_resource::compile("beacon.rc", embed_resource::NONE)
        .manifest_required()
        .unwrap();
    println!("cargo:rerun-if-changed=beacon.rc");
    println!("cargo:rerun-if-changed=beacon.ico");
    println!("cargo:rerun-if-changed=setup.manifest");
    println!("cargo:rerun-if-env-changed=BEACON_PAYLOAD_DIR");
    println!("cargo:rerun-if-env-changed=BEACON_TRUST_DIR");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let source = env::var_os("BEACON_PAYLOAD_DIR").map(PathBuf::from);
    for name in FILES {
        match &source {
            Some(dir) => {
                let from = dir.join(name);
                println!("cargo:rerun-if-changed={}", from.display());
                fs::copy(&from, out.join(name))
                    .unwrap_or_else(|error| panic!("payload file {}: {error}", from.display()));
            }
            None => fs::write(out.join(name), b"").unwrap(),
        }
    }
    if source.is_none() {
        println!("cargo:rustc-env=BEACON_PAYLOAD_STUB=1");
    } else {
        println!("cargo:rustc-env=BEACON_PAYLOAD_STUB=0");
    }
    bundle_trust(&out);
}

/// Writes `signing.cer` (the public certificate, or empty), `revoked.bin` (each revoked certificate as a
/// little-endian u32 length and its bytes) and the certificate's SHA-256 as `BEACON_CERT_SHA256`.
fn bundle_trust(out: &std::path::Path) {
    let dir = env::var_os("BEACON_TRUST_DIR").map(PathBuf::from);
    let mut certificate = Vec::new();
    let mut revoked = Vec::new();
    if let Some(dir) = &dir {
        let cer = dir.join("beacon-remote-signing.cer");
        println!("cargo:rerun-if-changed={}", cer.display());
        certificate = fs::read(&cer)
            .unwrap_or_else(|error| panic!("trust certificate {}: {error}", cer.display()));
        if let Ok(entries) = fs::read_dir(dir.join("revoked")) {
            let mut files: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
            files.sort();
            for file in files
                .into_iter()
                .filter(|file| file.extension().is_some_and(|e| e == "cer"))
            {
                let bytes = fs::read(&file).unwrap();
                revoked.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                revoked.extend_from_slice(&bytes);
            }
        }
    }
    let fingerprint: String = Sha256::digest(&certificate)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect();
    fs::write(out.join("signing.cer"), &certificate).unwrap();
    fs::write(out.join("revoked.bin"), &revoked).unwrap();
    println!(
        "cargo:rustc-env=BEACON_CERT_SHA256={}",
        if certificate.is_empty() {
            ""
        } else {
            &fingerprint
        }
    );
}
