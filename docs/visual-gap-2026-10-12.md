# Approved design comparison — 2026-10-12

Reference: owner supplied `Beacon-Remote-Final-Package (3).zip`, inspected outside
the repository. Its desktop and mobile renders and source are the design target.
The browser blocked opening the local `file:` prototypes; interaction with those
static pages remains unverified. The actual production landing and local Vite
frontend were inspected in the browser. Production media remains disabled.

| Screen                     | Current implementation and next gap                                                                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public landing             | Replaced the generic card with a responsive workspace-shaped React illustration labeled as example data. Added the desktop workspace action. The hero hierarchy now more closely follows the approved render. The lower access/support section and compact mobile header still differ. |
| Sign in                    | Centered card, lock mark, compact copy and inline password visibility now follow the reference. Authentication remains the real backend flow. Invitation-only setup remains explicit; recovery and MFA links cannot be exposed until implemented.                                      |
| Downloads and enrollment   | Current page truthfully says no signed production installer exists. Reference has a full installer and pairing journey. Native installer, release metadata and pairing status APIs are dependencies.                                                                                   |
| Workspace shell            | Existing 204px sidebar lacks the approved collapse/icon-only states, icons, density and mobile navigation. This is the next broad UI implementation slice.                                                                                                                             |
| Computers                  | Current API-backed inventory, pairing and inspector exist. Layout, contextual actions, filters and inline naming need reconciliation with the approved workspace. Keep synthetic test actions out of the primary consumer path.                                                        |
| Viewer                     | Real WebRTC viewing and diagnostics exist behind the media gate. Viewer layout, compact toolbar and mobile interaction need visual work; control and display selection require backend/native support.                                                                                 |
| Sessions, Assist, Activity | Existing screens use real data or honest unavailable states, but spacing/content hierarchy trails the approved workspace. Guest support requires server/native authorization work.                                                                                                     |
| Windows host               | Native consent and local Stop exist. Approved tray, pairing, active-state and control-approval interfaces need native implementation and hardware QA.                                                                                                                                  |

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
