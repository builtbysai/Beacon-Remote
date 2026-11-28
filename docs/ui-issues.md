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
- **Open:** "Starting host" for a computer that is only reconnecting after a network drop; "Reconnecting…" would be
  accurate.
- **Open:** filter counts ("All 1 · Online 1 · Offline 0 · Revoked 2"): All excludes revoked computers while Revoked
  counts them. Either include them in All or label it "Active".
- **Open:** in a narrow window "Open sign-in" wraps onto three lines beside its status.
- **Open:** a signed-in visitor lands on the product page; go straight to Computers.

## Windows app (host window)

- **Fixed:** the heading stayed on "Set up this computer" after pairing (R12).
- **Open:** "Paired to 127.0.0.1" shows a raw address; show the server's name, with the address in a tooltip.
- **Partly fixed:** an update needs a separate Repair approval for the sign-in service. The host now brings that one
  approval forward right after the update (R13); folding it into the update itself is still open.
- **Fixed:** the web's "Open link" did nothing on Windows; the installer now registers `beaconremote:` links.

## Sign-in to desktop

- **In progress:** after signing in through the viewer, the handoff to the desktop is refused because the sign-in
  worker cannot confirm that its input was released. Fixed so far: Enter is a complete tap, modifiers are pressed only
  around a key, the handoff waits for the console to be signed in, heartbeats wait for a pending handoff. The latest
  build logs content-free counts (`input cleanup not confirmed: ended …, keys …, buttons …, text …`) to show what is
  still held; verify on the lab laptop.
