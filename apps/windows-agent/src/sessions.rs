use serde_json::Value;
use std::{
    collections::HashMap,
    io::Write,
    process::{Child, Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Default)]
pub struct Helpers {
    #[cfg(windows)]
    job: Option<crate::helper_lifetime::Job>,
    children: HashMap<String, (u64, Child)>,
    handled: HashMap<String, u64>,
}
impl Helpers {
    pub fn update(&mut self, body: Value, server: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now: u64 = SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_millis()
            .try_into()?;
        self.children.retain(|_, (expiry, child)| {
            if *expiry <= now {
                let _ = child.kill();
                let _ = child.wait();
                return false;
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
            if expiry <= now || expiry - now > 120_000 || self.handled.contains_key(id) {
                continue;
            }
            if self.handled.len() >= 8 || !self.children.is_empty() {
                continue;
            }
            if !matches!(grant["source"].as_str(), Some("synthetic" | "desktop")) {
                continue;
            }
            let mut payload = grant.clone();
            payload
                .as_object_mut()
                .ok_or("Invalid session grant")?
                .insert("server".into(), Value::String(server.into()));
            let bytes = serde_json::to_vec(&payload)?;
            if bytes.len() > 8192 {
                return Err("Session grant too large".into());
            }
            self.handled.insert(id.into(), expiry);
            #[cfg(windows)]
            if self.job.is_none() {
                self.job = Some(crate::helper_lifetime::Job::new()?);
            }
            let helper = std::env::current_exe()?
                .parent()
                .ok_or("Agent directory missing")?
                .join("beacon-remote-session.exe");
            let mut child = match Command::new(helper)
                .arg("media-test")
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
            let sent = child
                .stdin
                .take()
                .ok_or("Helper input unavailable")
                .and_then(|mut input| {
                    input
                        .write_all(&bytes)
                        .map_err(|_| "Could not pass session grant")
                });
            if sent.is_err() {
                let _ = child.kill();
                let _ = child.wait();
                println!("Video helper could not start.");
                continue;
            }
            self.children.insert(id.into(), (expiry, child));
        }
        Ok(())
    }
}
impl Drop for Helpers {
    fn drop(&mut self) {
        for (_, child) in self.children.values_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
