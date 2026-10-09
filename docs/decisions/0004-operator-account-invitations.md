# Operator account invitations

The hosted private alpha needs owner-chosen credentials without passing passwords
through chat or an operator environment. Operators issue a random 256-bit bearer
invitation using the compiled create-invitation script. Only its SHA-256 digest
is stored, it expires after 30 minutes, and a database transaction atomically
claims it with account creation. No public invitation issuance exists.

The web URL carries the token in a fragment and removes it from history on load.
The owner enters and submits their password directly in the browser. Exact Origin
checks and a separate setup rate limit apply; Argon2 stores the password hash.
Expired, reused and concurrent claims cannot create additional accounts. An email
collision rolls back the claim rather than changing an existing account.

This is restricted private-alpha provisioning. Password recovery, MFA, deletion
and consumer registration remain release gates. Protect operator invitation output
as a credential and never include it in logs, screenshots or public documents.
