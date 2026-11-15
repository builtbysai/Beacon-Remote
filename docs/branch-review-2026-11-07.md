# Branch and PR review — November 7, 2026

Reviewed the live GitHub branch list, open/merged PRs, current feature branch and
the seven dependency diffs. There are 66 remote branches: main, 55 retained
branches associated with merged PRs, nine open-PR branches and the unattended
implementation branch. No branch or PR was deleted, closed, merged or published.
Local remote-tracking refs can additionally include deleted historical branches;
they are not evidence of live remote work.

| Open PR                                                      | Review and remaining action                                                                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#113](https://github.com/builtbysai/Beacon-Remote/pull/113) | Docs-only owner direction. Its historical security/control-plane checks failed. Reconcile it with the newer current roadmap; it contains no unattended implementation to recover.                         |
| [#105](https://github.com/builtbysai/Beacon-Remote/pull/105) | View-only MCP tools and protocol test. Historical checks passed, but the PR explicitly lacks live-session validation. Integration and full automation remain after the unattended milestone.              |
| [#106](https://github.com/builtbysai/Beacon-Remote/pull/106) | rtc 0.21.1 family lockfile update. Current development explicitly pins both rtc and webrtc at 0.21.0. Reconcile those coupled pins and APIs before adopting; the old lockfile diff alone is insufficient. |
| [#107](https://github.com/builtbysai/Beacon-Remote/pull/107) | uuid 1.28.0 lockfile update. Review against the current lock, resolve using Cargo and run affected native checks.                                                                                         |
| [#108](https://github.com/builtbysai/Beacon-Remote/pull/108) | serde_json 1.0.154 lockfile update. Review against current serialization consumers and native checks.                                                                                                     |
| [#109](https://github.com/builtbysai/Beacon-Remote/pull/109) | Pinned setup-java action from 6.0.1 to 6.1.0; keep immutable action pinning and verify the upstream tag before adopting.                                                                                  |
| [#110](https://github.com/builtbysai/Beacon-Remote/pull/110) | pg and @types/pg to 8.23.1. Re-resolve the current lock and run actual PostgreSQL regressions.                                                                                                            |
| [#111](https://github.com/builtbysai/Beacon-Remote/pull/111) | @fastify/websocket 11.3.4 plus fastify-plugin patch. Re-resolve current dependencies and check authenticated signaling/termination.                                                                       |
| [#112](https://github.com/builtbysai/Beacon-Remote/pull/112) | globals 17.13.0 tooling update. Re-resolve current dependencies and run lint.                                                                                                                             |

The dependency PRs' recorded security failures are historical default-branch
checks, not new audit results for `codex/unattended-access`. Their diffs predate
this branch's credential/toolchain/dependency changes; do not restore stale
lockfiles or infer that historical green native checks validate a new head.
This review did not adopt their dependency changes.

The current feature branch has 12 published commits after main, ending at
`8df0741b`, and no implementation PR. November 7 source edits are uncommitted
local development. The separate initial Windows sign-in endpoint, UI/transport
and secure desktop handoff remain unfinished; see [sign-in development](signin-authority.md).
The existing support chat/handoff feature should not be confused with that OS
desktop transition.
