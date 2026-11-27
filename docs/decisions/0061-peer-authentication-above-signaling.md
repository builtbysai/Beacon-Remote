# Peer authentication above signaling

Status: proposed for review, 26 November 2026. No code follows until this record is accepted. It is the first piece of
roadmap item P3-1 ("trust above transport") and gives the end-to-end threat model that item asks for.

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
2. Protocol: the signed statement, the browser pin store and the key-change flow; unit tests for tamper, replay,
   wrong key, expired statement and changed key.
3. Windows and Android hosts: sign on connect; show the key fingerprint at pairing and in the host window.
4. Viewer: verify, pin and warn; the strict-mode account setting.
5. Device checks: a hostile-relay run on real hosts, then an honest upgrade, key change and re-enrollment.
