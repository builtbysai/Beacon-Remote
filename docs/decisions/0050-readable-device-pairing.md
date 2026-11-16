# Readable device pairing codes

The owner found the 32-character invitation impractical to enter on a phone.
New device invitations use twelve independently selected symbols from a
32-character alphabet, displayed in three groups of four. The alphabet omits
`I`, `O`, `0` and `1`; the code carries 60 bits of random entropy. Selection uses
Node's cryptographic `randomInt`, without modulo bias.

Only an authenticated owner with an exact matching Origin may issue a code.
Existing issuance/claim rate limits and pending-invitation/device limits stay in
place. Codes remain hashed in the database, single-use and valid for five minutes.
Claim and cancellation still serialize in the existing transaction. Pairing
creates a machine identity, not a desktop grant or standing access permission.

For these new codes, claim/status/cancel accept lowercase, spaces or omitted
grouping and normalize to the issued form before hashing. Previously issued
32–64-character base64url invitations preserve their exact case and remain valid;
they must not pass through the new normalization. Account invitations, support
codes, session tokens and device signing keys are separate and unchanged.

The real-database enrollment regression covers readable issuance, owner/Origin
boundaries, normalized lookup/cancel/claim, expiry, reuse, concurrent claim versus
cancel, and case-sensitive legacy invitations. Android preserves code case and
disables forced keyboard capitalization. Signed device acceptance remains a
separate release gate.
