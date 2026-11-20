# Image and file clipboard

Status: decided by the owner, 20 November 2026 (replaces the earlier proposal, which recommended images only and only
on a button press). Extends ADR 0053.

## Decision

- When the phone's clipboard setting is on (Button only or Automatic), everything on the clipboard is shared: text,
  formatted text, images and files. There is no separate limit by type; the setting is the owner's single switch.
- Sizes: the transfer limits of the files channel apply (a clipboard item is sent as a file), so very large items are
  refused with a message rather than cut.
- Off means nothing is shared, as before.

## Why

The owner chose "copy here, paste there" to cover whatever was copied. One switch is simpler to understand than one
per kind of content.

## Tests needed before it counts

Pixel: an image copied on the phone arrives in the browser and one copied in the browser arrives on the phone; a file
copy arrives; Off blocks all of them; an oversize item is refused with a message.
