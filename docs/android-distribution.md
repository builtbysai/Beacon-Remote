# Android host: how it is installed, and what each route allows

The Android host (`apps/android-host`, ADR 0034, 0036, 0045) is not on Google Play. There are three ways to run it, and they differ in what
Android permits.

| Route                                 | What it is                                                                                          | What works                                                                               | Limits                                                                                                                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Personal testing (debug build)**    | `gradlew assembleDebug`, installed with `adb install` on your own phone                             | Everything, including the debug-only cleartext exception for the emulator's host address | Signed with a debug key that differs per machine; never for other people                                                                                                                                                                                  |
| **Sideloaded release (this project)** | A release APK signed with your own key, downloaded from your own server and installed by the person | Viewing, file receiving, and control once the person turns on the accessibility service  | Android shows "install unknown apps" prompts and, from Android 13, restricts turning on accessibility for sideloaded apps until the person allows restricted settings in the app's info screen. The person does that once; the app cannot do it for them. |
| **Google Play**                       | A store listing                                                                                     | Viewing and file receiving                                                               | Play's policy limits accessibility services to accessibility use, and remote control of another person's phone does not qualify; screen-sharing apps need a declaration and review. Plan on view only, or a separate listing without control.             |

## Release key and building

`scripts\Beacon-Android.ps1 -Action New` creates the release key once (RSA 3072, valid 25 years) under `%USERPROFILE%\.beacon\secrets
emote-android`, with a
random password beside it, both readable only by you, and never replaces an existing key. Back that folder up: Android only installs an update over an app signed
with the same key, so losing it means every phone must uninstall and pair again. `-Action Info` prints its SHA-256. `-Action Build` runs the unit test and a
release build signed from that key (the gradle build reads it from the environment; nothing secret is in the repository), verifies the signature and writes
`dist\BeaconRemoteHost-<commit>.apk`. The Downloads page offers it when `scripts/publish-download.mjs` is given the APK and the key's SHA-256 as its
last two arguments, and shows that fingerprint so a person can check it.

## Battery and background

The app keeps one foreground service while it is available and another while it is sharing, so Android's own indicator and the notification are
always visible. On many phones aggressive battery savers still stop the first one; the person can exempt Beacon Remote under Settings, Apps,
Battery. The app does not ask for the exemption itself: it is an optional convenience, and a phone that was stopped is simply shown as offline.

## Tablets and TV

Tablets work like phones. Android TV is installable (leanback launcher entry and banner) and is view only: it has no touch screen to control.
Neither has been tried on real hardware.
