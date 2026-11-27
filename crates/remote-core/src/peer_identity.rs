//! Peer authentication above signaling (ADR 0061, foundation). The Rust twin of
//! `packages/protocol/src/peer-identity.ts`: both build the same bytes and are tested against the same vector
//! (`packages/protocol/test-vectors/peer-statement-v1.json`). A host signs a short statement with its machine key;
//! the viewer checks it against the key it pinned. Nothing here enforces anything until the hosts sign and the viewer
//! verifies (ADR 0061, later steps).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// A statement is good for one minute at most, so a captured one is of no later use.
pub const MAX_STATEMENT_MS: u64 = 60_000;
/// How far apart two clocks may be before a good proof is called expired (see the TypeScript twin).
pub const CLOCK_SKEW_MS: u64 = 120_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Host,
    Viewer,
}

impl Role {
    fn word(self) -> &'static str {
        match self {
            Self::Host => "host",
            Self::Viewer => "viewer",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Statement {
    pub session_id: String,
    pub generation: u64,
    pub role: Role,
    /// The DTLS fingerprint as in the SDP: `sha-256 ` then 32 colon-separated uppercase hex bytes.
    pub fingerprint: String,
    /// Chosen by the other side, so a signed statement cannot be replayed into another connection.
    pub nonce: String,
    pub expires_at_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Problem {
    Malformed,
    Expired,
    WrongSignature,
    WrongKey,
}

fn session_ok(text: &str) -> bool {
    let groups: Vec<&str> = text.split('-').collect();
    groups.len() == 5
        && groups.iter().zip([8, 4, 4, 4, 12]).all(|(group, length)| {
            group.len() == length
                && group
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
}

fn fingerprint_ok(text: &str) -> bool {
    let Some(rest) = text.strip_prefix("sha-256 ") else {
        return false;
    };
    let bytes: Vec<&str> = rest.split(':').collect();
    bytes.len() == 32
        && bytes.iter().all(|byte| {
            byte.len() == 2
                && byte
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'A'..=b'F').contains(&c))
        })
}

fn nonce_ok(text: &str) -> bool {
    (16..=64).contains(&text.len())
        && text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

impl Statement {
    /// Whether every field has the exact shape the other side rebuilds; nothing can smuggle in a line break.
    pub fn well_formed(&self) -> bool {
        session_ok(&self.session_id)
            && self.generation <= 1024
            && fingerprint_ok(&self.fingerprint)
            && nonce_ok(&self.nonce)
            && self.expires_at_ms > 0
            && self.expires_at_ms < (1u64 << 53)
    }

    /// The exact bytes that are signed: a version line, then one `name:value` line per field.
    pub fn bytes(&self) -> Result<Vec<u8>, Problem> {
        if !self.well_formed() {
            return Err(Problem::Malformed);
        }
        Ok(format!(
            "beacon-peer-v1\nsession:{}\ngeneration:{}\nrole:{}\nfingerprint:{}\nnonce:{}\nexpires:{}",
            self.session_id,
            self.generation,
            self.role.word(),
            self.fingerprint,
            self.nonce,
            self.expires_at_ms
        )
        .into_bytes())
    }
}

/// Signs a statement; the signature is URL-safe base64 without padding, as on the wire.
pub fn sign(key: &SigningKey, statement: &Statement) -> Result<String, Problem> {
    Ok(URL_SAFE_NO_PAD.encode(key.sign(&statement.bytes()?).to_bytes()))
}

/// Checks a statement against the key pinned for this computer. The caller builds `statement` from what it knows
/// itself (its own nonce, the session and generation it is in, the fingerprint in the SDP it was given), so a
/// difference in any of those fails the signature even if the signer was honest about something else.
pub fn verify(
    public_key: &[u8; 32],
    statement: &Statement,
    signature: &str,
    now_ms: u64,
) -> Result<(), Problem> {
    let bytes = statement.bytes()?;
    if statement.expires_at_ms + CLOCK_SKEW_MS <= now_ms
        || statement.expires_at_ms.saturating_sub(now_ms) > MAX_STATEMENT_MS + CLOCK_SKEW_MS
    {
        return Err(Problem::Expired);
    }
    let raw = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| Problem::Malformed)?;
    let raw: [u8; 64] = raw.try_into().map_err(|_| Problem::Malformed)?;
    let key = VerifyingKey::from_bytes(public_key).map_err(|_| Problem::WrongKey)?;
    key.verify(&bytes, &Signature::from_bytes(&raw))
        .map_err(|_| Problem::WrongSignature)
}

/// The machine key stays in the host process; for each session the host signs a delegation naming a key it minted for
/// that session, and the capture helper holds only that key (ADR 0061, integration design).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Delegation {
    pub session_id: String,
    /// The session key's public half, URL-safe base64 without padding.
    pub session_key: String,
    pub expires_at_ms: u64,
}

impl Delegation {
    pub fn well_formed(&self) -> bool {
        session_ok(&self.session_id)
            && self.session_key.len() == 43
            && self
                .session_key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            && self.expires_at_ms > 0
            && self.expires_at_ms < (1u64 << 53)
    }

    pub fn bytes(&self) -> Result<Vec<u8>, Problem> {
        if !self.well_formed() {
            return Err(Problem::Malformed);
        }
        Ok(format!(
            "beacon-peer-delegation-v1
session:{}
key:{}
expires:{}",
            self.session_id, self.session_key, self.expires_at_ms
        )
        .into_bytes())
    }
}

/// The host signs a delegation with its machine key.
pub fn sign_delegation(
    machine_key: &SigningKey,
    delegation: &Delegation,
) -> Result<String, Problem> {
    Ok(URL_SAFE_NO_PAD.encode(machine_key.sign(&delegation.bytes()?).to_bytes()))
}

/// The URL-safe base64 of a key's public half, as it appears in a delegation.
pub fn public_key_text(key: &SigningKey) -> String {
    URL_SAFE_NO_PAD.encode(key.verifying_key().to_bytes())
}

/// The DTLS fingerprint in an SDP, normalised; `None` if there is none or the media sections disagree.
pub fn sdp_fingerprint(sdp: &str) -> Option<String> {
    let mut found: Option<String> = None;
    for line in sdp.lines() {
        let Some(rest) = line.strip_prefix("a=fingerprint:") else {
            continue;
        };
        let value = rest.strip_prefix("sha-256 ")?.trim_end();
        if value.is_empty()
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b':')
        {
            return None;
        }
        let normalised = format!("sha-256 {}", value.to_ascii_uppercase());
        match &found {
            Some(existing) if *existing != normalised => return None,
            _ => found = Some(normalised),
        }
    }
    found
}

/// Checks a delegation against the machine key the viewer pinned.
pub fn verify_delegation(
    machine_public: &[u8; 32],
    delegation: &Delegation,
    signature: &str,
    now_ms: u64,
) -> Result<(), Problem> {
    let bytes = delegation.bytes()?;
    if delegation.expires_at_ms + CLOCK_SKEW_MS <= now_ms
        || delegation.expires_at_ms.saturating_sub(now_ms) > 13 * 60 * 60 * 1000 + CLOCK_SKEW_MS
    {
        return Err(Problem::Expired);
    }
    let raw = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| Problem::Malformed)?;
    let raw: [u8; 64] = raw.try_into().map_err(|_| Problem::Malformed)?;
    VerifyingKey::from_bytes(machine_public)
        .map_err(|_| Problem::WrongKey)?
        .verify(&bytes, &Signature::from_bytes(&raw))
        .map_err(|_| Problem::WrongKey)
}

