//! Signed host updates (ADR 0028). The server publishes a manifest and an Ed25519 signature over its
//! exact bytes; this host trusts only the public key built into it. An update is offered only when
//! the feed is newer than what is installed, is downloaded and checked against its hash, and replaces
//! the install only after the running host has exited. The previous files are kept for rollback.
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

type Error = Box<dyn std::error::Error + Send + Sync>;

const PUBLIC_KEY: &str = "Pkg2hiPnIDGXW8wdP0IwNAmVcI9WrR5VuYDuFMEK150=";
const MAX_ARCHIVE: u64 = 64 * 1024 * 1024;
const PACKAGE_KIND: &str = "beacon-remote-development-v2";
const REQUIRED: [&str; 3] = [
    "beacon-remote-agent.exe",
    "beacon-remote-host.exe",
    "beacon-remote-session.exe",
];

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub version: String,
    pub commit: String,
    pub file: String,
    pub bytes: u64,
    pub sha256: String,
    pub sequence: u64,
}

#[derive(Deserialize)]
struct PackageManifest {
    kind: String,
    commit: String,
    files: Vec<PackageFile>,
}
#[derive(Deserialize)]
struct PackageFile {
    name: String,
    sha256: String,
}
#[derive(Deserialize)]
struct Installed {
    commit: Option<String>,
    sequence: Option<u64>,
}

fn is_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Checks the signature over the exact manifest bytes, then the manifest's own shape.
pub fn verify_feed(manifest: &[u8], signature: &str) -> Result<Feed, Error> {
    verify_feed_with(PUBLIC_KEY, manifest, signature)
}

fn verify_feed_with(public_key: &str, manifest: &[u8], signature: &str) -> Result<Feed, Error> {
    let key: [u8; 32] = STANDARD
        .decode(public_key)?
        .try_into()
        .map_err(|_| "Bad update key")?;
    let signature: [u8; 64] = STANDARD
        .decode(signature.trim())?
        .try_into()
        .map_err(|_| "Bad update signature")?;
    VerifyingKey::from_bytes(&key)?
        .verify(manifest, &Signature::from_bytes(&signature))
        .map_err(|_| "The update feed is not signed by the Beacon Remote update key")?;
    let feed: Feed = serde_json::from_slice(manifest)?;
    let name_ok = feed
        .file
        .strip_prefix("BeaconRemoteDevelopment-")
        .is_some_and(|rest| {
            rest.strip_suffix(".zip").is_some_and(|commit| {
                (8..=40).contains(&commit.len()) && is_hex(commit, commit.len())
            })
        });
    if !name_ok
        || !is_hex(&feed.sha256, 64)
        || feed.bytes == 0
        || feed.bytes > MAX_ARCHIVE
        || !(8..=40).contains(&feed.commit.len())
        || !is_hex(&feed.commit, feed.commit.len())
    {
        return Err("The update feed is malformed".into());
    }
    Ok(feed)
}

fn install_dir() -> Result<PathBuf, Error> {
    Ok(std::env::current_exe()?
        .parent()
        .ok_or("Install directory missing")?
        .to_path_buf())
}

fn installed(dir: &Path) -> Installed {
    let read = |name: &str| fs::read(dir.join(name)).ok();
    let commit = read("manifest.json")
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| value["commit"].as_str().map(str::to_owned));
    let sequence = read("installed.json")
        .and_then(|bytes| serde_json::from_slice::<Installed>(&bytes).ok())
        .and_then(|record| record.sequence);
    Installed {
        commit: commit.map(|c| c.chars().take(8).collect()),
        sequence,
    }
}

/// Whether `feed` is something to offer: a different build, and newer than what was last installed
/// from a feed (so an old signed manifest cannot be replayed to roll the host back).
pub fn is_newer(feed: &Feed, installed_commit: Option<&str>, installed_sequence: u64) -> bool {
    let same = installed_commit.is_some_and(|commit| feed.commit.starts_with(commit));
    !same && feed.sequence > installed_sequence
}

fn get(
    client: &reqwest::blocking::Client,
    url: reqwest::Url,
    limit: u64,
) -> Result<Vec<u8>, Error> {
    let response = client.get(url).timeout(Duration::from_secs(30)).send()?;
    if !response.status().is_success() {
        return Err("The update server did not answer".into());
    }
    let mut body = Vec::new();
    response.take(limit + 1).read_to_end(&mut body)?;
    if body.len() as u64 > limit {
        return Err("The update response is too large".into());
    }
    Ok(body)
}

