# Public-source security review — 2026-10-12

## Decision

**Conditional go for publishing the source after merging the reviewed CI
hardening.** No live credential exposure or critical/high application finding was
identified in the inspected material. This is a focused source/history/CI review,
not a penetration test or authorization to open the product to general consumers.
Production desktop media remains disabled and the existing release gates remain.

The initial review preceded publication. The owner subsequently changed source
visibility after PR #14 merged. The completion record below distinguishes these
repository operations from production deployment and product release.

## Publication completion and CI follow-up

PR #14 merged at `bd1c9625dcd2d56a7c8f1c92f37b3248c3050b5f`. The owner made
the repository public and enabled secret scanning, push protection, private
vulnerability reporting and a main review rule. API readback confirmed these
settings; Dependabot alerts and approval for all external fork contributors are
also enabled. Action allowlisting, full SHA pinning, read-only default token
permissions and disabled Actions PR approval are verified.

Main now requires the `security`, `control-plane` and `native` checks from the
GitHub Actions integration, an up-to-date branch, one review, code-owner approval,
stale-review dismissal and conversation resolution. A separate active
`Main CI and integrity` ruleset has no bypass actors and enforces the same checks,
no force pushes and no deletion for everyone, including administrators. The
classic review rule permits administrator bypass for the sole repository owner;
GitHub rejected user-specific review bypass allowances on this personal
repository. This exception does not bypass the integrity ruleset's CI checks.
See [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
and [the ruleset API](https://docs.github.com/en/rest/repos/rules).

The hardened main workflow [38210455352, attempt 2](https://github.com/builtbysai/Beacon-Remote/actions/runs/38210455352/attempts/2)
started real hosted jobs after publication. Its secret scan and RustSec audit
and native Windows formatting, Clippy, tests and release build passed. The
control-plane job exposed a fresh-database race: multiple test files
executed `CREATE TABLE IF NOT EXISTS` concurrently, conflicting on PostgreSQL
catalog entries. Serializing test files fixes their shared-schema initialization;
concurrent enrollment, invitation and signaling checks inside each test remain.
The corrected suite passed all ten checks without skips on a newly created,
isolated local `_test` database. This failure is not retried away or treated as
successful CI; the fix must pass a new protected PR workflow before merging.

CI pushes now target main; pull requests retain all three checks without path
filters. This avoids duplicate feature/Dependabot push builds and limits unsigned
development artifact uploads and native cache writes to main builds. Weekly
Dependabot proposals are reviewed and validated individually; no automatic merge
or production deployment is configured. Production media remains disabled.

Enabling Dependabot surfaced eleven alerts across manifests and lockfiles,
representing six distinct advisories affecting development tooling. The initial
production-only npm audit did not cover these tools. Updated Vite from 8.0.3 to
8.0.16 and tsx from 4.21.0 to 4.23.15, which resolves esbuild to 0.28.2 without a
dependency override. The full npm audit now reports no known vulnerabilities,
including development dependencies. Hosted and local CI audits now include the
full dependency graph and reject high-severity findings. With the patched
dependencies, frozen install, formatting, lint, types, all ten real PostgreSQL
checks without skips and backend/web builds passed locally against another new
isolated `_test` database. The relevant Windows
development-server issues are documented in the
[Vite advisory](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)
and [esbuild advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr).
This does not establish that a Windows developer was exploited or that the
production static site exposed these development servers. GitHub alerts must
be rechecked after the patched lockfile reaches main.

## Scope and evidence

- Fetched both remote branches and the heads of all 13 existing pull requests.
  The inspected graph contained 87 reachable commits, including merge commits;
  Gitleaks 8.30.1 scanned 77 commits with patches, about 1.12 MB, with archive and
  decoding depth three. No findings. The current working tree scan also found
  no leaks. Scanner output was fully redacted.
- Reviewed historical filenames: the only environment file was the development
  `.env.example`; the only tracked binary asset was the public Beacon logo PNG.
  No private key, native identity, account login file, database dump, installer,
  screen recording or acceptance screenshot was found in reachable history.
- Scanned issue/PR bodies and issue/review comments: no Gitleaks findings.
  Of 127 existing Actions runs, 86 had nonempty downloadable logs, about 6.03 MB;
  those logs had no findings. Thirty-nine log reads were unavailable and two
  returned no log content. Missing logs cannot be certified. The artifact list
  contained only 43 `windows-agent-development` artifacts; binary payloads were
  not independently inspected in this review.
- Repository Actions defaults were read-only; Actions could not approve PRs.
  There were no repository Actions secrets, environments or self-hosted runners.
  Repository action policy allowed all actions and did not require SHA pinning.
  Public fork-approval and branch-protection settings could not be inspected on
  the current private repository; enable and verify them after conversion.
- RustSec `cargo-audit` 0.22.2 reported zero known vulnerabilities and no warnings
  for the current `Cargo.lock`. Production npm dependency audit found no known
  vulnerabilities. Tool downloads were checked against official release hashes.
- Local control-plane validation passed frozen install, formatting, lint, types,
  ten real PostgreSQL security/lifecycle tests with no skips, and builds.
  Workflow validation passed actionlint 1.7.12. Hosted CI remains unverified
  because the account restriction prevented jobs from starting.
- Local Windows native formatting, Clippy with warnings denied, nine native
  tests and optimized release builds passed using the newly installed Microsoft
  C++ Build Tools and Windows SDK. This includes DPAPI tamper rejection,
  kill-on-close helper lifetime, controller isolation/expiry, delayed/replayed
  lease replies, strict relay grants and denial of cached snapshots on a noninput
  desktop. No real screen was captured by these checks.
- Reviewed password/session handling, account-scoped queries, exact Origin
  checks, signed machine presence, one-use enrollment/grants, signaling role and
  size limits, consent/audit atomicity, renewal deadlines, relay issuance, local
  DPAPI storage, helper process lifetime, capture availability and deployment
  credential boundaries.
- Read-only production probes returned 200 for the public site. Inventory,
  activity, session history, browser-session list and media configuration each
  rejected unauthenticated reads with 401 and `Cache-Control: no-store`. CSP,
  HSTS, no-referrer and nosniff headers were present. No production password,
  grant, relay credential or desktop was accessed by these probes.

## Findings addressed

| Finding                                                                               | Impact                                                                                                                 | Remediation                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Movable third-party action tags                                                       | A compromised or retargeted tag can change executed CI code.                                                           | All actions now use full commit SHAs verified through their upstream repositories. Dependabot proposes reviewed updates.                                                                                                                      |
| Concurrency keyed by untrusted fork branch name                                       | A fork using the same branch name could cancel a trusted push run.                                                     | Groups now include event type and PR number/ref.                                                                                                                                                                                              |
| Pull-request native artifacts shared the development-build label                      | Contributors' binaries could be mistaken for owner builds; no automatic deployment existed.                            | Uploads and native cache saves occur only on pushes; artifact names include the commit SHA. Development builds remain unsigned.                                                                                                               |
| Incomplete local-state exclusions                                                     | Additional private runtime/account/database file types could be accidentally committed or enter Docker build contexts. | Expanded Git and Docker exclusions; existing `.env` exclusions were already present.                                                                                                                                                          |
| No continuing secret/Rust advisory CI check or reporting policy                       | Future changes could regress the reviewed state.                                                                       | Added checksum-verified history scanning and RustSec audit, bounded job timeouts, Dependabot, security CODEOWNERS and a security reporting policy.                                                                                            |
| Cached desktop snapshot could remain available after desktop input became unavailable | Attended sharing should end on lock or secure-desktop transition.                                                      | Added fail-closed input-desktop checks before consent/start, during frame delivery and snapshot access; clear cached frames and end the request. Native regression uses a hidden noninput desktop. Real lock/UAC acceptance remains required. |

CODEOWNERS requests review; it enforces nothing until branch protection requires
code-owner approval. A clean scanner result cannot prove absence of arbitrary
credentials, encoded private information or application vulnerabilities.

## Publication and Actions settings

1. Merge the reviewed changes into `main` before publication so its workflow and
   security policy are the ones newcomers receive. Keep production deployment
   separate from this repository operation.
2. After changing visibility, enable secret scanning/push protection and private
   vulnerability reporting. Confirm the Security reporting form is available.
3. Protect `main`: require a pull request and code-owner review, successful
   `security`, `control-plane` and `native` checks, and prevent force pushes and
   deletion. Inspect whether owner/admin bypass is permitted deliberately.
4. Require approval for **all outside collaborators'** fork workflow runs, keep
   default token access read-only and PR approval disabled, and require full SHA
   action pinning. Review workflow changes before approving execution. Run
   untrusted code only on disposable GitHub-hosted runners.
5. Verify the first hardened workflow after conversion. Use standard hosted
   runners, retain short artifact lifetimes and bounded jobs, and monitor artifact
   storage and job usage. Public standard hosted-runner minutes are free; this
   does not establish that an account-level restriction has been cleared.

Never add production SSH, database, account, backup or TURN secrets to PR jobs.
Do not use `pull_request_target`, privileged `workflow_run` consumers, untrusted
artifacts for deployment, or public forks on the owner PC/production VM. Current
workflows use `push` and `pull_request`, minimum token privileges, and disabled
checkout credential persistence.

## Remaining product gates

The real Windows/Android interruption/performance matrix remains incomplete:
lock/UAC/display loss, denial, expiry, refresh, revoke/logout, network failure and
agent/backend restart must be exercised with matching builds. No elevated input,
service/IPC, signed installer/update trust, MFA/recovery, consumer registration or
retention/account-deletion feature is released. Session-scoped TURN credentials
can remain usable until their deadlines; relay allocations can outlive credential
expiry. The signaling service remains in the peer-authentication trust boundary;
do not claim independently authenticated end-to-end encryption.

Public operational hostnames, network topology, paths, commit metadata and
historical issue/PR discussions will be visible with the source. They are not
credentials and were retained intentionally as operational documentation.

References: [GitHub secure workflow guidance](https://docs.github.com/en/actions/reference/security/secure-use),
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[Gitleaks](https://github.com/gitleaks/gitleaks), [RustSec](https://github.com/rustsec/rustsec).
