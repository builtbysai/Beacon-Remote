# Unlock from the viewer

An unattended session ends when an Android phone locks (ADR 0036 and the unattended notes in ADR 0021). The owner
chose that a viewer's person may unlock the phone by typing the passcode in the viewer each time, with the passcode
never stored. This record sets how.

## Decision

- An owner setting, "Unlock from the viewer", off by default. While it is on, an unattended viewer may keep working
  while the phone is locked. Everything else about unattended access is unchanged: the owner turned it on, the account
  has trusted access, Pause and Stop stay visible.
- The phone's PIN screen is a secure window. Android returns a black picture for it, to the phone's own screenshot
  as well, so video of it cannot work and is not attempted. The viewer shows its own number pad instead.
- The pad sends one key at a time: a digit, Delete or Enter, and nothing else. The phone presses the matching key
  through the accessibility tree of its PIN screen, and only while the setting is on and the phone is locked. If the
  PIN screen is not showing, the phone swipes up once to bring it up.
- The passcode is never stored, never put in a text field, never logged, and never part of a retry. Only the outcome
  ("ok", "not locked", "off", "no keypad") is sent back. A wrong passcode is Android's own business: its attempt
  limits and delays apply unchanged.
- The agent that builds and tests this never presses passcode digits. Test tooling refuses digits unless the owner
  sets an explicit override for their own run.
- Android password and pattern locks are not covered: only the numeric PIN screen.

## Why

Without it, a locked phone is out of reach until someone walks up to it, which defeats an always-on phone. Doing the
unlocking through the viewer keeps the passcode with the person, and Android's lock keeps its meaning: the viewer is
the owner's own authenticated, trusted session, not a way around the lock.

## Checks

Pixel, 20 Nov 2026: with the setting on, an unattended session connected to the locked phone and showed the live lock
screen; a tap on the lock screen was delivered; the PIN screen showed as black in the phone's own screenshot and in
the viewer, and its keys (0-9, Delete, Enter) were readable in the accessibility tree. Pressing keys through the
viewer's pad is not yet confirmed on the device.
