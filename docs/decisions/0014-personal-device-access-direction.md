# Personal-device access and concise native consent

## Context

After the October 12 attended Windows/Android test, the owner requested better
host UI, less explanatory text and a one-time setup that remembers a personal
device instead of asking for local approval on every connection.

## Direction and sequencing

Distinguish personal-device access from attended guest support. Pairing already
persists a computer's DPAPI-protected identity, but it does not grant indefinite
desktop access to a browser. Current milestone 4 remains attended: every fresh
request requires explicit local approval. A previous Allow, audit record, login
cookie or trusted-looking account must not silently become unattended consent.

Plan explicit owner enrollment of a personal controller during milestone 6's
installation work, with milestone 7's account lifecycle prerequisites before
consumer release. The setup must explain the chosen access mode once, bind
authorization to a revocable device credential and the correct account/computer,
support device removal and recovery, and keep view/control permissions distinct.
Guest support retains expiring authorization and fresh local approval. Credential
format, local confirmation mechanism, elevated access policy and expiry/recovery
details require implementation design and review in those later milestones.
This document records direction; no remembered-access endpoint is implemented.

## Current native presentation

Keep attended windows focused on who is requesting access, what is shared, its
duration, and Allow/Decline or Stop. Remove paragraphs about unavailable features.
Use compact DPI-scaled native controls and system colors, retaining readable
identity text without truncating away the account. A read-only scrollable field
allows inspecting long identities. Show the Stop window's remaining original
monotonic budget, including setup and approval time, rather than suggesting a
fresh two-minute period begins at connection.

Visible active-sharing status, the Windows capture border and local Stop remain
product controls. Concise copy does not relax consent, lock, cancellation,
expiry, renewal or capture checks. The full branded host/tray design remains
milestone 6 work and needs comparison with the approved design package.
