# 0038: One-click temporary support

Status: accepted, 2026-10-14

## Context

Attended support (ADR 0023) starts from the person who needs help: they must already have Beacon Remote installed, ask it
for a code and read the code out. The common case is the reverse: a technician wants to send someone a link, the person
runs one thing, approves, and when support ends nothing is left on their computer.

## Decision

- **A technician makes a support link** (Assist, "New support session", optionally with a label and a request to control).
  The link is `/#support=<token>`: 192 random bits in the address fragment, kept out of server logs. The server stores
  only its hash. It can be redeemed once and lives 24 hours. A technician can have 20 open at a time.
- **The page names who is asking before anything is downloaded**, using the account email, and what they asked for. An
  unknown, used, cancelled or expired link looks the same to anyone.
- **The page offers the Windows support program** (the signed installer, downloaded as `BeaconSupport-<token>.exe`), with
  a visible platform picker. Other systems are told plainly that one-click support is not available yet; nothing
  incompatible is served. Browser detection is a convenience, not a boundary.
- **The program is the setup executable in support mode,** chosen by its file name (or `--support <token>`). It installs
  nothing: no Start menu entry, no Apps and features entry, no start at sign-in, no certificate trust, no administrator
  approval. It writes the programs into `%LOCALAPPDATA%\BeaconSupport\<id>` and runs the host in support mode with
  `LOCALAPPDATA` pointing inside that folder, so a permanently installed Beacon Remote is never read or replaced.
- **Approval comes before any network claim.** The host asks "<technician> would like to help you… Start temporary
  support?" and only then redeems the link. After that, each viewing or control request still needs the normal local
  Allow, and the same sharing indicator and Stop apply.
- **Redeeming the link creates a temporary computer in the technician's account** with the client's own new key: it holds no
  durable credential and no standing access. It cannot be made trusted, cannot have remembered helpers, is not part of
  team shares, and does not count against the 50 computers. It shows in Assist, not in Computers. A view link can never
  be turned into control.
- **It ends, and the computer is revoked, only on purpose:** the person presses End support or closes the window; the
  technician ends it; the 8 hour limit passes (checked by the server on every heartbeat and by a sweep, and locally from
  the deadline, even with no network); or the link never worked. Live sessions end with it.
- **It survives crashes and restarts.** A supervisor (`beacon-remote-host --support-supervise`) runs the support window and,
  if the window dies any other way, starts it again with the same temporary identity (a crash loop of more than five in ten
  minutes ends it). After a restart or sign-out a `RunOnce` entry, renewed on every start and removing itself when it runs,
  starts the supervisor again. The window is visible and says it is resuming; nothing is shared until the person allows
  a new connection, and the 8 hour limit still counts from the original claim.
- **Cleanup.** The credentials always go. Unless the person unticks "Remove Beacon Remote when support ends" (on by
  default), so do the programs and the downloaded file. Removal is done by a short detached `cmd` after the programs exit,
  and the supervisor also tells the server support is over. Only a folder shaped exactly like
  `<local app data>\BeaconSupport\<16 hex>` is ever removed, and a download only if it still carries the `BeaconSupport-...` name.
- **The technician's machine never deletes files on the other computer.** Cleanup is the local program's own job.

## Not done

Linux and Android temporary clients; elevation for support that needs the secure desktop; a way to carry the link when a
browser renames the download beyond the " (1)" suffix; Browser downloads, Windows event logs and other
records Beacon does not own are not erased.
