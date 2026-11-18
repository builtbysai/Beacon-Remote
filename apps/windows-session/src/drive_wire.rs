//! JSON wire layer for P1-4 drive commands. The viewer sends one bounded text message per command; this turns it
//! into a typed [`Command`] or refuses it, and encodes the typed [`Reply`] back. Anything malformed is refused
//! before any file is touched. The shapes match `packages/protocol/src/drive-mapping.ts`.

use crate::drive_exec::{Command, Entry, Reply, MAX_TRANSFER};
use crate::drive_map::{safe_segment, Refusal};
use serde_json::{json, Value};

/// Largest command message accepted. Writes carry their data in base64, so this allows a full 1 MiB transfer.
pub const MAX_MESSAGE: usize = 2 * MAX_TRANSFER + 4096;

fn segments(value: &Value) -> Option<Vec<String>> {
    let items = value.as_array()?;
    if items.len() > 32 {
        return None;
    }
    items
        .iter()
        .map(|item| {
            let name = item.as_str()?;
            safe_segment(name).then(|| name.to_string())
        })
        .collect()
}

fn number(value: &Value, key: &str) -> Option<u64> {
    value.get(key)?.as_u64().filter(|n| *n < (1u64 << 53))
}

/// Parses one command message. `None` means the message is not a valid command and must end the exchange.
pub fn parse(message: &[u8]) -> Option<Command> {
    if message.is_empty() || message.len() > MAX_MESSAGE {
        return None;
    }
    let value: Value = serde_json::from_slice(message).ok()?;
    let object = value.as_object()?;
    let op = object.get("op")?.as_str()?;
    let path = || segments(object.get("path")?);
    Some(match op {
        "list" => Command::List { path: path()? },
        "stat" => Command::Stat { path: path()? },
        "mkdir" => {
            let path = path()?;
            if path.is_empty() {
                return None;
            }
            Command::Mkdir { path }
        }
        "delete" => {
            let path = path()?;
            if path.is_empty() {
                return None;
            }
            Command::Delete { path }
        }
        "rename" => {
            let from = segments(object.get("from")?)?;
            let to = segments(object.get("to")?)?;
            if from.is_empty() || to.is_empty() {
                return None;
            }
            Command::Rename { from, to }
        }
        "read" => {
            let length = number(&value, "length")?;
            if length == 0 || length > MAX_TRANSFER as u64 {
                return None;
            }
            Command::Read {
                path: path()?,
                offset: number(&value, "offset")?,
                length: length as usize,
            }
        }
        "write" => {
            let encoded = object.get("data")?.as_str()?;
            let data = decode_base64(encoded)?;
            if data.is_empty() || data.len() > MAX_TRANSFER {
                return None;
            }
            Command::Write {
                path: path()?,
                offset: number(&value, "offset")?,
                data,
            }
        }
        _ => return None,
    })
}

/// Encodes a reply, or the refusal that stopped the command, as one JSON message.
pub fn encode(result: &Result<Reply, Refusal>) -> Value {
    match result {
        Ok(Reply::Entries(entries)) => json!({
            "type": "entries",
            "entries": entries.iter().map(entry_json).collect::<Vec<_>>(),
        }),
        Ok(Reply::Stat(entry)) => json!({"type": "stat", "entry": entry_json(entry)}),
        Ok(Reply::Data(bytes)) => json!({"type": "data", "data": encode_base64(bytes)}),
        Ok(Reply::Done) => json!({"type": "done"}),
        Err(refusal) => json!({"type": "refused", "reason": refusal_name(*refusal)}),
    }
}

fn entry_json(entry: &Entry) -> Value {
    json!({"name": entry.name, "isDir": entry.is_dir, "size": entry.size})
}

