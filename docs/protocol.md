# Protocol v1

`packages/protocol` defines strict enrollment, signed heartbeat, input envelopes,
and the initial view/control capabilities. Unknown fields are rejected.

Heartbeat canonical bytes are UTF-8:

```text
beacon-remote:heartbeat:v1
<machine UUID>
<Unix timestamp in milliseconds>
<random UUID nonce>
```

There is no trailing newline. Ed25519 signatures and 32-byte public keys use
standard base64. Heartbeats more than 30 seconds from server time are rejected.
Nonce reuse is rejected and stored beyond the signature acceptance window.
Inventory derives online from a nonrevoked machine's last heartbeat within
45 seconds; reconnect creates fresh signed requests.

Input envelopes are preparation only: no input endpoint or DataChannel currently
accepts them. Future adapters validate session/lease/sequence/capability before
converting typed network messages to core operations. Separate reliable control
and unreliable pointer channels; do not overload signaling with raw input.

## View signaling under development

An owner requests `POST /api/machines/:id/sessions` with source `synthetic` or
`desktop`. Only an online, nonrevoked computer belonging to that account is
eligible. The database permits one pending or active session per computer, with
a maximum lifetime of 120 seconds. The native helper currently implements only
the synthetic source without capture, or the desktop source after local consent
with a Windows capture border and visible Stop sharing control.

The signed heartbeat response delivers the machine's pending session grant.
Its opaque bearer is an HMAC bound to session, machine, source and expiry,
derived from the independent session secret. The database stores its hash and
atomically consumes it when the machine joins. No bearer appears in a URL.
`/api/sessions/:id/signal?role=machine` uses an Authorization header; the viewer
role requires its owner cookie and an exact Origin. Each role permits one socket.

Native consent precedes an offer; the browser returns an answer. Only bounded
SDP, ICE and consent/stop messages pass through the server, never media or input.
The helper sends a numbered renewal challenge once per second. The server echoes
it with a three-second lease only while the viewer session remains valid. The
helper measures lease age from its own monotonic challenge-send time, so delayed
or replayed replies cannot extend the lease. Logout, expiry, computer revocation, disconnect and explicit stop
end the grant. The native helper stops on connection loss or lease lapse and
does not resume automatically. Synthetic browser/native decoding, browser Stop,
logout, absolute expiry and the local Windows Stop button passed acceptance.
Desktop and forced-relay acceptance remain pending.
