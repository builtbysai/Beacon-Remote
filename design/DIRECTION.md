# Beacon Remote design audit and direction

Status: first pass, 2026-10-13. The Computers list is the representative screen; the rest of the app follows it.
Before and after captures are in `design/screenshots/design-review/`.

## What was wrong (the audit)

Found by looking at the live web app at desktop (1440), tablet (768) and phone (375) widths against the approved mockup
in `design/screenshots/reference/approved-mockup/`.

| Signature                                     | Where                                                    | Why it is a problem                                                       |
| --------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| One loud primary button repeated on every row | Computers list: "View desktop" ×N, half of them disabled | Six identical filled buttons say nothing; disabled ones are pure noise    |
| Rows that carry no information                | Computers list: icon, name, status word, button          | The only facts were name and online/offline; no access mode, no last seen |
| Oversized rows and padding                    | 16px padding, ~42px of dead space per row                | Six computers filled a screen; a fleet of thirty would scroll             |
| Icon repeated per row                         | Monitor icon beside every name                           | Decoration; every row is a computer                                       |
| Status as coloured words ("● Online")         | Rows                                                     | Needs reading; a dot plus a column is scannable                           |
| Headings with decorative sub-labels           | Section headers with a caption under each                | Restates the heading                                                      |
| Mixed type sizes with no scale                | 11/12/13/14/19 px used ad hoc                            | Hierarchy by accident                                                     |

The rest of the app (sessions, assist, activity, downloads, settings) keeps the same shell and is closer to the mockup;
it gets the same row, spacing and button rules in the roll-out, not a rewrite.

## What the best remote tools do

Learned from using and studying them, not copied:

- **RustDesk, AnyDesk:** the address book is a dense list; the ID and status are the content, and the connect action
  is a single obvious control. Settings stay out of the way until needed.
- **Chrome Remote Desktop:** almost nothing on screen. Online computers are listed; the one action is to connect.
  Calm, large type, no ornament. Proves that fewer elements reads as more trustworthy.
- **BeyondTrust and similar support consoles:** tables with real columns (name, state, last contact), a detail pane
  beside the list, keyboard-first. Dense because operators live in it.

What works in all of them: information in columns, one primary action, state shown by a small mark, detail on demand.

## Beacon's direction

Beacon Remote is a tool people open to reach their own computers, and often in a hurry. The identity is **quiet
precision**: the product earns trust by showing facts plainly, not by decoration.

1. **Tables over cards.** Lists are rows with columns and a hairline between them. Cards only where a thing is
   genuinely one object (the inspector, a consent prompt).
2. **One primary action per screen.** Everything else is outlined or text. A control that cannot be used is
   removed, not greyed, unless its absence would confuse.
3. **Small, flat, aligned.** 13px body, 12px secondary, 11px column labels, 6px radii, 1px borders, no shadows
   except for floating layers, no gradients, no pills except status where the shape carries meaning.
4. **State is a mark.** An 8px dot (filled online, hollow offline) with an accessible name; words only when the
   state needs explaining.
5. **Density with room to breathe.** 40px rows, 16px gutters; the inspector opens beside the list at wide widths and
   below it on a phone.
6. **Blue is for action and focus only.** Slate for structure, green only for "online", red only for revoke or
   failure. The Windows windows use the same palette (ADR 0029).
7. **Accessible by default.** Visible focus ring, 4.5:1 text contrast, state never by colour alone, rows operable by
   keyboard, reduced-motion respected.

## Done in this pass: Computers list

Before: six identical "View desktop" buttons, icon per row, name and status only, 16px padding.
After: header row (Computer, Access, Last seen), 8px status dot, access mode and last seen in muted text, a single
outlined "View" only on online computers that turns solid on hover or selection, 40px rows. On a phone the Access
column drops out and the row keeps name, last seen and the action.

## Next, in order

1. Inspector header and actions to the same scale (one primary: Connect; Stop access and Revoke as text).
2. Sessions, Activity and Assist lists to the table pattern; remove per-row icons and caption lines.
3. Landing page copy and spacing against the mockup; drop any section that restates another.
4. Re-run the axe audit and capture before and after for each screen with `scripts/shot.mjs`.

Not planned: a new component library, a theme system rewrite, or new illustrations.
