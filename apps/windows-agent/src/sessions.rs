use serde_json::Value;
use std::{
    collections::HashMap,
    io::Write,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, Weak,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

type HelperEntry = (Option<u64>, Child, Arc<Mutex<ChildStdin>>);

pub struct Helpers {
    #[cfg(windows)]
    job: Option<crate::helper_lifetime::Job>,
    // None: no fixed expiry. The helper ends itself on Stop, revocation or a lapsed lease.
    children: HashMap<String, HelperEntry>,
    handled: HashMap<String, u64>,
    cancel: Arc<AtomicBool>,
    watcher: Option<thread::JoinHandle<()>>,
    stops: Arc<Mutex<Vec<Weak<Mutex<ChildStdin>>>>>,
}
impl Helpers {
    pub fn new(cancel: Arc<AtomicBool>) -> Self {
        let stops: Arc<Mutex<Vec<Weak<Mutex<ChildStdin>>>>> = Arc::new(Mutex::new(Vec::new()));
        let writers = stops.clone();
        let stopping = cancel.clone();
        let watcher = thread::spawn(move || {
            while !stopping.load(Ordering::Acquire) {
                thread::sleep(Duration::from_millis(50));
            }
            if let Ok(writers) = writers.lock() {
                for writer in writers.iter().filter_map(Weak::upgrade) {
                    if let Ok(mut pipe) = writer.lock() {
                        let _ = pipe.write_all(b"stop\n");
                    }
                }
            }
        });
        Self {
            #[cfg(windows)]
            job: None,
            children: HashMap::new(),
            handled: HashMap::new(),
            cancel,
            watcher: Some(watcher),
            stops,
        }
    }
    pub fn handled(&self, id: &str) -> bool {
        self.handled.contains_key(id)
    }

    pub fn update(
        &mut self,
        body: Value,
        server: &str,
        local: crate::LocalAccess,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if self.cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        let now: u64 = SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_millis()
            .try_into()?;
        self.children.retain(|_, (expiry, child, pipe)| {
            if expiry.is_some_and(|end| end <= now) {
                if let Ok(mut pipe) = pipe.lock() {
                    let _ = pipe.write_all(b"stop\n");
                }
            }
            match child.try_wait() {
                Ok(None) => true,
                Ok(Some(_)) => false,
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    false
                }
            }
        });
        self.handled.retain(|_, expiry| *expiry > now);
        let Some(grants) = body.get("sessions").and_then(Value::as_array) else {
            return Ok(());
        };
        if grants.len() > 1 {
            return Err("Unexpected session response".into());
        }
        for grant in grants {
            let id = grant["id"].as_str().ok_or("Invalid session ID")?;
            uuid::Uuid::parse_str(id)?;
            let expiry = grant["expiresAtMillis"]
                .as_u64()
                .ok_or("Invalid session expiry")?;
            // A request is answered within two minutes; the session it opens is not capped by that.
            let approval = if expiry == 0 {
                grant["approvalExpiresAtMillis"]
                    .as_u64()
                    .ok_or("Missing approval deadline")?
            } else {
                expiry
            };
            if approval <= now || approval - now > 120_000 || self.handled.contains_key(id) {
                continue;
            }
            if self.handled.len() >= 8 || !self.children.is_empty() {
                continue;
            }
            if !matches!(grant["source"].as_str(), Some("synthetic" | "desktop")) {
                continue;
            }
            let mut payload = grant.clone();
            let object = payload.as_object_mut().ok_or("Invalid session grant")?;
            object.insert("server".into(), Value::String(server.into()));
            // This computer's own setting: both it and the server must agree before the helper
            // skips the local Allow.
            let controlling = grant["capability"].as_str() == Some("desktop:control");
            // A remembered helper is covered by the helpers setting, not by trusted access.
            let trusted_here = if grant["viaRelationship"].as_bool() == Some(true) {
                local.helpers >= if controlling { 2 } else { 1 }
            } else {
                local.trusted && (!controlling || local.allow_control)
            };
            // File transfer without the consent window only for this account's own sessions.
            let files_here =
                grant["viaRelationship"].as_bool() != Some(true) && local.trusted && local.files;
            object.remove("viaRelationship");
            object.insert("localTrusted".into(), Value::Bool(trusted_here));
            object.insert("localFiles".into(), Value::Bool(trusted_here && files_here));
            // The account's own sessions may be recorded by its owner; helpers need the consent box.
            let own_session = grant["viaRelationship"].as_bool() != Some(true) && local.trusted;
            object.insert(
                "localRecording".into(),
                Value::Bool(trusted_here && own_session),
            );
            let bytes = serde_json::to_vec(&payload)?;
            if bytes.len() > 8192 {
                return Err("Session grant too large".into());
            }
            self.handled.insert(id.into(), approval);
            #[cfg(windows)]
            if self.job.is_none() {
                self.job = Some(crate::helper_lifetime::Job::new()?);
            }
            let helper = std::env::current_exe()?
                .parent()
                .ok_or("Agent directory missing")?
                .join("beacon-remote-session.exe");
            let mut child = match Command::new(helper)
                .arg("media-host")
                .stdin(Stdio::piped())
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .spawn()
            {
                Ok(child) => child,
                Err(_) => {
                    println!("Video helper unavailable; install matching development binaries.");
                    continue;
                }
            };
            #[cfg(windows)]
            if self
                .job
                .as_ref()
                .ok_or("Helper job unavailable")?
                .assign(&child)
                .is_err()
            {
                let _ = child.kill();
                let _ = child.wait();
                println!("Video helper could not be bound to the agent lifetime.");
                continue;
            }
            let mut pipe = child.stdin.take().ok_or("Helper input unavailable")?;
            let sent = pipe.write_all(&bytes).and_then(|()| pipe.write_all(b"\n"));
            if sent.is_err() {
                let _ = child.kill();
                let _ = child.wait();
                println!("Video helper could not start.");
                continue;
            }
            let pipe = Arc::new(Mutex::new(pipe));
            {
                let mut stops = self
                    .stops
                    .lock()
                    .map_err(|_| "Helper control unavailable")?;
                stops.retain(|stop| stop.strong_count() > 0);
                stops.push(Arc::downgrade(&pipe));
            }
            if self.cancel.load(Ordering::Acquire) {
                if let Ok(mut pipe) = pipe.lock() {
                    let _ = pipe.write_all(b"stop\n");
                }
            }
            self.children
                .insert(id.into(), ((expiry != 0).then_some(expiry), child, pipe));
        }
        Ok(())
    }
}
impl Drop for Helpers {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
        for (_, _, pipe) in self.children.values() {
            if let Ok(mut pipe) = pipe.lock() {
                let _ = pipe.write_all(b"stop\n");
            }
        }
        if let Some(watcher) = self.watcher.take() {
            let _ = watcher.join();
        }
        let until = Instant::now() + Duration::from_secs(10);
        for (_, child, _) in self.children.values_mut() {
            while Instant::now() < until && matches!(child.try_wait(), Ok(None)) {
                thread::sleep(Duration::from_millis(50));
            }
            if matches!(child.try_wait(), Ok(None) | Err(_)) {
                println!(
                    "Helper did not finish graceful shutdown; held-input cleanup is unverified."
                );
                let _ = child.kill();
            }
            let _ = child.wait();
        }
    }
}
