# Website and app UI issues noticed during lab testing

Collected while testing sign-in access on the lab laptop (November 27–28, 2026). The broader experience review is
tracked in [roadmap.md](roadmap.md) ("Experience review findings"); this list keeps the lab observations and their
status.

## Website (computers page)

- **Fixed:** "Windows sign-in · Unavailable" on a signed-in computer. The row is hidden while someone is signed in,
  and a real fault reads "Not reachable right now" (R03).
- **Fixed:** no answer when bringing up the password prompt fails. The wake now sends Ctrl+Alt+Del, and a failure
  says to try Connect again.
- **Fixed:** black sign-in video with a connected transport. Causes: media on a throttled tunnel in the lab, and the
  shared request limit exhausted by the sign-in service's polling (R01).
- **Fixed:** black stage between streams. The viewer keeps the last picture of each computer as the poster.
- **Fixed:** "Starting host" for a computer that is only reconnecting after a network drop; a host seen in the last
  three minutes reads "Reconnecting…".
- **Fixed:** filter counts: the first filter is labelled "Active" (R19).
- **Fixed:** the row's button ("Connect") no longer wraps in a narrow window.
- **Fixed:** a signed-in visitor goes straight to Computers.

## Windows app (host window)

- **Fixed:** the heading stayed on "Set up this computer" after pairing (R12).
- **Fixed:** "Paired to 127.0.0.1" showed a raw address; it now names the server, or says "a server on this computer
  (127.0.0.1)" / "on your local network" for a bare address.
- **Partly fixed:** an update needs a separate Repair approval for the sign-in service. The host now brings that one
  approval forward right after the update (R13); folding it into the update itself is still open.
- **Fixed:** the web's "Open link" did nothing on Windows; the installer now registers `beaconremote:` links.

## Sign-in to desktop

- **Fixed (verified on the lab laptop, November 28):** the handoff to the desktop was refused because the sign-in worker
  reported video as finished only after its hardware encoder shut down (over a second). Video now counts as stopped
  once capture is released; the log showed `input released true, video stopped true` and the desktop opened with
  mouse and keyboard. If a handoff still fails after sign-in, the viewer opens the ordinary desktop session.
