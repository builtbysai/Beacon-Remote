# What only you can do

Everything not on this page, I do. Each part says what you do, what I do after, and what it costs. Prices are what
vendors listed on 2026-10-13, so confirm on the vendor page before paying.

Secrets: never paste a key into chat. Where a key is needed, save it to the file named in the step; I read it from
there, use it once, and it is never committed.

## Done

- **Email** (2026-10-14): sign-up by email, email confirmation and password recovery by email are on, through the
  Resend account and `auth.builtbysai.com` domain Beacon View already uses (free: 3,000 mails a month, 100 a day,
  shared). Sign-up is open to anyone. To close it, remove `PUBLIC_SIGNUP` from
  `/etc/beacon-remote/production-media.env` and recreate the backend, or tell me.
- **Code signing** (2026-10-14): free, self-signed, built in (ADR 0035). See step 1.

## 1. Trust the certificate on your devices (free, 5 minutes per computer)

Beacon Remote's programs and installer are now signed with its own certificate. Windows trusts it only on computers
you tell it to, so this removes the "unknown publisher" warning on your devices, not for the public.

On this PC, and on any computer you set up with the installer:

1. Run `BeaconRemoteSetup-<commit>.exe` (from the Downloads page or `dist\`).
2. When it asks "Let Windows trust Beacon Remote?", compare the fingerprint with the Downloads page and choose Yes.
3. Approve the Windows administrator prompt. It asks once; later runs skip it.

On computers where Beacon Remote is already installed, or that you only want to trust it:

1. Download `Trust-BeaconRemote.ps1` from the Downloads page.
2. In PowerShell run `.\Trust-BeaconRemote.ps1 -Fingerprint <the fingerprint on the Downloads page>` and approve the
   administrator prompt. Running it again says "Already trusted".
3. To undo it: `.\Trust-BeaconRemote.ps1 -Remove`. For many computers use Group Policy (the script header explains it).

Every three years (the tool warns 90 days ahead) I renew the certificate; you re-approve once per computer. If the key
is ever lost or stolen, tell me: I revoke it, and computers drop it the next time they run a newer installer or the
script. I keep the key in `C:\Users\Saiha\.beacon\secrets\remote-codesign`; please keep that folder backed up, because
losing it means issuing a new certificate and re-approving everywhere.

You can delete `signpath-token.txt` from the secrets folder: it is not used.

Optional later: a paid public certificate (Azure Artifact Signing, about $10 a month, individuals in the US or Canada
only) would also remove the warning for people who have not opted in. Not needed for your own devices.

## 2. Test on real hardware (free, 1 to 2 hours)

Nothing replaces this, and it is what moves features from "works on my fixture" to "validated".

Windows computers: install the latest build on each Windows PC you have (Downloads page), then follow sections 1 to 6
and 8 of `docs/acceptance-checklist.md`. Include one session over mobile data and one after the PC sleeps.

Android phone, one time:

1. Settings, About phone, tap Build number seven times. Then Settings, System, Developer options, turn on USB debugging.
2. Plug the phone into this PC and tap Allow on the phone's prompt.
3. Tell me. I build and install the app, pair it, and walk you through the on-phone taps, then you follow section 7.

Send back, for anything that felt off: the time, what you did, and the session's row from Sessions (the Connection
column). I fix what you find.

## 3. Later, only if you want it

- **Install the Android app without a cable:** free. I create a release key and offer the app on the Downloads page.
  Google Play instead has a one-time fee of about $25 and a testing requirement for new accounts; check Play Console
  for the current rule. Tell me which you prefer once the real-phone test passes.
- **A macOS host:** needs a Mac to build and test on, and Apple's developer programme ($99 a year) to sign it. Linux
  hosts need neither and are free; say when you want them.

## What I am doing meanwhile

Relay and server health alerts (email is ready), roles and technician accounts, the remaining design rollout,
file-transfer resume, and the Windows tray notification for incoming requests. See `docs/roadmap.md`.
