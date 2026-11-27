# 0068: Shorter, plain pairing codes

Status: accepted November 27, 2026, at the owner's request ("shorter and not masked"). Built: the backend issues the new
codes, the shared schema accepts them, and the Windows host shows the code in plain text. Not built: any change to the
phone-shows-a-code flow, which already used eight symbols (0050).

## What changed

- **New codes are eight symbols, shown `XXXX-XXXX`** (from 32 symbols that leave out `I`, `O`, `0` and `1`). Before, they were
  twelve in three groups. A code issued before the change stays valid until it expires, typed in either form.
- **Typing is forgiving.** Case, spaces and the dash are ignored (`ab3k 9pq2` is `AB3K-9PQ2`). Letters that are easy to
  confuse are never in a code, and a code containing one is refused rather than guessed at.
- **The Windows host shows the code in plain capital letters, not as dots.** A hidden code hides typos, and this one is short,
  works once and expires in five minutes. The box is kept after a failed attempt so a typo can be fixed, and cleared only
  once pairing has worked. The message names the box that is missing instead of listing all three.
- **A pairing link can be pasted into the code box** (the `beaconremote://pair?code=…&server=…` link the workspace already
  offers for phones). It fills in the server and the code and then stops, so the person sees which server it names before
  pressing Pair.

## The trade, in numbers

Eight symbols are 40 bits (32^8, about 1.1 trillion), down from 60. What still limits a guess:

- a code works **once** and **expires in five minutes**;
- an account may hold **at most ten** unused codes at a time;
- the enroll route allows **ten tries a minute from one address**, so one address gets about fifty guesses in a code's whole
  life;
- a successful guess only **adds a computer to the account**; the owner sees it appear and can revoke it, and it needs
  nothing from the person at any other computer.

For one guesser the chance is about fifty in a trillion per active code. A thousand addresses working together against a
service holding ten thousand active codes would still be under one in two thousand per five minutes. That is acceptable at
this size and for this impact, and it is the number to revisit if the hosted service grows to many accounts, or if a
code could ever grant more than "add a computer".

## If it has to get stronger

Keep the short code and add a per-code limit by giving each code a short non-secret handle that the client sends with it, so
wrong guesses can be counted per code and the code killed after a few. That is a protocol change for every client, so it is
not done here.

## Checks

- Protocol tests for the normalization (case, spaces, dashes, both lengths, the confusable letters, wrong lengths).
- The backend enrollment test asserts the new shape and that an older twelve-symbol code can still be claimed.
- Host window tests for the missing-field message and for reading a pairing link.
