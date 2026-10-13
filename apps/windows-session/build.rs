// Embeds the Beacon icon in the executables (title bars, taskbar, Explorer).
fn main() {
    #[cfg(windows)]
    embed_resource::compile("beacon.rc", embed_resource::NONE)
        .manifest_optional()
        .unwrap();
    println!("cargo:rerun-if-changed=beacon.rc");
    println!("cargo:rerun-if-changed=beacon.ico");
}
