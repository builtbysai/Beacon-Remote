# Waiting on the owner

Everything here needs an account, a device, or a decision that only the owner can make. Items are ordered by value
for the least money. Prices are what the vendors listed on 2026-10-13; check the vendor page before paying.
Nothing here is needed to keep using the product as it runs today.

| #   | Item                                        | Cost                                     | Your time                | What it unlocks                                 |
| --- | ------------------------------------------- | ---------------------------------------- | ------------------------ | ----------------------------------------------- |
| 1   | Real-device acceptance                      | Free                                     | 1 to 2 hours             | The "Validated" column for most features        |
| 2   | Email sign-up, recovery and alerts (Resend) | Free (3,000 mails a month, 100 a day)    | 20 minutes               | Public sign-up, password recovery by email      |
| 3   | Windows code signing                        | Free to about $10 a month                | 30 minutes to a few days | No "unknown publisher" warning on the installer |
| 4   | Android host on a real phone                | Free                                     | 30 minutes               | Validates the Android host beyond the emulator  |
| 5   | Android host distribution                   | Free (direct APK) or a one-time Play fee | 30 minutes               | Installing the phone host without a cable       |
| 6   | macOS host                                  | $0 to build, $99 a year to sign          | Needs a Mac              | A macOS host people can open without warnings   |

## 1. Real-device acceptance (free)

Follow `docs/acceptance-checklist.md` on the computers and phone you have. Send back, for anything that felt off:
the time, what you did, and the session's row from Sessions (the Connection column). The checklist's last section
covers the Android phone once you have installed the debug build (item 4).

## 2. Email: sign-up, recovery, alerts (free)

Resend's free plan allows 3,000 emails a month and at most 100 in a day, with one sending domain. That is plenty
for a private alpha; the daily cap is the number to watch, and a paid plan ($20 a month for 50,000) is only needed
if sign-up becomes public and busy. Remote must use its own account and key, not Beacon View's.

1. Create a Resend account with an address you control and add a sending domain (for example
   `remote.builtbysai.com`, or a subdomain such as `mail.remote.builtbysai.com`).
2. Add the DNS records Resend shows (SPF and DKIM, free). Wait for the domain to show Verified.
3. Create an API key limited to sending. Do not paste it anywhere except step 4.
4. On the Oracle server, add to `/etc/beacon-remote/production-media.env`:
   `RESEND_API_KEY=<the key>`, `MAIL_FROM="Beacon Remote <no-reply@your-domain>"`, `PUBLIC_SIGNUP=true`.
5. Tell me; I restart the stack, send a test message to your address, and confirm sign-up and recovery.

Leave `PUBLIC_SIGNUP` unset if you would rather keep accounts invitation-only; recovery by email still works for
existing accounts.

## 3. Windows code signing (free to about $10 a month)

Today the installer and programs are unsigned, so Windows SmartScreen warns on first run. Updates are already
protected by the host update feed's own Ed25519 signature, so this is about first-run trust, not update security.

| Option                     | Cost                      | Catch                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SignPath Foundation        | Free                      | The repository needs an OSI-approved open-source licence (it is public but has none today), a free download, and a CI-built binary. The publisher shown is "SignPath Foundation". I would move the host build into GitHub Actions. Approval reportedly takes a day or two. |
| Azure Artifact Signing     | About $9.99 a month       | Individuals only in the US and Canada (organisations also EU and UK); identity validation takes a few business days. Publisher shown is you.                                                                                                                               |
| Traditional OV certificate | About $150 to $300 a year | Hardware-token or cloud-HSM rules add friction; SmartScreen reputation still builds slowly.                                                                                                                                                                                |
| Stay unsigned              | Free                      | The warning stays.                                                                                                                                                                                                                                                         |

Recommendation: if you are comfortable publishing the source under a licence (MIT or Apache-2.0 are the usual
choices), take SignPath: free, and the warning goes away. If not, Azure Artifact Signing is the cheapest paid path
if you are in the US or Canada. Decide the licence question first; tell me which and I do the build and CI work.

## 4. Android host on a real phone (free)

1. On the phone: Settings, About, tap Build number seven times, then turn on USB debugging.
2. Connect it by cable. I build `apps/android-host` and install the debug build with `adb`.
3. Pair it against production with a code from Add a computer, then run section 7 of the acceptance checklist,
   including Wi-Fi to mobile data and a locked screen.

## 5. Android host distribution

The free route is a signed APK offered on the Downloads page; Android asks the person to allow installs from the
browser once. That needs an Android release key, which I can create and keep beside the Windows key. Google Play
needs a one-time developer registration fee (about $25) and, for new personal accounts, a closed test with a
minimum number of testers before production; check Play Console for the current rule before paying. Not needed
until the real-phone test passes.

## 6. macOS host

A macOS host needs a Mac to build and test on, and Apple's developer programme ($99 a year) to sign and notarise it
so macOS will open it. Linux hosts need neither and are free; they can be started whenever you want them.

## Not blocked on you

Relay quota alerting, file-transfer resume, roles and technician accounts, and the remaining design rollout are
mine to build; see `docs/roadmap.md`.