/// The delegation the agent signs for a session key it just minted, with its signature.
pub fn delegate(
    machine_key: &SigningKey,
    session_key: &SigningKey,
    session_id: &str,
    expires_at_ms: u64,
) -> Result<(Delegation, String), Problem> {
    let delegation = Delegation {
        session_id: session_id.to_owned(),
        session_key: public_key_text(session_key),
        expires_at_ms,
    };
    let signature = sign_delegation(machine_key, &delegation)?;
    Ok((delegation, signature))
}

/// A session key's 32-byte secret as text for the private pipe to the helper, and back.
pub fn secret_text(key: &SigningKey) -> String {
    URL_SAFE_NO_PAD.encode(key.to_bytes())
}

pub fn secret_from_text(text: &str) -> Option<SigningKey> {
    let raw: [u8; 32] = URL_SAFE_NO_PAD.decode(text).ok()?.try_into().ok()?;
    Some(SigningKey::from_bytes(&raw))
}

/// What a host sends beside an offer (the `peer` field), all public values, in the wire shape the viewer reads.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireProof {
    pub delegation: WireDelegation,
    pub statement: WireStatement,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireDelegation {
    pub session_id: String,
    pub session_key: String,
    pub expires_at_ms: u64,
    pub signature: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireStatement {
    pub nonce: String,
    pub expires_at_ms: u64,
    pub signature: String,
}

/// How long a statement made for one offer stays good.
pub const STATEMENT_LIFETIME_MS: u64 = 30_000;

/// The helper's proof for one offer: the delegation the agent signed, and a statement over the fingerprint in this
/// SDP signed with the session key. `None` when the SDP has no single fingerprint or a field is out of shape.
pub fn host_proof(
    session_key: &SigningKey,
    delegation: &Delegation,
    delegation_signature: &str,
    generation: u64,
    sdp: &str,
    nonce: [u8; 16],
    now_ms: u64,
) -> Option<WireProof> {
    let statement = Statement {
        session_id: delegation.session_id.clone(),
        generation,
        role: Role::Host,
        fingerprint: sdp_fingerprint(sdp)?,
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        expires_at_ms: now_ms.checked_add(STATEMENT_LIFETIME_MS)?,
    };
    let signature = sign(session_key, &statement).ok()?;
    Some(WireProof {
        delegation: WireDelegation {
            session_id: delegation.session_id.clone(),
            session_key: delegation.session_key.clone(),
            expires_at_ms: delegation.expires_at_ms,
            signature: delegation_signature.to_owned(),
        },
        statement: WireStatement {
            nonce: statement.nonce,
            expires_at_ms: statement.expires_at_ms,
            signature,
        },
    })
}

const BASE32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// A short code a person can compare on two screens: 120 bits of the key's SHA-256 as six groups of four letters.
pub fn key_fingerprint(public_key: &[u8; 32]) -> String {
    let digest = Sha256::digest(public_key);
    let (mut bits, mut value, mut out) = (0u32, 0u32, String::new());
    for byte in &digest[..15] {
        value = (value << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            out.push(char::from(BASE32[((value >> (bits - 5)) & 31) as usize]));
            bits -= 5;
        }
    }
    out.as_bytes()
        .chunks(4)
        .map(|group| std::str::from_utf8(group).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(text: &str) -> Vec<u8> {
        (0..text.len())
            .step_by(2)
            .map(|at| u8::from_str_radix(&text[at..at + 2], 16).unwrap())
            .collect()
    }

    struct Vector {
        seed: [u8; 32],
        public: [u8; 32],
        key_fingerprint: String,
        statement: Statement,
        text: String,
        signature: String,
    }

    fn vector() -> Vector {
        let json: serde_json::Value = serde_json::from_str(include_str!(
            "../../../packages/protocol/test-vectors/peer-statement-v1.json"
        ))
        .unwrap();
        let text = |value: &serde_json::Value| value.as_str().unwrap().to_string();
        let statement = &json["statement"];
        Vector {
            seed: hex(json["seedHex"].as_str().unwrap()).try_into().unwrap(),
            public: hex(json["publicKeyHex"].as_str().unwrap())
                .try_into()
                .unwrap(),
            key_fingerprint: text(&json["keyFingerprint"]),
            statement: Statement {
                session_id: text(&statement["sessionId"]),
                generation: statement["generation"].as_u64().unwrap(),
                role: Role::Host,
                fingerprint: text(&statement["fingerprint"]),
                nonce: text(&statement["nonce"]),
                expires_at_ms: statement["expiresAtMs"].as_u64().unwrap(),
            },
            text: text(&json["statementText"]),
            signature: text(&json["signature"]),
        }
    }

    #[test]
    fn the_bytes_signature_and_key_code_match_the_vector_the_viewer_side_also_checks() {
        let v = vector();
        assert_eq!(
            String::from_utf8(v.statement.bytes().unwrap()).unwrap(),
            v.text
        );
        let key = SigningKey::from_bytes(&v.seed);
        assert_eq!(key.verifying_key().to_bytes(), v.public);
        assert_eq!(sign(&key, &v.statement).unwrap(), v.signature);
        let now = v.statement.expires_at_ms - 30_000;
        assert_eq!(verify(&v.public, &v.statement, &v.signature, now), Ok(()));
        assert_eq!(key_fingerprint(&v.public), v.key_fingerprint);
    }

    #[test]
    fn any_changed_field_a_swapped_key_or_a_damaged_signature_is_refused() {
        let v = vector();
        let now = v.statement.expires_at_ms - 30_000;
        let check = |statement: &Statement, key: &[u8; 32], signature: &str| {
            verify(key, statement, signature, now)
        };
        for changed in [
            Statement {
                generation: 4,
                ..v.statement.clone()
            },
            Statement {
                role: Role::Viewer,
                ..v.statement.clone()
            },
            Statement {
                nonce: "AAAAAAAAAAAAAAAAAAAAAA".into(),
                ..v.statement.clone()
            },
            Statement {
                session_id: "1f8fad5b-d9cb-469f-a165-70867728950e".into(),
                ..v.statement.clone()
            },
            Statement {
                fingerprint: v.statement.fingerprint.replace("01:08", "02:08"),
                ..v.statement.clone()
            },
        ] {
            assert_eq!(
                check(&changed, &v.public, &v.signature),
                Err(Problem::WrongSignature)
            );
        }
        let mut other = v.public;
        other[0] ^= 1;
        assert!(check(&v.statement, &other, &v.signature).is_err());
        let mut raw = URL_SAFE_NO_PAD.decode(&v.signature).unwrap();
        raw[10] ^= 1;
        assert_eq!(
            check(&v.statement, &v.public, &URL_SAFE_NO_PAD.encode(raw)),
            Err(Problem::WrongSignature)
        );
        assert_eq!(
            check(&v.statement, &v.public, "not a signature!"),
            Err(Problem::Malformed)
        );
        assert_eq!(
            check(&v.statement, &v.public, "AAAA"),
            Err(Problem::Malformed)
        );
    }

    #[test]
    fn an_expired_statement_or_one_that_claims_to_last_too_long_is_refused() {
        let v = vector();
        let at = |now: u64| verify(&v.public, &v.statement, &v.signature, now);
        let end = v.statement.expires_at_ms;
        // Two minutes of clock difference are forgiven either way.
        assert_eq!(at(end + 119_000), Ok(()));
        assert_eq!(at(end + 120_000), Err(Problem::Expired));
        assert_eq!(at(end + 3_600_000), Err(Problem::Expired));
        assert_eq!(at(end - 181_000), Err(Problem::Expired));
        assert_eq!(at(end - 179_000), Ok(()));
        assert_eq!(at(end - 59_000), Ok(()));
    }

    #[test]
    fn fields_that_could_change_where_one_line_ends_are_never_accepted() {
        let good = vector().statement;
        assert!(good.well_formed());
        for bad in [
            Statement {
                nonce: "AAAAAAAAAAAAAAAA\nrole:viewer".into(),
                ..good.clone()
            },
            Statement {
                fingerprint: format!("{}\nrole:viewer", good.fingerprint),
                ..good.clone()
            },
            Statement {
                session_id: format!("{}\n", good.session_id),
                ..good.clone()
            },
            Statement {
                generation: 2000,
                ..good.clone()
            },
            Statement {
                expires_at_ms: 0,
                ..good.clone()
            },
            Statement {
                nonce: "short".into(),
                ..good.clone()
            },
            Statement {
                fingerprint: "sha-1 00:11".into(),
                ..good.clone()
            },
        ] {
            assert!(!bad.well_formed());
            assert_eq!(bad.bytes(), Err(Problem::Malformed));
        }
    }

    #[test]
    fn the_delegation_chain_matches_the_vector_the_viewer_side_also_checks() {
        let json: serde_json::Value = serde_json::from_str(include_str!(
            "../../../packages/protocol/test-vectors/peer-chain-v1.json"
        ))
        .unwrap();
        let text = |value: &serde_json::Value| value.as_str().unwrap().to_string();
        let machine = SigningKey::from_bytes(
            &hex(json["machineSeedHex"].as_str().unwrap())
                .try_into()
                .unwrap(),
        );
        let session = SigningKey::from_bytes(
            &hex(json["sessionSeedHex"].as_str().unwrap())
                .try_into()
                .unwrap(),
        );
        assert_eq!(
            machine.verifying_key().to_bytes().to_vec(),
            hex(json["machinePublicHex"].as_str().unwrap())
        );
        let d = &json["delegation"];
        let delegation = Delegation {
            session_id: text(&d["sessionId"]),
            session_key: text(&d["sessionPublic"]),
            expires_at_ms: d["expiresAtMs"].as_u64().unwrap(),
        };
        // The host mints the session key and signs the delegation exactly as the viewer side expects.
        assert_eq!(public_key_text(&session), delegation.session_key);
        assert_eq!(
            String::from_utf8(delegation.bytes().unwrap()).unwrap(),
            format!(
                "beacon-peer-delegation-v1
session:{}
key:{}
expires:{}",
                delegation.session_id, delegation.session_key, delegation.expires_at_ms
            )
        );
        assert_eq!(
            sign_delegation(&machine, &delegation).unwrap(),
            text(&d["signature"])
        );
        // The helper builds the statement from the SDP it is about to send and signs it with the session key.
        let fingerprint = sdp_fingerprint(json["sdp"].as_str().unwrap()).unwrap();
        assert_eq!(fingerprint, text(&json["sdpFingerprint"]));
        let s = &json["statement"];
        let statement = Statement {
            session_id: delegation.session_id.clone(),
            generation: s["generation"].as_u64().unwrap(),
            role: Role::Host,
            fingerprint,
            nonce: text(&s["nonce"]),
            expires_at_ms: s["expiresAtMs"].as_u64().unwrap(),
        };
        assert_eq!(sign(&session, &statement).unwrap(), text(&s["signature"]));
        let session_public: [u8; 32] = session.verifying_key().to_bytes();
        assert_eq!(
            verify(
                &session_public,
                &statement,
                &text(&s["signature"]),
                json["nowMs"].as_u64().unwrap()
            ),
            Ok(())
        );
    }

    #[test]
    fn an_sdp_without_one_fingerprint_gives_none() {
        let one = "a=fingerprint:sha-256 AA:BB
";
        assert_eq!(sdp_fingerprint(one).as_deref(), Some("sha-256 AA:BB"));
        assert_eq!(
            sdp_fingerprint(
                "a=fingerprint:sha-256 aa:bb
m=video
a=fingerprint:sha-256 AA:BB
"
            )
            .as_deref(),
            Some("sha-256 AA:BB")
        );
        assert_eq!(
            sdp_fingerprint(
                "a=fingerprint:sha-256 AA:BB
a=fingerprint:sha-256 AA:CC
"
            ),
            None
        );
        assert_eq!(
            sdp_fingerprint(
                "a=fingerprint:sha-1 AA:BB
"
            ),
            None
        );
        assert_eq!(
            sdp_fingerprint(
                "v=0
"
            ),
            None
        );
    }

    #[test]
    fn a_host_proof_for_an_offer_verifies_down_the_whole_chain() {
        let json: serde_json::Value = serde_json::from_str(include_str!(
            "../../../packages/protocol/test-vectors/peer-chain-v1.json"
        ))
        .unwrap();
        let machine = SigningKey::from_bytes(
            &hex(json["machineSeedHex"].as_str().unwrap())
                .try_into()
                .unwrap(),
        );
        let session = SigningKey::from_bytes(
            &hex(json["sessionSeedHex"].as_str().unwrap())
                .try_into()
                .unwrap(),
        );
        let d = &json["delegation"];
        let delegation = Delegation {
            session_id: d["sessionId"].as_str().unwrap().to_string(),
            session_key: public_key_text(&session),
            expires_at_ms: d["expiresAtMs"].as_u64().unwrap(),
        };
        let signature = sign_delegation(&machine, &delegation).unwrap();
        let now = json["nowMs"].as_u64().unwrap();
        let sdp = json["sdp"].as_str().unwrap();
        let proof = host_proof(&session, &delegation, &signature, 3, sdp, [9u8; 16], now).unwrap();
        // The viewer's checks, in Rust: delegation against the machine key, then the statement against the session key.
        let machine_public = machine.verifying_key().to_bytes();
        assert_eq!(
            verify_delegation(
                &machine_public,
                &delegation,
                &proof.delegation.signature,
                now
            ),
            Ok(())
        );
        let statement = Statement {
            session_id: delegation.session_id.clone(),
            generation: 3,
            role: Role::Host,
            fingerprint: sdp_fingerprint(sdp).unwrap(),
            nonce: proof.statement.nonce.clone(),
            expires_at_ms: proof.statement.expires_at_ms,
        };
        assert_eq!(proof.statement.nonce.len(), 22);
        assert_eq!(
            verify(
                &session.verifying_key().to_bytes(),
                &statement,
                &proof.statement.signature,
                now
            ),
            Ok(())
        );
        // Another SDP, another generation, an expired time or another machine key does not pass.
        let other_sdp = sdp
            .replace("05:10:1B", "06:10:1B")
            .replace("05:10:1b", "06:10:1b");
        let swapped = Statement {
            fingerprint: sdp_fingerprint(&other_sdp).unwrap(),
            ..statement.clone()
        };
        assert!(verify(
            &session.verifying_key().to_bytes(),
            &swapped,
            &proof.statement.signature,
            now
        )
        .is_err());
        assert!(verify(
            &session.verifying_key().to_bytes(),
            &Statement {
                generation: 4,
                ..statement.clone()
            },
            &proof.statement.signature,
            now
        )
        .is_err());
        assert_eq!(
            verify(
                &session.verifying_key().to_bytes(),
                &statement,
                &proof.statement.signature,
                proof.statement.expires_at_ms + CLOCK_SKEW_MS
            ),
            Err(Problem::Expired)
        );
        let mut other_machine = machine_public;
        other_machine[0] ^= 1;
        assert!(verify_delegation(
            &other_machine,
            &delegation,
            &proof.delegation.signature,
            now
        )
        .is_err());
        // The wire shape the backend validates.
        let wire = serde_json::to_value(&proof).unwrap();
        assert_eq!(wire["delegation"]["sessionId"], delegation.session_id);
        assert_eq!(wire["statement"]["signature"].as_str().unwrap().len(), 86);
        // No fingerprint, no proof.
        assert!(host_proof(
            &session,
            &delegation,
            &signature,
            3,
            "v=0
",
            [9u8; 16],
            now
        )
        .is_none());
    }

    #[test]
    fn a_minted_session_key_round_trips_through_the_pipe_and_delegates_correctly() {
        let machine = SigningKey::from_bytes(&[7u8; 32]);
        let session = SigningKey::from_bytes(&[9u8; 32]);
        let id = "0f8fad5b-d9cb-469f-a165-70867728950e";
        let (delegation, signature) = delegate(&machine, &session, id, 2_000_000_000_000).unwrap();
        assert_eq!(delegation.session_key, public_key_text(&session));
        assert_eq!(
            verify_delegation(
                &machine.verifying_key().to_bytes(),
                &delegation,
                &signature,
                2_000_000_000_000 - 3_600_000
            ),
            Ok(())
        );
        let text = secret_text(&session);
        assert_eq!(text.len(), 43);
        assert_eq!(
            secret_from_text(&text).unwrap().to_bytes(),
            session.to_bytes()
        );
        assert!(secret_from_text("short").is_none());
        assert!(delegate(&machine, &session, "not a session", 1).is_err());
    }
}