fn refusal_name(refusal: Refusal) -> &'static str {
    match refusal {
        Refusal::UnsafePath => "unsafe-path",
        Refusal::TooDeep => "too-deep",
        Refusal::ReparsePoint => "reparse-point",
        Refusal::ReadOnly => "read-only",
        Refusal::Expired => "expired",
        Refusal::RootMissing => "root-missing",
        Refusal::TooLarge => "too-large",
    }
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn encode_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let bytes = text.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for quad in bytes.chunks(4) {
        let mut n: u32 = 0;
        let mut pad = 0;
        for (i, &c) in quad.iter().enumerate() {
            let value = if c == b'=' {
                // Padding is only valid at the end of the final group.
                if i < 2 {
                    return None;
                }
                pad += 1;
                0
            } else {
                if pad > 0 {
                    return None;
                }
                ALPHABET.iter().position(|&a| a == c)? as u32
            };
            n = (n << 6) | value;
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips_every_length() {
        for len in 0..10usize {
            let bytes: Vec<u8> = (0..len as u8).map(|b| b.wrapping_mul(37)).collect();
            assert_eq!(decode_base64(&encode_base64(&bytes)), Some(bytes));
        }
        assert_eq!(decode_base64("SGk="), Some(b"Hi".to_vec()));
        assert_eq!(decode_base64("SGk"), None);
        assert_eq!(decode_base64("S=k="), None);
    }

    #[test]
    fn valid_commands_parse_to_typed_commands() {
        let read = br#"{"op":"read","path":["docs","a.txt"],"offset":4,"length":16}"#;
        assert_eq!(
            parse(read),
            Some(Command::Read {
                path: vec!["docs".into(), "a.txt".into()],
                offset: 4,
                length: 16
            })
        );
        let write = br#"{"op":"write","path":["a"],"offset":0,"data":"SGk="}"#;
        assert_eq!(
            parse(write),
            Some(Command::Write {
                path: vec!["a".into()],
                offset: 0,
                data: b"Hi".to_vec()
            })
        );
        assert_eq!(
            parse(br#"{"op":"list","path":[]}"#),
            Some(Command::List { path: vec![] })
        );
    }

    #[test]
    fn malformed_unsafe_and_oversized_messages_are_refused() {
        for bad in [
            &b""[..],
            b"not json",
            br#"{"op":"format","path":[]}"#,
            br#"{"op":"list","path":["..","x"]}"#,
            br#"{"op":"list","path":["C:"]}"#,
            br#"{"op":"delete","path":[]}"#,
            br#"{"op":"mkdir","path":[]}"#,
            br#"{"op":"rename","from":[],"to":["x"]}"#,
            br#"{"op":"read","path":["a"],"offset":0,"length":0}"#,
            br#"{"op":"read","path":["a"],"offset":0,"length":2000000}"#,
            br#"{"op":"read","path":["a"],"offset":-1,"length":4}"#,
            br#"{"op":"write","path":["a"],"offset":0,"data":"!!!!"}"#,
            br#"{"op":"write","path":["a"],"offset":0,"data":""}"#,
        ] {
            assert_eq!(parse(bad), None, "{}", String::from_utf8_lossy(bad));
        }
        let oversized = vec![b' '; MAX_MESSAGE + 1];
        assert_eq!(parse(&oversized), None);
    }

    #[test]
    fn replies_and_refusals_encode_for_the_viewer() {
        assert_eq!(encode(&Ok(Reply::Done)), json!({"type": "done"}));
        assert_eq!(
            encode(&Ok(Reply::Data(b"Hi".to_vec()))),
            json!({"type": "data", "data": "SGk="})
        );
        assert_eq!(
            encode(&Err(Refusal::ReadOnly)),
            json!({"type": "refused", "reason": "read-only"})
        );
        assert_eq!(
            encode(&Ok(Reply::Stat(Entry {
                name: "a".into(),
                is_dir: false,
                size: 3
            }))),
            json!({"type": "stat", "entry": {"name": "a", "isDir": false, "size": 3}})
        );
    }
}
