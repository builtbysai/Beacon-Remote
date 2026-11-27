# 0063: Threat model for a SYSTEM session-attach service

Status: proposed November 27, 2026. A brief for the separate security review the owner required (see
[0051](0051-independent-sessions-native-versus-gateway.md) and the roadmap). Nothing here is built, and nothing in this
record approves writing the service.

## Why a SYSTEM service at all

Today Beacon runs as the signed-in user, plus a boot service and a sign-in worker that already hold limited machine
authority ([signin-authority.md](../signin-authority.md)). Attaching a viewer to _another_ user's existing session
(a disconnected or other-user console session) needs a process in that session. Only a SYSTEM-level component can obtain
that user's token and start the capture helper in their session. That is the single privilege this service would add.

## What it would do, and nothing more

One verb: start, and later stop, Beacon's own capture helper inside one named Windows session, for one approved viewer.
It captures no pixels, parses no media, speaks no network protocol and holds no Beacon account secret.

## Assets

- The target user's session and everything visible in it.
- The target user's token (a stolen token is that user's identity on the machine).
- The machine's own key and the owner's approval of which sessions may be attached.
- The integrity of the helper binary that will run as that user.

## Trust boundaries

1. **Caller to service.** Only Beacon's own per-user host process may ask. Any other local process, any user, and any
   remote party must be refused.
2. **Service to target session.** The service acts only on the session id the owner approved, and only for the lifetime
   of that approval.
3. **Service to helper.** The helper that starts is Beacon's signed binary at a fixed protected path, never a path or
   argument the caller supplies.

## Threats and the requirement each one creates

| Threat                                                                               | Requirement                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An unprivileged local user asks the service to attach to a session (confused deputy) | The control channel is a local pipe with an ACL for the installed host's own account and SYSTEM only, plus the caller's process path and signature checked on connect; no network listener in the SYSTEM process.     |
| A request names a different binary, arguments or working folder                      | The request carries only a session id and an approval reference. The helper path, arguments and environment are constants compiled into the service.                                                                  |
| The binary or its folder is replaced                                                 | Install under Program Files with an administrator-only ACL (as the boot service already does), verify the Authenticode signature of the helper and the pinned certificate before every launch, refuse reparse points. |
| Session id reuse or a swap between approval and launch (TOCTOU)                      | Bind the approval to the session id and its logon time; re-read both just before launching and refuse on any difference; approvals expire within minutes and are single use.                                          |
| The user token leaks or outlives the attach                                          | Use the token only to create the helper process, close it at once, never write it or pass it over the pipe, and run the helper in a kill-on-close job so stopping the service ends it.                                |
| The helper keeps running after revoke, Stop, crash or uninstall                      | The host's Stop and the service's own watchdog both end the job; service stop and uninstall end every helper; startup kills leftovers it owns.                                                                        |
| Attaching hides that someone is watching                                             | Keep the visible capture indicator and the target user's consent rules from [security.md](../security.md); an attach without the target user's approval is refused or limited to the owner's own sessions.            |
| Secure desktop, UAC or UIPI is bypassed along the way                                | No change: the helper never captures the secure desktop and never injects into a higher-integrity window; those limits are tested, not assumed.                                                                       |
| Logs or diagnostics reveal tokens, pixels or keystrokes                              | The service logs session ids, decisions and result codes only.                                                                                                                                                        |
| Denial of service by repeated requests                                               | One attach per session at a time, a short per-minute limit on the pipe, and failure closed: any error means no helper starts.                                                                                         |

## Decisions this record proposes for the review to confirm

1. The service is a separate small binary from the boot service, with its own name, so the sign-in worker's authority does
   not grow.
2. The verb set stays at start and stop for one session. No generic "run as user" call is ever added.
3. Attaching another _user's_ session needs that user's approval at the machine or a policy the owner set in advance;
   attaching the owner's own disconnected session needs the owner's approval only.
4. Failure is closed everywhere, and the first release is limited to one viewer and one session at a time.

## Evidence the review should ask for before any code ships

- A written walk through of every handle and token the service opens and when each closes.
- Tests that a non-owner process, a wrong-path caller, a swapped session id and a replaced helper binary are each
  refused, and that Stop, crash and uninstall leave no helper process.
- A device run on a Windows edition that supports more than one session, because the product does not claim
  simultaneous users until that is shown (0051).
- An external reviewer's sign-off recorded here before the service is installed on any real machine.

## Not decided

Licensing and edition support for multiple simultaneous users, and whether a gateway ever replaces this (0051).
