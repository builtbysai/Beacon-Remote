# What only you can do

Everything not on this page, I do. Each part below says what you do, what I do after, and what it costs.
Do them in any order; none blocks the others. Prices are what vendors listed on 2026-10-13, so confirm on the
vendor page before paying.

Secrets: never paste a key into chat. Where a key is needed, save it to the file named in the step; I read it
from there, use it once, and it is never committed.

## 1. Turn on email (free, about 10 minutes)

This enables sign-up by email, password recovery by email, and later server alerts. It reuses the Resend account
and the verified `auth.builtbysai.com` domain that Beacon View already uses, so there is no new domain, no DNS work
and no new bill. The free plan allows 3,000 mails a month and 100 a day, shared with Beacon View.

You:

1. Sign in at resend.com with the account that owns `auth.builtbysai.com`.
2. API Keys, Create API Key. Name it `beacon-remote`, permission Sending access, domain `auth.builtbysai.com`.
3. Copy the key and save it as the only line of `C:\Users\Saiha\.beacon\secrets\remote-resend-key.txt`.
4. Tell me it is saved, and say whether sign-up should be open to anyone or stay by invitation.

I then: put the key and `MAIL_FROM="Beacon Remote <remote@auth.builtbysai.com>"` on the server, restart, send a
test mail to you, check sign-up and recovery, and turn on server health alerts by mail.

## 2. Remove the "unknown publisher" warning on Windows (free, 15 minutes plus waiting)

Updates are already protected by their own signature; this only removes the warning on first run.

The free route is SignPath Foundation. It needs the source under an open-source licence, because its free
certificates are for open-source projects (check signpath.org/apply for the current rules before applying).

You:

1. Decide: are you willing to publish Beacon Remote's source under a licence? If yes, pick **MIT** (simplest) or
   **Apache-2.0** (adds a patent grant). Tell me which. If no, skip to "If not" below.
2. After I add the licence file and a signing-ready build workflow (I will tell you when), apply at
   signpath.org/apply with the repository link `github.com/builtbysai/Beacon-Remote`. This has to be you, as the
   project owner, and takes a few minutes. Approval reportedly takes a day or two.
3. When approved, create the API token SignPath gives you and save it as the only line of
   `C:\Users\Saiha\.beacon\secrets\signpath-token.txt`. Tell me.

I then: add the licence, move the Windows build into GitHub Actions so SignPath can sign it, wire in the token as a
repository secret, publish a signed installer, and check that Windows shows your publisher.

If not (you do not want the source open): the cheapest alternative is Azure Artifact Signing at about $10 a month,
available to individuals only in the US and Canada, with an identity check that takes a few days. You would sign up
in the Azure portal, complete the identity check, and tell me; I do the rest. Staying unsigned is free and the
warning stays.

## 3. Test on real hardware (free, 1 to 2 hours)

Nothing replaces this, and it is what moves features from "works on my fixture" to "validated".

Windows computers: install the latest build on each Windows PC you have (Downloads page), then follow sections 1
to 6 of `docs/acceptance-checklist.md`. Include one session over mobile data and one after the PC sleeps.

Android phone, one time:

1. Settings, About phone, tap Build number seven times. Then Settings, System, Developer options, turn on
   USB debugging.
2. Plug the phone into this PC and tap Allow on the phone's prompt.
3. Tell me. I build and install the app, pair it, and walk you through the on-phone taps, then you follow
   section 7 of the checklist.

Send back, for anything that felt off: the time, what you did, and the session's row from Sessions (the
Connection column). I fix what you find.

## 4. Later, only if you want it

- **Install the Android app without a cable:** free. I create a release key and offer the app on the Downloads page.
  Google Play instead has a one-time fee of about $25 and a testing requirement for new accounts; check Play Console
  for the current rule. Tell me which you prefer once the real-phone test passes.
- **A macOS host:** needs a Mac to build and test on, and Apple's developer programme ($99 a year) to sign it.
  Linux hosts need neither and are free; say when you want them.

## What I am doing meanwhile

Relay and server health alerts (waiting only on step 1 for the mail part), roles and technician accounts, the
remaining design rollout, file-transfer resume, and the Windows tray notification for incoming requests. See
`docs/roadmap.md`.
