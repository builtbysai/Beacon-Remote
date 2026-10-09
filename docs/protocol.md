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
