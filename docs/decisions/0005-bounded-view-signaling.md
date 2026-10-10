# Bounded view grants and direct native media

Use the existing control plane for authenticated WebSocket signaling and the
native Windows session helper for H.264/WebRTC. Media stays off the API and
PostgreSQL. Introduce a separate random session secret and one-use machine grants
bound to computer, source and a two-minute expiry. An owner cookie and exact
Origin authorize the browser; device grants arrive through signed presence.

Database uniqueness prevents competing live sessions. Explicit native consent
gates SDP forwarding. A short renewable lease binds ongoing media to an active
browser login and nonrevoked machine; the helper must stop when renewal fails.
Renewals echo native challenges and expire relative to the native challenge-send
time, preventing delayed signaling from extending access.
These grants confer viewing only. They do not authorize input, clipboard,
recording, microphone, files, elevation or unattended capture.

First verify synthetic H.264 decoding end-to-end before connecting actual WGC
capture. Desktop capture additionally requires local consent, a visible Stop
sharing control and the Windows capture border. STUN uses the existing Coturn
service; forced-relay acceptance and TURN credential isolation are still pending.
