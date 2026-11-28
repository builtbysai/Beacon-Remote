# Beacon Remote design direction

Status: November 2026 rebuild of the web app. It replaces the October audit and three earlier November attempts (a soft-card
template, a dark "lamp and serif" look, and a plain text-only look). The older `design/prototype/` mock-up is no
longer the target and was removed (November 28; it remains in git history).

## How we got here

The first passes were checked against published lists of AI-generated design tells and failed in two ways: the early ones
matched the tells (gradients, glow, serif with an italic word, mono labels, card rows), and the plain one avoided them but had
no personality. Studying real sites changed the answer. Family and Benji Taylor's own site get their identity from a drawn
cast, a distinctive typeface and one human touch (a hand-drawn annotation); Lando Norris's from a single loud flat colour.
Restraint alone is not a point of view.

## The idea

**Remote access that knocks first.** Every computer is a small monitor with a face. The logo's signal arcs mean "reachable":
awake computers have them, sleeping ones do not, revoked ones are crossed out. The cast carries state in lists, the
inspector, empty states and sign-in, so state is told by shape and expression, never by colour alone.

## Rules

1. **The cast does the talking** (`Characters.tsx`). One drawing system: a rounded monitor, a face, stub arms, in blue, sun,
   coral or mint. Moods: awake, wave, asleep, locked, wow. Each computer keeps its own colour (`toneFor`).
2. **Big, confident type.** Atkinson Hyperlegible Next at weight 800 for display, tight tracking, sentence case. No tracked
   uppercase labels. Mono only for real codes and IDs.
3. **Colour is content.** A warm paper page; saturated tint tiles (mint, sun, blue, coral) for different ideas; one solid
   brand-blue block for the call to action; black pill buttons. Light is the baseline; dark keeps the same cast on charcoal.
4. **Tiles, not boxes.** Large radii (28 to 40px), no borders or shadows at rest. Each tile shows the real UI it describes
   (the Windows approval dialog, the Stop banner, the View only / Control switch, a revoked computer).
5. **One human touch.** The hand-drawn underline under "knocks first." draws itself once.
6. **Plain words.** Verifiable claims, no slogans beyond the headline, nothing a founder would not say aloud.
7. **Motion has a job.** Eyes blink, arcs transmit, sleeping computers breathe, the waving arm waves, sections rise on scroll
   (CSS scroll-driven, no JS). Buttons press to 96%. Everything stops under reduced motion.

## The Computers screen

- **List:** search on its own row, status chips with counts (All, Online, Offline, Revoked), then one tile per computer with
  its character, an access pill (Trusted, Ask each time, Revoked) and a Connect button.
- **Inspector:** the character, name and state, then Remote and View only. Details sit in three tabs, not accordions:
  Overview (four fact tiles, the actions that lower access, a copyable device ID, Manage), Sharing (support access), History.
- **Viewer:** same palette and pill controls as the workspace; the toolbar shows the computer's character, waving while it
  connects, awake once the picture arrives, asleep when it ends.

## System

- Tokens at the top of `apps/web/src/style.css`. Fonts are self-hosted in `apps/web/public/fonts/` (OFL, see its README).
- Do not put `backdrop-filter`, `transform` or an animation fill on an ancestor of `.live-view` or of the phone nav; either traps
  `position: fixed`. The scroll reveal is only used on public-page sections.
- `viewer.css` keeps its own always-dark palette, scoped to `.live-view`.
- Layout hooks used by the browser tests (`.heading`, `.device-row`, `.device-name`, `.device-open`, `.status-dot`,
  `.device-inspector`, `.login`, `.workspace-nav`, `.workspace-signout`) are stable; change them together with the tests.
  `.status-dot` holds the row's character; a bare `.status-dot` is a plain dot.

## Out of scope

The native Windows host windows (ADR 0029), the Android host, and the live viewer's own chrome.
