# Website and app UI issues noticed during lab testing

Collected while testing sign-in access on the lab laptop (November 2026). Not yet scheduled; each line says where it
was seen and what would be better. Add to it as testing continues.

## Website (computers page)

1. **"Windows sign-in · Unavailable" on a signed-in computer.** Reads like something is broken. When someone is
   signed in it should say "Signed in" (or hide the row), and keep "Unavailable" for a real fault.
2. **No answer when waking the sign-in screen fails.** "Bringing up the password prompt…" stays with no progress and
   no reason when the prompt does not come up. Show elapsed time, then a plain failure with a Try again button.
3. **"Starting host" for a computer that is only reconnecting.** After a network drop the list showed
   "0 of 1 online" and "Starting host" until the next heartbeat; "Reconnecting…" would be accurate.
4. **Filter counts do not add up.** "All 1 · Online 1 · Offline 0 · Revoked 2": All excludes revoked computers while
   Revoked counts them. Either include them in All or label it "Active".
5. **Cramped details panel at narrow widths.** In a narrow window "Open sign-in" wraps onto three lines and the
   sign-in status wraps beside it; stack the button under the status below a width.
6. **Signed-in visitors land on the marketing page.** The site root shows the product page even with a signed-in
   session; go straight to Computers (keep the product page one click away).

10. **Sign-in viewer drops a working stream after about 10 seconds (open bug, Nov 27).** ICE connects in about 1 s
    and the worker sends frames, but the video is cleared (`play()` interrupted by `pause()`, readyState 0). The
    10-second first-frame timer then fails the connection; the viewer reconnects and the same thing happens, showing
    a black screen with "Show screen". Suspects: the lease renewal at about 4–5 s re-authorizes the worker and the
    connection resets the stream, or `stream(null)` from `SignInConnection` during that. Next: log where
    `stream(null)` comes from and whether renewal renegotiates.
    Narrowed later the same day: the clearing is `end()` from the 10-second first-frame timer, and `play()` never
    resolves before it. ICE and the peer connection are up by 2.5 s and the worker sends about 20 samples a second,
    so the browser is receiving but not decoding. Next: read `inbound-rtp` stats while live (framesReceived vs
    framesDecoded, keyFramesDecoded, pliCount) and check that the worker's H.264 stream starts with a keyframe and
    answers PLI.

## Windows app (host window)

7. **Header stays on "Set up this computer" after pairing** until the window is reopened.
8. **"Paired to 127.0.0.1"** shows a raw address; show the server's name, with the address in a tooltip.
9. **Updating the sign-in service needs a separate Repair approval** after every app update. Fold it into the
   installer's own elevation (one approval per update), or have the app offer it right after the update.
