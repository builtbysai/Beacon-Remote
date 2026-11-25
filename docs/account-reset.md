# Owner-requested Remote account reset

November 8, 2026. The owner requested deletion of every Beacon Remote account
and associated data, including test accounts, followed by fresh accounts.
View/Motive, OS users, shared infrastructure and signing/SSH/server identities
are outside this operation. The earlier retained-test-account instruction is
superseded. This is an authorized maintenance operation, not an app release.

## Executed database reset and current boundary

All four database resets committed on November 8. Six old accounts and their
associated database data were removed. Independent post-restart checks found
all 23 development, 23 test, 20 production and 8 acceptance public account-data
stores empty. The same production backend container/image was restarted and
became healthy; both retained old production logins returned HTTP 401 without
issuing session cookies. Acceptance remained stopped, its STOP marker remained
present, and View/Caddy/Coturn/PostgreSQL services were not restarted or changed.

The successful final quiesced recovery/reset run is
`5cbb761c38b0405aa62721d3d687230d`, encrypted snapshot
`8242ae2744b5d1f3b9681d9c8a69dfacf55817be8e4c6324288c452153944fbd`.
It included the current retained private account records and canonical database
recovery copies, with decrypted hashes verified before deletion. The private
`reset-receipt.json` records each committed database result, unchanged image and
retired-login refusals. `scripts/Invoke-AccountReset.ps1 -Execute` implements the
bounded operation with service restoration in `finally`; it does not deploy code.

The first quiesced attempt completed encrypted recovery but refused before SQL
deletion because PowerShell `Write-Output -NoEnumerate` returned a list wrapper
rather than the expected hashtable. Its backend was restored unchanged. The
corrected invocation reads an explicit run's persisted JSON receipt as a
hashtable, then repeated final backup/recovery before the passing reset.
Historical acceptance-schema and current-schema PostgreSQL regressions passed;
typecheck, focused ESLint, PowerShell parsing and diff checks passed.

Eight inventoried obsolete private files were removed after recovery/hash checks:
the two local account records, two production login records, acceptance login
record and three canonical recovery dumps. Installed runtime DPAPI identities,
server/application/signing/SSH secrets and OS users were preserved. Exact
plaintext staging/restore files from the successful run were removed. The two
earlier preparation runs' 32 plaintext copies were also removed by
`scripts/Clear-AccountResetPlaintext.ps1`, which verifies the named encrypted
snapshots and file hashes and never recursively deletes directories. Sanitized
metadata receipts and encrypted recovery remain.

After independently establishing the empty baseline, a fresh local private
temporary account was created and its status/restricted ACL checked. Its record is
`remote/local/accounts/temporary-development.json`; this is a fresh identity,
not the deleted account or reused password. No replacement production or
acceptance account has been provisioned in this checkpoint.

**Account-data erasure is not fully complete:** historical encrypted workstation/
cloud backups, server acceptance artifacts, private fixture profiles and any
provider-held email/log copies still need bounded inventory and retention/purge
handling. Old offline endpoint refusal/re-enrollment remains a device gate.
Do not claim those copies or installed identities were erased by a database reset.

The operational backup source was corrected to accept a valid empty-account
restore in its scheduled schema-only drill. Shell syntax passed; the backup
helper actually restored empty databases. That source correction has not been
deployed into the pinned operational backup image and must be included/verified
with the operational image update. Restore success must not require a user to
exist on a newly reset installation.

## Historical preparation inventory

Read-only inventory found these separate databases. Counts contain no account
identities and describe the inventory time, not a frozen final reset baseline.

| Environment       | Database                            | Accounts | Machines | Browser sessions | Account invitations |
| ----------------- | ----------------------------------- | -------: | -------: | ---------------: | ------------------: |
| Local development | `beacon_remote_dev`                 |        2 |        0 |                0 |                   0 |
| Local test        | `beacon_remote_test`                |        0 |        0 |                0 |                   0 |
| Hosted production | `beacon_remote`                     |        3 |       11 |                1 |                   1 |
| Paused acceptance | `beacon_remote_acceptance_20261010` |        1 |        1 |                0 |                   0 |

The hosted acceptance backend remains Created/inactive and its web is stopped.
Production's known Remote backend is running; local supervisor status references
an exited supervisor, which alone does not establish that ports/writers are idle.
Do not kill an unknown listener to quiesce the local environment.

