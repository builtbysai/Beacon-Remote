//! Peer authentication above signaling (ADR 0061, foundation). The Rust twin of
//! `packages/protocol/src/peer-identity.ts`: both build the same bytes and are tested against the same vector
//! (`packages/protocol/test-vectors/peer-statement-v1.json`). A host signs a short statement with its machine key;
//! the viewer checks it against the key it pinned. Nothing here enforces anything until the hosts sign and the viewer
//! verifies (ADR 0061, later steps).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

/// A statement is good for one minute at most, so a captured one is of no later use.
pub const MAX_STATEMENT_MS: u64 = 60_000;

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
    if statement.expires_at_ms <= now_ms || statement.expires_at_ms - now_ms > MAX_STATEMENT_MS {
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
        assert_eq!(at(end), Err(Problem::Expired));
        assert_eq!(at(end + 1), Err(Problem::Expired));
        assert_eq!(at(end - 61_000), Err(Problem::Expired));
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
}
