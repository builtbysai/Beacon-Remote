# Peer authentication above signaling

Status: accepted 26 November 2026 (the owner approved the proposals); steps 1 and 2 are built, steps 3 to 5 are not. It is
the first piece of roadmap item P3-1 ("trust above transport") and gives the end-to-end threat model that item asks for.

## The problem

A session's video, input and files travel over a WebRTC peer connection between the browser and the Windows or
Android host. The two sides agree on that connection through the Beacon backend, which relays their offer, answer and
ICE candidates (signaling). Today the backend is trusted to relay them honestly:

- The DTLS certificate fingerprint of each side is inside the SDP. If the backend, or anyone who controls it, swapped
  the SDP on both sides it could sit in the middle of the media and the input channel and read or change them.
- The backend already decides who may start a session, and it is the owner's own server. But "the server is honest" is
  the only thing standing between a server compromise and a view of the owner's screen, and the product claims
  visible, owner-controlled access. That claim is stronger if the endpoints can check each other without the server.

What the backend can and cannot do today (to be confirmed by tests before this record is accepted):

| Capability                                        | Today                                                   |
| ------------------------------------------------- | ------------------------------------------------------- |
| Start a session for a revoked computer            | No: leases are checked against the database each second |
| Grant itself more access than local policy allows | No: the host checks its own local setting               |
| Replace an SDP and read the media                 | **Yes** (nothing signs the SDP)                         |
| Read stored media                                 | No: nothing is stored                                   |

## Decision

1. **Sign the connection, with a key the server does not hold.** The host already has an Ed25519 machine key enrolled
   at pairing (kept under DPAPI on Windows, in the Android keystore on Android). For each session the host signs a
   short statement: session id, generation, its DTLS fingerprint, the viewer's nonce and an expiry. The viewer checks
   the signature before it trusts the connection, and the host checks the viewer's own signed fingerprint the same way.
2. **Pin the host key in the viewer, not on the server.** At pairing the host shows a short fingerprint of its machine
   key (grouped words or digits) in the host window; the web app shows the same value on the computer's page. The
   browser stores the key it first saw for that computer (trust on first use) and refuses a connection whose signature
   uses a different key, showing "This computer's identity changed" with the old and new fingerprints. A person who
   wants more than first use compares the two fingerprints on the computer itself.
3. **Key changes are explicit.** Re-enrolling a computer (after a reinstall, a restore or a replaced device) produces
   a new key. The web app says so and the person confirms against the host window before the pin changes. A changed
   key is never accepted silently, and never because the server says so.
4. **Viewers are authenticated to the host the same way.** The browser keeps a per-account signing key (WebCrypto,
   non-extractable). The host learns its public key at the same time as the approval and checks it on each session. This
   is what makes "the person at the keyboard said yes to this viewer" mean the same viewer on the other side of the wire.
5. **The server stays the policy point.** It still issues leases, relay credentials and revocation, and it still
   refuses sessions it should refuse. This record adds a check the server cannot forge; it does not remove any check.
6. **Fail closed, say why.** A missing or bad signature ends the connection before media or input flows and reports
   "Could not verify this computer" with a next step. Older hosts and viewers keep working during the rollout only when
   the account has not turned on strict mode; strict mode becomes the default once the hosts update.

## What this does not cover

- A compromised computer or browser. The key lives where the software runs; this protects the path between them.
- Metadata. The server still knows who connects to which computer and when.
- Recovery. Losing the key is a re-enrollment, which is why step 3 exists.

## What to build, in order

1. Threat-model tests: run the backend as a hostile relay in a fixture and confirm today's behavior in the table.
   (Not done: the table above is by design review, not by test.)
2. Protocol: the signed statement, the browser pin store and the key-change flow; unit tests for tamper, replay,
   wrong key, expired statement and changed key. **Built**: `packages/protocol/src/peer-identity.ts` and
   `crates/remote-core/src/peer_identity.rs` build the same bytes and check the same signature and key code from
   `packages/protocol/test-vectors/peer-statement-v1.json`. A statement is
   `beacon-peer-v1` plus session, generation, role, DTLS fingerprint, the other side's nonce and an expiry (at most one
   minute), signed with Ed25519; the key code is 120 bits of the key's SHA-256 as six groups of four base32 letters.
   Nothing enforces it yet.
3. Windows and Android hosts: sign on connect; show the key fingerprint at pairing and in the host window.
4. Viewer: verify, pin and warn; the strict-mode account setting.
5. Device checks: a hostile-relay run on real hosts, then an honest upgrade, key change and re-enrollment.

## Integration design (steps 3 and 4)

Worked out November 26 from how the code is arranged today; not built.

- **The machine key stays in the host process.** The Windows agent holds it; the capture helper
  (`beacon-remote-session.exe`) never does, and gets its grant from the agent on stdin. So the agent mints a key for each
  session, signs a delegation with the machine key (`beacon-peer-delegation-v1`, session id, the session key's public
  half, an expiry of the session's lifetime) and hands the helper the session key and the delegation in the grant. The
  helper signs each offer's statement with the session key. The viewer checks the chain: pinned machine key, then
  delegation, then statement. The server sees only public values.
- **On the wire.** Offers and answers gain an optional `peer` object (delegation, statement signature, nonce, expiry).
  The backend's strict signaling schema must accept it before any host sends it, so it ships first. The statement's
  fingerprint is the one in the SDP `a=fingerprint` line; the viewer compares them itself rather than trusting a field.
- **Where the viewer gets the key.** The machines list gains the computer's public key from enrollment. The first one the
  browser sees is pinned (trust on first use) and shown as the key code beside the computer; the person can compare it with
  the code in the host window's Support tab (to be added) for more than first use.
- **Android.** The same chain with the Android keystore key and a delegation signed there; until it does, the viewer treats
  Android hosts as unsigned.
- **Rollout.** Advisory first: the viewer shows "Computer identity verified" or a clear warning and still connects. Strict
  mode, off by default, refuses an unsigned or mismatched offer. Strict becomes the default only once Windows and Android
  hosts sign and the key-change and re-enrollment flow has been exercised on devices.