/// Asks the server for the signed feed. `None` means this host is current.
pub fn check(
    client: &reqwest::blocking::Client,
    server: &reqwest::Url,
) -> Result<Option<Feed>, Error> {
    let manifest = get(client, server.join("downloads/manifest.json")?, 16 * 1024)?;
    let signature = get(client, server.join("downloads/manifest.sig")?, 1024)?;
    let feed = verify_feed(&manifest, std::str::from_utf8(&signature)?)?;
    let here = installed(&install_dir()?);
    Ok(is_newer(&feed, here.commit.as_deref(), here.sequence.unwrap_or(0)).then_some(feed))
}

/// Downloads the package, checks its hash, extracts only the expected flat files and checks each
/// against the package's own manifest. Returns the staging directory.
pub fn stage(
    client: &reqwest::blocking::Client,
    server: &reqwest::Url,
    feed: &Feed,
    work: &Path,
) -> Result<PathBuf, Error> {
    let staging = work.join(&feed.commit);
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging)?;
    let archive_path = staging.join("package.zip");
    let url = server.join(&format!("downloads/{}", feed.file))?;
    let mut response = client.get(url).timeout(Duration::from_secs(300)).send()?;
    if !response.status().is_success() {
        return Err("The update download failed".into());
    }
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    {
        let mut out = fs::File::create(&archive_path)?;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = response.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            total += read as u64;
            if total > feed.bytes {
                return Err("The update is larger than its feed says".into());
            }
            hasher.update(&buffer[..read]);
            out.write_all(&buffer[..read])?;
        }
    }
    let digest: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if total != feed.bytes || digest != feed.sha256 {
        return Err("The downloaded update does not match its signed hash".into());
    }
    extract(&archive_path, &staging, feed)?;
    fs::remove_file(&archive_path)?;
    Ok(staging)
}

fn extract(archive: &Path, into: &Path, feed: &Feed) -> Result<(), Error> {
    let mut zip = zip::ZipArchive::new(fs::File::open(archive)?)?;
    for index in 0..zip.len() {
        let entry = zip.by_index(index)?;
        let name = entry.name().to_owned();
        // Flat files only, from a fixed set: nothing can land outside the staging directory.
        let allowed = REQUIRED.contains(&name.as_str())
            || matches!(
                name.as_str(),
                "Uninstall.ps1" | "Install.ps1" | "README.txt" | "manifest.json"
            );
        if !allowed || entry.is_dir() || entry.size() > MAX_ARCHIVE {
            return Err(format!("Unexpected entry in the update: {name}").into());
        }
        let mut out = fs::File::create(into.join(&name))?;
        io::copy(&mut entry.take(MAX_ARCHIVE), &mut out)?;
    }
    let manifest: PackageManifest = serde_json::from_slice(&fs::read(into.join("manifest.json"))?)?;
    if manifest.kind != PACKAGE_KIND
        || !feed
            .commit
            .starts_with(&manifest.commit.chars().take(8).collect::<String>())
    {
        return Err("The update's own manifest does not match the feed".into());
    }
    for required in REQUIRED {
        let entry = manifest
            .files
            .iter()
            .find(|file| file.name == required)
            .ok_or("The update is missing a program file")?;
        let digest: String = Sha256::digest(fs::read(into.join(required))?)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if !digest.eq_ignore_ascii_case(&entry.sha256) {
            return Err("A program file in the update is damaged".into());
        }
    }
    Ok(())
}

fn payload(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = REQUIRED.iter().map(|s| (*s).to_owned()).collect();
    names.push("Uninstall.ps1".into());
    names.push("manifest.json".into());
    names.retain(|name| dir.join(name).is_file());
    names
}

#[cfg(windows)]
fn wait_for_exit(pid: u32) {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
    };
    unsafe {
        let handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if !handle.is_null() {
            WaitForSingleObject(handle, 30_000);
            CloseHandle(handle);
        }
    }
}
#[cfg(not(windows))]
fn wait_for_exit(_pid: u32) {}

fn copy_retrying(from: &Path, to: &Path) -> io::Result<()> {
    let mut last = None;
    for _ in 0..20 {
        match fs::copy(from, to) {
            Ok(_) => return Ok(()),
            Err(error) => {
                last = Some(error);
                std::thread::sleep(Duration::from_millis(300));
            }
        }
    }
    Err(last.unwrap_or_else(|| io::Error::other("copy failed")))
}

fn relaunch(install: &Path) {
    let mut command = std::process::Command::new(install.join("beacon-remote-host.exe"));
    command.current_dir(install);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0000_0008 | 0x0800_0000);
    }
    let _ = command.spawn();
}

