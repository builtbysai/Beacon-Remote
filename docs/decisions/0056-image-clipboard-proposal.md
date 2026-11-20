# Image and file clipboard (proposal, not decided)

Status: proposed, 20 November 2026. Needs the owner's yes before any code. ADR 0053 covers text and formatted text.

## Question

Should a phone share images (and files) on the clipboard with a viewer, as it now shares text?

## Recommendation

Yes for images, no for files, behind the same device setting as text, with one extra rule: images move only when
the viewer presses a button, even when the setting is Automatic.

- Why only on a press: an image can be a screenshot of a bank page or a private photo. Text in Automatic mode is
  already a risk the owner accepts; a picture is larger, harder to notice and cannot be skimmed in a notification.
- Size: PNG up to 4 MB, one image at a time, through the existing files channel (not the 2 KB input channel), with
  its length and SHA-256 checked as for files.
- Android: reading an image from the clipboard needs a content URI the phone can open; writing one needs a
  FileProvider entry that is deleted when the session ends. Both are new code and need a device test.
- Files stay out: copying a file is a file transfer, which already has its own permission and prompt.

## If the owner says no

Text and formatted text stay as they are (ADR 0053). Nothing else changes.

## Tests needed before it counts

Pixel: send an image from the viewer, paste it in an app on the phone; copy an image on the phone and receive it in
the browser; Off blocks both; a 5 MB image is refused with a message; the temporary file is gone after Stop.
