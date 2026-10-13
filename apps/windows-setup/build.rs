// Embeds the icon and an asInvoker manifest (so Windows does not guess that a file named "setup" needs
// administrator rights), and bundles the payload the installer lays down.
//
// BEACON_PAYLOAD_DIR points at a built package directory (the three executables and manifest.json). Without
// it, empty placeholders are bundled and the installer refuses to run, which keeps `cargo check` working.
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
}