/// Starts the staged copy of the host, which waits for this one to exit and then swaps the files.
pub fn begin_apply(staged: &Path, feed: &Feed) -> Result<(), Error> {
    let mut command = std::process::Command::new(staged.join("beacon-remote-host.exe"));
    command
        .arg("--apply-update")
        .arg(install_dir()?)
        .arg(std::process::id().to_string())
        .arg(feed.sequence.to_string())
        .current_dir(staged);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0000_0008 | 0x0800_0000);
    }
    command.spawn()?;
    Ok(())
}

/// Run by the staged host: keep the old files, install the new ones, record the feed sequence,
/// and start the updated host. Any failure puts the old files back.
pub fn apply(install: &Path, old_pid: u32, sequence: u64) -> Result<(), Error> {
    let staged = std::env::current_exe()?
        .parent()
        .ok_or("Staging directory missing")?
        .to_path_buf();
    apply_with(&staged, install, old_pid, sequence, true)
}

fn apply_with(
    staged: &Path,
    install: &Path,
    old_pid: u32,
    sequence: u64,
    restart: bool,
) -> Result<(), Error> {
    wait_for_exit(old_pid);
    let previous = install.join("previous");
    let _ = fs::remove_dir_all(&previous);
    fs::create_dir_all(&previous)?;
    for name in payload(install) {
        copy_retrying(&install.join(&name), &previous.join(&name))?;
    }
    let result = (|| -> Result<(), Error> {
        for name in payload(staged) {
            copy_retrying(&staged.join(&name), &install.join(&name))?;
        }
        let commit = installed(install).commit.unwrap_or_default();
        fs::write(
            install.join("installed.json"),
            serde_json::to_vec(&serde_json::json!({"commit": commit, "sequence": sequence}))?,
        )?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = restore(install);
        return Err(error);
    }
    if restart {
        relaunch(install);
    }
    Ok(())
}

/// Puts the files kept by the last update back and starts that version.
pub fn rollback(install: &Path) -> Result<(), Error> {
    restore(install)?;
    // The sequence is left as is, so the feed that was just rolled back is not offered again
    // until a newer one is published.
    relaunch(install);
    Ok(())
}

#[cfg(test)]
fn rollback_files(install: &Path) -> Result<(), Error> {
    restore(install)
}

fn restore(install: &Path) -> Result<(), Error> {
    let previous = install.join("previous");
    let names = payload(&previous);
    if names.is_empty() {
        return Err("There is no previous version to go back to".into());
    }
    for name in names {
        copy_retrying(&previous.join(&name), &install.join(&name))?;
    }
    Ok(())
}

pub fn work_dir() -> Result<PathBuf, Error> {
    let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA required")?;
    Ok(PathBuf::from(local).join("BeaconRemote").join("updates"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn feed_json(file: &str, sha: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "version":"development-aaaaaaaa","commit":"aaaaaaaa","file":file,
            "bytes":1000,"sha256":sha,"sequence":5
        }))
        .unwrap()
    }

    #[test]
    fn only_the_built_in_key_is_trusted_and_the_manifest_must_be_well_formed() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let public = STANDARD.encode(key.verifying_key().to_bytes());
        let good = feed_json("BeaconRemoteDevelopment-aaaaaaaa.zip", &"a".repeat(64));
        let sign = |bytes: &[u8]| STANDARD.encode(key.sign(bytes).to_bytes());
        assert!(verify_feed_with(&public, &good, &sign(&good)).is_ok());
        // A signature from a different key, or over different bytes, is refused.
        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert!(verify_feed_with(
            &public,
            &good,
            &STANDARD.encode(other.sign(&good).to_bytes())
        )
        .is_err());
        let changed = feed_json("BeaconRemoteDevelopment-bbbbbbbb.zip", &"a".repeat(64));
        assert!(verify_feed_with(&public, &changed, &sign(&good)).is_err());
        // Signed but malformed or path-like manifests are still refused.
        for bad in [
            feed_json("..\\evil.zip", &"a".repeat(64)),
            feed_json("BeaconRemoteDevelopment-aaaaaaaa.exe", &"a".repeat(64)),
            feed_json("BeaconRemoteDevelopment-aaaaaaaa.zip", "XYZ"),
        ] {
            assert!(verify_feed_with(&public, &bad, &sign(&bad)).is_err());
        }
        // The key built into the host is a real Ed25519 key.
        let built_in: [u8; 32] = STANDARD.decode(PUBLIC_KEY).unwrap().try_into().unwrap();
        assert!(VerifyingKey::from_bytes(&built_in).is_ok());
    }

    fn package(dir: &Path, commit: &str, body: &str) {
        fs::create_dir_all(dir).unwrap();
        let mut files = Vec::new();
        for name in REQUIRED.iter().chain(["Uninstall.ps1"].iter()) {
            let content = format!("{name}:{body}");
            fs::write(dir.join(name), &content).unwrap();
            let digest: String = Sha256::digest(content.as_bytes())
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            files.push(serde_json::json!({"name": name, "sha256": digest}));
        }
        fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "kind": PACKAGE_KIND, "commit": commit, "files": files
            }))
            .unwrap(),
        )
        .unwrap();
    }
    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("beacon-update-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn zip_of(dir: &Path, extra: Option<(&str, &str)>, out: &Path) {
        let mut writer = zip::ZipWriter::new(fs::File::create(out).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            writer
                .start_file(entry.file_name().to_string_lossy(), options)
                .unwrap();
            writer.write_all(&fs::read(entry.path()).unwrap()).unwrap();
        }
        if let Some((name, body)) = extra {
            writer.start_file(name, options).unwrap();
            writer.write_all(body.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
    }
    fn feed_for(commit: &str) -> Feed {
        Feed {
            version: format!("development-{commit}"),
            commit: commit.into(),
            file: format!("BeaconRemoteDevelopment-{commit}.zip"),
            bytes: 1,
            sha256: "a".repeat(64),
            sequence: 7,
        }
    }

    #[test]
    fn an_update_package_is_extracted_only_if_it_is_what_the_feed_says() {
        let root = scratch("extract");
        let source = root.join("source");
        package(&source, "bbbbbbbb", "new");
        let good = root.join("good.zip");
        zip_of(&source, None, &good);
        let into = root.join("good");
        fs::create_dir_all(&into).unwrap();
        assert!(extract(&good, &into, &feed_for("bbbbbbbb")).is_ok());
        // A package for a different build than the signed feed names is refused.
        let wrong = root.join("wrong");
        fs::create_dir_all(&wrong).unwrap();
        assert!(extract(&good, &wrong, &feed_for("cccccccc")).is_err());
        // Anything outside the fixed flat file set (a path trick, an extra program) is refused.
        for name in [r"..\evil.exe", "sub/evil.exe", "extra.exe"] {
            let bad = root.join("bad.zip");
            zip_of(&source, Some((name, "x")), &bad);
            let out = root.join("bad");
            let _ = fs::remove_dir_all(&out);
            fs::create_dir_all(&out).unwrap();
            assert!(
                extract(&bad, &out, &feed_for("bbbbbbbb")).is_err(),
                "{name}"
            );
        }
        // A damaged program file is refused even though the archive itself is intact.
        fs::write(source.join("beacon-remote-host.exe"), "tampered").unwrap();
        let damaged = root.join("damaged.zip");
        zip_of(&source, None, &damaged);
        let out = root.join("damaged");
        fs::create_dir_all(&out).unwrap();
        assert!(extract(&damaged, &out, &feed_for("bbbbbbbb")).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn applying_keeps_the_old_files_records_the_feed_and_can_be_rolled_back() {
        let root = scratch("apply");
        let (install, staged) = (root.join("install"), root.join("staged"));
        package(&install, "aaaaaaaa", "old");
        package(&staged, "bbbbbbbb", "new");
        apply_with(&staged, &install, 0, 42, false).unwrap();
        assert_eq!(
            fs::read_to_string(install.join("beacon-remote-host.exe")).unwrap(),
            "beacon-remote-host.exe:new"
        );
        assert_eq!(
            fs::read_to_string(root.join("install/previous/beacon-remote-host.exe")).unwrap(),
            "beacon-remote-host.exe:old"
        );
        let here = installed(&install);
        assert_eq!(here.commit.as_deref(), Some("bbbbbbbb"));
        assert_eq!(here.sequence, Some(42));
        rollback_files(&install).unwrap();
        assert_eq!(
            fs::read_to_string(install.join("beacon-remote-host.exe")).unwrap(),
            "beacon-remote-host.exe:old"
        );
        assert_eq!(installed(&install).commit.as_deref(), Some("aaaaaaaa"));
        // With nothing kept there is nothing to roll back to.
        assert!(rollback_files(&root.join("staged")).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn an_old_or_same_feed_is_not_offered() {
        let feed = Feed {
            version: "v".into(),
            commit: "aaaaaaaa11".into(),
            file: "BeaconRemoteDevelopment-aaaaaaaa.zip".into(),
            bytes: 1,
            sha256: "a".repeat(64),
            sequence: 10,
        };
        assert!(is_newer(&feed, Some("bbbbbbbb"), 5));
        assert!(!is_newer(&feed, Some("aaaaaaaa"), 5), "same build");
        assert!(
            !is_newer(&feed, Some("bbbbbbbb"), 10),
            "replayed older feed"
        );
        assert!(is_newer(&feed, None, 0));
    }
}
