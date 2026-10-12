# Approved design comparison — 2026-10-12

Reference: owner supplied `Beacon-Remote-Final-Package (3).zip`, inspected outside
the repository. Its desktop and mobile renders and source are the design target.
The browser blocked opening the local `file:` prototypes; interaction with those
static pages remains unverified. The actual production landing and local Vite
frontend were inspected in the browser. Production media remains disabled.

| Screen                     | Current implementation and next gap                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public landing             | Replaced the generic card with a responsive workspace-shaped React illustration labeled as example data. Added the desktop workspace action and a one-row mobile header with appearance, workspace and menu controls. The hero hierarchy now more closely follows the approved render. The lower access/support section still differs.                                           |
| Sign in                    | Centered card, lock mark, compact copy and inline password visibility now follow the reference. Authentication remains the real backend flow. Invitation-only setup remains explicit; recovery and MFA links cannot be exposed until implemented.                                                                                                                                |
| Downloads and enrollment   | Current page truthfully says no signed production installer exists. Reference has a full installer and pairing journey. Native installer, release metadata and pairing status APIs are dependencies.                                                                                                                                                                             |
| Workspace shell            | Desktop now has a 208px icon sidebar with a 72px collapsed state, active/hover/focus states and topbar appearance control. Phones and narrow landscape use bottom navigation with a More menu. Account identity and the remaining approved topbar details still need real data/design work.                                                                                      |
| Computers                  | Real API-backed inventory, pairing and inspector exist. Empty and filtered-no-result states are inside the inventory panel, with real device/online counts. Synthetic video testing is gone from the consumer row, and revocation is in the inspector with inline confirmation. Search/filter density and device detail layout need more work.                                   |
| Viewer                     | Real WebRTC viewing and diagnostics exist behind the media gate. The viewer now has a full-window canvas, compact toolbar, Fit/100% scale, full screen, connection panel, playback action when autoplay is blocked, and a clear Stop action. Live desktop and mobile visual QA requires an accepted media session; control and display selection require backend/native support. |
| Sessions, Assist, Activity | Sessions now has peer Active/Recent panels using real backend session states and an owner-authorized Stop action. Activity has the approved table hierarchy, real audit event filters and export of loaded rows. Assist still uses an honest unavailable state; guest support requires server/native authorization work.                                                         |
| Windows host               | Native consent and local Stop exist. Approved tray, pairing, active-state and control-approval interfaces need native implementation and hardware QA.                                                                                                                                                                                                                            |

Validation of this checkpoint: `pnpm check` passed formatting, ESLint, TypeScript
and builds after the final changes. Its PostgreSQL integration tests were skipped
because `TEST_DATABASE_URL` was not set; no database regression pass is claimed.
Browser visual
review covered desktop landing, 390px and 320px landing, dark mode, desktop and
390px sign-in. The 320px landing and 390px sign-in had no document overflow.
Password visibility was tested in both directions after moving the toggle out
of its label.

The latest GitHub Actions run 38174053285 did not start either job: GitHub
reported failed recent account payments or a spending limit. No hosted CI pass
is claimed. This checkpoint does not enable production media or change the
remaining real Windows/Android acceptance matrix.

## Authenticated workspace continuation

Chrome signed into a disposable account in Remote's isolated local development
database. Actual Computers and Settings routes, collapse/expand, the More menu,
page changes, pairing code issuance and Copy code were exercised. Visual review
covered 320px, 390px, landscape 844×390, 768px, 1024px and desktop, plus dark
theme. There was no document overflow at those widths. The 768px inventory
controls were tightened after review. Pairing now shows its real expiry and a
copy action; no host was paired for this UI test. `pnpm check` passed with
`TEST_DATABASE_URL` set to Remote's separate `_test` database: all ten backend
tests ran without skips, and format/lint/types/build passed. No native Windows
compilation or real desktop acceptance was claimed for this frontend change.

Docker Desktop initially failed to start with a Secrets Engine stale socket
error. Starting the installed Docker Desktop through Windows Explorer, rather
than as a direct child of the Codex shell, restored Engine 29.8.0 without
renaming or deleting Docker state. Remote local setup then passed; View's
containers and files were not changed. The known Windows process-context issue
is https://github.com/openai/codex/issues/52698.

## Viewer continuation

The viewer now waits up to eight seconds for a transient WebRTC disconnect to
recover, while immediately ending a failed connection. Closing the page sends a
best-effort stop request. The updated frontend passed TypeScript and a
production Vite build. Live frame presentation and mobile viewer layout remain
unverified because Remote's local development environment intentionally has
media disabled and there was no real accepted Windows sharing session.

## Sessions, activity and mobile public navigation

Sessions and Activity were rebuilt around existing authenticated APIs without
simulated events. The local development server has media disabled, so the Active
panel correctly reports unavailable and live Stop was not exercised. Activity's
filter and mobile navigation were exercised in Chrome with the local disposable
account; the account had no audit events, so populated rows and CSV export still
need a real event fixture. The compact public menu opened, dismissed with Escape,
and navigated to Security. Chrome review covered 320px and 390px phones,
844×390 landscape, 768px, 1024px, 1440px and 1920px widths, plus dark mode.
No horizontal document overflow was found at those widths. The public hero's
mobile actions were reduced to their content width to match the approved render.
`pnpm check` passed after these edits with `TEST_DATABASE_URL` pointed at Remote's
separate local PostgreSQL test database: formatting, lint, type checks, all ten
backend integration tests, and web/backend builds. Native Windows compilation
and a real desktop sharing session were not part of this UI checkpoint.
