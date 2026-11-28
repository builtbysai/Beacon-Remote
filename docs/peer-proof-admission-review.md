# Peer-proof admission: review and proposal (R06)

Status: **proposal for a security review**, November 28 2026. Nothing here changes behaviour yet.

## What the code does today

`judgeOffer` in `apps/web/src/peer-trust.ts` returns one of five verdicts for a host's offer, and `LiveView.tsx`
answers the offer for every verdict unless the browser-local strict mode is on:

| Verdict    | Meaning                                                                     | Legitimate causes                               | Today            |
| ---------- | --------------------------------------------------------------------------- | ----------------------------------------------- | ---------------- |
| `verified` | The offer carries a valid proof from the pinned (or first-seen) host key    | Normal                                          | Connects         |
| `unsigned` | No proof at all                                                             | Host older than the peer-proof release          | Connects, notice |
| `no-key`   | The server lists no identity key for this computer                          | Computer enrolled before identity keys          | Connects, notice |
| `changed`  | Valid proof, but from a key other than the one this browser pinned          | Reinstall or re-enrollment of the same computer | Connects, notice |
| `failed`   | A proof is present and does not verify (signature, session, window, expiry) | A bug, or clock skew beyond the proof window    | Connects, notice |

"Trust the new key" replaces a pin after a `changed` verdict, but the connection does not wait for that choice.

## Why this matters

`unsigned` and `no-key` are compatibility states and must keep working until every host is updated. `failed` and
`changed` are different: a supplied proof that does not verify, or a known computer suddenly presenting another key,
is exactly what an interception between the signalling server and the viewer would look like. Treating them as an
ordinary notice gives the person a warning after video and input may already flow.

## Proposal

1. **`failed`: block admission** (do not answer the offer) and say "This computer's identity proof did not check out",
   with Try again. Before turning this on, measure how often `failed` happens for clock reasons: the proof window
   should tolerate normal skew (if it does not, widen it on the verifier, do not admit failures).
2. **`changed`: hold admission until the person chooses**: show both short codes, "Trust the new key" (replaces the pin
   and continues) or "Cancel". No video or input before the choice. A re-enrolled computer then costs one deliberate
   click, once.
3. **`unsigned` / `no-key`**: keep connecting with the notice until a published date after which every supported host
   signs; then treat as `failed`.
4. Keep strict mode as the per-browser way to block `unsigned`/`no-key` early.

Tests to add before shipping: unsigned legacy host admitted; valid known host admitted; forged, expired and
wrong-session proofs refused before `setRemoteDescription`; changed key held until the choice and refused on Cancel;
legitimate re-enrollment accepted after the choice. Verify that no frame is rendered and no input channel opens before
admission, not only that the pin was replaced.

References: ADR 0061/0062, `apps/web/src/peer-trust.ts`, `apps/web/test/peer-trust.test.ts`, the offer handler in
`apps/web/src/LiveView.tsx`.
