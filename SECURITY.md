# Security policy

Beacon Remote is a development private alpha. Publishing its source does not
make it a supported consumer release. Production desktop media remains gated;
remote input, a signed installer, automatic updates, public registration, MFA,
account recovery and account deletion are not shipping features.

## Reporting a vulnerability

Use this repository's **Security → Report a vulnerability** when private
vulnerability reporting is enabled. Do not put credentials, screen contents,
private infrastructure data or exploitable details in public issues. If private
reporting is unavailable, ask the maintainer to enable a private reporting channel
without disclosing the vulnerability publicly.

Only the current development branch is maintained. There are no supported
versioned binaries; CI artifacts are unsigned development builds and must not be
treated as trusted releases.

## Contributor requirements

Never commit live credentials, `.env` files, native identity state, database dumps,
acceptance account files or screen recordings. Use generated test credentials
only with isolated test databases. See [security boundaries](docs/security.md)
and [AGENTS.md](AGENTS.md) for consent, authorization and product isolation rules.

Public pull requests run on disposable GitHub-hosted runners with read-only
repository access and no deployment secrets. Do not attach a production host or
developer workstation as a runner for untrusted pull requests. Review changes to
workflows and dependencies before merging. Deployment remains a separate,
operator-controlled operation using reviewed commits and protected credentials.