`scripts/Backup-AccountReset.ps1` captured all four databases, backed them up to
the existing independent encrypted Restic repository and restored the owned
snapshot subtree into a new restricted directory on C:. SHA-256 hashes matched.
Each decrypted dump was restored into a newly created local PostgreSQL database;
the owned restore database and its exact container dump were removed afterwards.
No live database was replaced or used as a test target. The script does not
prune backup history, delete accounts or start the paused acceptance fixture.

The successful run is `6a1521961902491385d8ed3be2796121`; the encrypted snapshot
is `6358484af9893bf51e268d952ca0f2f5e44499b8e796a7a54dc9245ab6145a1b`.
Its private receipt is under the configured private root's
`remote/account-reset/<run>/recovery-receipt.json`, with an independent copy in
the restricted backup restore directory. It explicitly records
`liveWritesQuiesced:false` and `accountsDeleted:false`. It is a verified
preparation backup, not evidence that the reset was performed.

Restricted plaintext dump/restore copies and older recovery archives still
contain old account data. Their inventory and bounded removal/retention remain
part of reset completion; no irreversible-erasure claim is made.

## Maintained reset procedure

`apps/backend/scripts/reset-account-data.sql` is an operator-only transaction,
not a migration, backend route or startup action. It requires two explicit
connection settings: `beacon.account_reset_database` must match the exact reviewed
Remote database name, and `beacon.account_reset_recovery` must be
`RESTORE_VERIFIED` **after** actual encrypted backup recovery has succeeded.
The settings are operational gates, not substitutes for the evidence above.
Use `psql -X -v ON_ERROR_STOP=1` when executing the script, and check its exit code.
Connection credentials must come from existing private configuration, never
command arguments or logs. Never load production credentials into test defaults.

The transaction:

- Rejects unexpected/incomplete schemas, unreviewed public tables, external
  foreign-key dependencies and custom triggers before mutation.
- Locks the reviewed account stores in stable order with a bounded wait. It
  fails rather than terminating another writer or broadening the target.
- Deletes independent `account_invitations` as well as all `accounts`. Those
  invitations lack an account FK and would survive an account-only deletion.
- Requires every present reviewed account-data table to be empty afterwards,
  including new sign-in authority/leases. Missing cascades or orphan data roll
  the whole transaction back, including the invitation deletion.
- Preserves schemas, roles, volumes and other products; it neither recreates
  accounts nor resets identity sequences.

The dedicated PostgreSQL regression creates its own separate `_test` database.
It passed incorrect-target/recovery refusal, unknown table and cross-schema
dependency refusal, rollback after missing cascades, current sign-in authority
cleanup, independent invitation removal and repeat empty reset. Backend
typecheck, focused ESLint and formatting/diff checks passed. No production
accounts were deleted to test the procedure.

## Original execution checklist and remaining completion gates

The four-database reset, current credential-file recovery/removal and unchanged
backend restoration below are now done as recorded above. Historical/provider
copy handling, fixture/runtime reconciliation and device refusal acceptance
remain open. Do not re-run the reset against newly created accounts merely
because this original checklist remains as the operation's contract.

1. Inventory retained Remote credential records, private fixture profiles/dumps,
   server acceptance artifacts and provider-held mail/log/backup copies without
   printing their contents. Back up and recovery-check the exact private files
   before removing them; the database-only preparation snapshot does not include
   every current private credential record.
2. Quiesce only verified Remote writers, keeping the acceptance STOP marker and
   inactive services intact. Preserve exact production image/config ownership;
   no application deployment, View/Caddy/Coturn change or migration is required.
   Record existing service state so the same owned backend can resume on failure.
3. Take/recover-check the final quiesced backup, execute the bounded reset on all
   four explicit databases, and independently recheck all related stores. Restart
   only services deliberately stopped for this operation. Confirm old sessions,
   invitations, enrollment keys and grants cannot authorize access.
4. Remove only inventoried, verified obsolete Remote credential/profile files
   and recovery copies within their checked paths. Do not traverse junctions,
   recursively delete directories, purge shared backup history or remove live
   installed identities as an inferred side effect. Document any retained
   backup/provider copies and their expiry/deletion status honestly.
5. Create fresh private test identities after confirming the clean baseline.
   Re-enroll designated endpoints deliberately. Verify old offline endpoints
   are refused on reconnect; do not infer this from table counts alone. Remove
   the new test identities at full completion.

The project remains active. This database reset does not finish account erasure,
unattended access, physical acceptance, UI/email work or the wider roadmap.
