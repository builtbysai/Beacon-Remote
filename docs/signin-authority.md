# Windows sign-in authority development

Current November 10, 2026 checkpoint on `codex/unattended-access`. The backend authorization
boundary, protected native installation, scoped service/worker IPC lifecycle
and offline local disable/worker Disable UI are implemented in local source.
Guarded DXGI readback, native lease scopes and initial scoped input now exist.
Supervisor lease discovery/revalidation/delivery now exists in source.
Ephemeral worker public identity now crosses the authenticated lifecycle channel
and is attested by signed supervisor presence (migration 026).
Backend worker/browser signaling now exists behind the default-off authority
flag. An initial native worker-owned signaling client now has loopback evidence.
Initial native H.264/RTC and scoped input integration now exist in source.
Initial browser viewer/input UI now exists with synthetic RTC evidence.
Supported secure-attention requests and local Disable failure forwarding now
exist in source. Native/backend/browser handoff is now connected with synthetic
end-to-end evidence. Restart browser orchestration now enters the separate
sign-in viewer and fresh desktop handoff, with cancellation and narrow/short
viewport evidence. Setup/readiness, reliable Disable review and actual Windows
acceptance remain unfinished.
No positive SYSTEM/media acceptance
has exercised this path; readiness/public connectability remain false.
This is not full unattended access and is not a released feature.

## First device run (November 26, 2026)

The first run on a real computer (Windows 11 Home, high-DPI display, lab laptop, view-and-control standing access, the
boot service installed first) found these, all fixed in source on `windows/signin-screen-access`:

- **Which console counts.** After a reboot or a sign-out the console session is _Connected with nobody signed in_
  (`WTSConnected`, no user), not _Active and locked_. The supervisor only accepted the latter, so it never started a
  worker at a fresh sign-in screen. Both now count; an unlocked user session still does not.
- **Lock screen picture.** Right after a user locks, Windows shows the lock-screen picture on a desktop that is not the
  Winlogon desktop; Winlogon receives input only once the password prompt is up. The worker waits (its desktop check
  fails and the supervisor retries). A reboot or sign-out goes straight to the prompt. A future wake-on-request
  (bring up the password prompt when a viewer asks) would cover the locked case.
- **Launch.** The worker is a console program; started with a hidden console inside a job that forbids child processes
  it died with `0xC0000142` before running. It is now launched detached.
- **Known folders.** `SHGetKnownFolderPath` fails for the worker's restricted SYSTEM token in a user session. The
  supervisor now hands the worker the Program Files and ProgramData folders it resolved, and the worker falls back to
  those (it still verifies the folder's owner and permissions and the binary's hash). The default-path flag was
  rejected because it can return an unexpanded `%SystemDrive%`.
- **DPI.** The worker is not DPI-aware, so the output's desktop rectangle is scaled down; frames are not. The expected
  frame size now comes from the duplication's mode description and the snapshot uses the real surface size.
- **Diagnostics.** A worker cannot reliably write the normal logs, so a size-capped, de-duplicated log in the protected
  ProgramData folder records states and errors only (never grants, keys, pixels, input or credentials): supervisor
  heartbeats with the raw session values, worker steps, why a worker started draining, how it ended, and where the media
  runner stopped. A failing worker also reports its stage in its exit status.

- **Still screen.** Screen duplication delivers nothing while the sign-in screen does not change, so the one frame sent as
  the connection came up could be lost and the viewer showed no picture and gave up after 10 seconds. The worker now
  re-encodes the last image at the frame rate when there is no new frame, and the encoder's keyframe each second lets a
  viewer start showing it at once.

Result so far: at the sign-in screen after a reboot or sign-out the worker starts, the server reports the endpoint ready
and offers "Open sign-in" for the signed-out computer, the viewer connects, the picture of the real sign-in screen
streams at 25 frames per second (checked for over 20 seconds), and a click in the viewer wakes the lock screen to the PIN
prompt. Not yet accepted: typing a Windows password or PIN through the viewer (the person types it, never an agent),
secure attention, and a lock-screen wake-up without a viewer click.

## Configured connection readiness

Current source can opt into the integrated journey using both a Windows build
with Cargo feature `signin-media` and backend `SIGNIN_MEDIA_ENABLED=true`.
Backend sign-in authority, control and sessions, local owner control and separate
administrator-approved sign-in enrollment are still required. Defaults remain
off; this checkpoint changed no installed or hosted configuration.

Before Ready, the opted-in worker checks its real locked Winlogon console and
passively enumerates the primary DXGI output/interface and bounded geometry.
It creates no duplication, captures no pixels and initializes no encoder/input
adapter in preflight. Capture and input retain their live lease and connected
peer guards. The supervisor's readiness expires after one second without a
positive private probe; a failed probe clears it. Process/channel loss,
console change, retirement and local Disable cannot advertise Ready.

The backend advertises connectability only with the explicit media gate, fresh
signed worker identity, sign-in state and current standing owner-control policy.
Legacy presence cannot reserve media. The same gate covers reservation, renewal,
discovery/authorization, signaling and handoff. Heartbeat acknowledgement may
include `mediaEnabled`; only an explicit strict true permits discovery. A plain
legacy acknowledgement is presence-only, preserving compatibility without
implicitly enabling media. It is not itself a lease or input grant. Local status
reports build support separately; current worker availability is checked in the
authenticated workspace.

`Test-RemoteCi.ps1 -NativeOnly -SignInMedia` verifies the opted-in source variant;
omitting `-SignInMedia` verifies the default. Neither installs or changes rollout.
`beacon-remote-agent build-info` needs no enrollment and reports capability.
After source review/commit, `Build-DevelopmentHost.ps1 -SignInMedia -RequireSigning`
verifies that capability, writes feature metadata and uses distinct output names.
Its dirty-source/signing gates remain. No package was produced this checkpoint.

Readiness is an attempt gate, not evidence that SYSTEM capture, encoder/GPU,
Windows credential input or secure attention worked. Those require the designated
device, isolated matching backend, reviewed migrations, current backup and local
Windows consent. Do not resume the paused fixture merely because a candidate builds.

## Ordinary-host handoff boundary

Migration 027 adds verified ordinary-host console metadata and optional ordinary
session host pins. The native user host signs heartbeat canonical v3 with its
own instance and process session ID (1 through 4294967294); unavailable is signed
as `off`. It never copies the sign-in worker credential or assumes the active
console belongs to its user. Removing/changing the console field changes the
signature domain/bytes. Legacy v1/v2 presence clears stored console state.

The owner-only ordinary session route accepts
`hostContext:{instanceId,consoleSessionId}` with `source:desktop` and
`requirePolicy:true`. It requires current interactive readiness, exact reported
context and current standing owner policy, stores both pins on the new grant,
and checks them throughout its lifecycle. A context-changing signed heartbeat
ends prior pinned grants transactionally with audit; later restoration of old
values cannot revive them. This does not raise local permissions, substitute a
sign-in lease for ordinary authorization or change existing unpinned grants.

This boundary now participates in the integrated transition described below.
Native/session/console behavior still requires physical acceptance. Apply
027/028 and the compatible backend before
shipping hosts that emit canonical v3; downgrade those hosts before rolling the
backend back. Readiness/public connectability remain false.

The transition must prove worker media/input teardown and process
exit before ordinary admission, distinguish the same console's Windows unlock
from a crash/disconnect/console switch, and retain local Disable failure notices
during that final exchange. Bind any transition to the original owner browser,
lease/endpoint/policy versions and console with its own short expiry; a generic
transport close or ordinary inventory becoming online is not that proof.
Explicit browser Stop/cancellation, local Disable, account logout and policy
lowering must prevent handoff, including late proof/grant responses. A browser
that has already ended its intent must stop any late fresh ordinary grant.
These are implemented source invariants of the integrated path, with backend,
owned-process and synthetic browser evidence. They are not actual Windows
acceptance or evidence supplied by the host-console regression alone.

The worker's terminal retirement exchange now exists in native source. A fresh
`Retire` challenge receives pinned `Retired` media-cleanup/UI-thread completion
flags plus a final local Disable snapshot. The UI must be joined before a
positive snapshot; a stalled UI cannot confirm retirement. The supervisor
latches a reported Disable even if media cleanup failed, checks it before
relaunch/presence, and retries persistence after normal service shutdown has
retired the worker. Failed/unwritable storage is never reported as a durable save.

The worker immediately ends authority on desktop/UI/peer/expiry loss and only
retains a bounded draining lifecycle path. It cannot accept a new grant or secure
attention there. The supervisor requires a valid terminal acknowledgement and
successful process exit before its own forced job close to confirm retirement.
Missing/malformed acknowledgements, unfinished cleanup/UI, crash and forced/late
exit provide no positive handoff evidence. Retirement alone does not attest an
unlock, issue a backend transition or connect the ordinary desktop. The
integrated flow below consumes that evidence; no SYSTEM acceptance has run.

## Integrated handoff contract

After retirement, the service requires the same active console's WTS record to
report unlocked and have a logged-on user. The user name is checked only for
presence and is never sent in the proof. A 1.5-second bounded observation window
handles notifications arriving before that state. Cancel, local revoke and the
original machine-uptime lease deadline are checked again after the platform
query, immediately before signing. See Microsoft's
[WTS session state contract](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/ns-wtsapi32-wtsinfoex_level1_w).
This Windows 10+ path does not use the reversed Windows 7 flags.

The separately signed `beacon-remote:signin-handoff:v1` domain binds machine,
timestamp, fresh nonce, original lease/worker instance and console. The backend
accepts only the registered endpoint key, exact attested generation and current
owner/browser/standing control policy. The original lease must still be within
its expiry and absolute deadline. A transport close up to eight seconds before
the proof can be accepted because it is part of teardown; explicit Stop,
expired/interrupted/invalidated state cannot be upgraded to handoff. A second
proof cannot extend or reissue an accepted transition.

The one-use window is at most 30 seconds, bounded by the original browser and
absolute deadline. Status is available only to the original browser cookie.
It remains pending until the signed ordinary host reports the exact console
and ordinary interactive readiness. The browser then requests a fresh
`desktop:control` grant with `requirePolicy`, exact `hostContext` and
`signinLeaseId`. Admission rechecks and consumes the transition under the
machine-first lock. The child grant pins the host context and original browser;
initial viewer/relay admission rejects another cookie, and logout removes the
browser-bound child. There is no local-Allow fallback or SYSTEM grant reuse.

Transport loss ends local sign-in input/video immediately while this narrowly
scoped check runs. Stop/navigation cancels the transition, and late ordinary
responses are stopped. Successful transfer explicitly releases the old viewer's
cleanup ownership before opening the ordinary viewer. Stop of the original
lease also closes its issued ordinary child, even after consumption. Stop and
admission serialize on the machine; Stop's non-key-changing lock allows a
concurrent consent audit FK insert to finish without an inverse lock wait.

Migration 028 and matching server/browser/native source are required together.
Synthetic RTC walkthroughs establish the React transition and actual ordinary
video path, not Windows unlock or real capture/input. Public connectability
and native readiness remain false until intentional acceptance/rollout.

## Local settings and Disable propagation

The host header/tray opens the Windows sign-in settings as a page inside the host
window (Back returns), so no second window appears. The same view is available
standalone through `beacon-remote-host --sign-in-settings`; opening or refreshing
does not mutate service state. Setup/repair/re-enable require current local
owner control and the existing Windows administrator-approved installer. The
separate Repair service action updates protected files/configuration while
preserving local Disable and backend binding; it never raises access. Disable
and removal reuse the protected local stop/persistence paths. Service presence
is displayed separately from media readiness; it cannot make a connection ready.

The supervisor sends `/api/signin/disable` after a local Disable. Its strict
proof contains only version, machine ID, timestamp, nonce and signature under
`beacon-remote:signin-disable:v1`. The separately registered service key is
required; ordinary, presence and worker credentials cannot sign that purpose.
The route accepts only fresh one-use proofs and only lowers authority, even
when rollout is disabled. Under the shared machine lock it disables the endpoint,
invalidates leases/transitions and closes live ordinary child grants issued by
those transitions. It preserves unrelated ordinary permissions. Owner-browser
Disable and signed user unbinding share the same lower-only invalidation.

Local teardown/persistence confirmation never depends on network success. The
service retries failed remote invalidation after five seconds, with a three-
second request timeout, no redirects and a strict at-most-4096-byte positive
acknowledgement. A final Disable during service retirement is also forwarded
best-effort at shutdown, independently of disk-save success. The signed-in
owning user's local Disable additionally attempts signed unbinding after its
local operation, so a stopped service need not be started just to revoke remote
authority. Offline delivery and physical disk/service recovery remain acceptance
boundaries; neither network failure nor failed persistence permits relaunch.

## Supported secure attention

The viewer's Ctrl+Alt+Delete action uses `secure_attention` only in the distinct
sign-in input envelope. Ordinary desktop `Input` cannot deserialize this action.
It shares the input lane's strictly increasing positive sequence, releases
tracked held keys/buttons first and requires a live peer/lease/original desktop.
A single native mailbox expires at the earlier of five seconds and the original
lease deadline. It forwards at most once; renewal never extends that request.

On a fresh private Probe the worker may answer `SecureAttention`, binding the
challenge, pinned public key, instance, console, lease, sequence and absolute
uptime deadline. The supervisor checks those against the live worker and prior
authorization, schedules prompt heartbeat/lease revalidation and invokes the
request only after fresh backend authorization. Local disable/revoke, SCM stop,
console change, worker exit and the request deadline are checked again before
the API call. Duplicate sequences and arbitrary commands/fields are rejected.

Only the installed Session 0 service loads `sas.dll`, using System32-only lookup,
and calls Windows `SendSAS(FALSE)`. For session targeting it temporarily
impersonates the restricted SYSTEM token it created for its own fixed worker;
it never obtains a user's/process-selected token or changes desktop ACLs. An
existing thread impersonation prevents the call. Failure to revert the temporary
identity terminates the process rather than continuing network service under an
unexpected identity.

The 64-bit machine `SoftwareSASGeneration` DWORD must explicitly allow services
(1 or 3). Missing/unreadable/wrong-type/other values fail closed. This path and
the installer do not write or relax that Windows policy, enable UIAccess, change
UAC, emulate a key chord or change the Windows authentication requirement.
The Windows API returns void: `requested` means it was invoked, not that Windows
displayed or accepted anything. `policy-unavailable` and `unavailable` are also
returned against the exact lease and request sequence, with browser feedback,
a bounded pending state and cooldown. No Windows credentials or screen data
cross the private lifecycle pipe.

Native positive delivery/session targeting, supported Windows editions and
policy combinations, expiry/Stop during invocation and recovery require real
SYSTEM/device acceptance. Browser fixtures exercise synthetic RTC request/reply
bytes and rendered feedback only. Readiness remains false. See Microsoft's
[SendSAS contract](https://learn.microsoft.com/en-us/windows/win32/api/sas/nf-sas-sendsas),
[machine policy](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-admx-winlogon#softwaresasgeneration),
[token impersonation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-impersonateloggedonuser)
and [reversion failure requirement](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-reverttoself).

## Backend boundary

Migration 025 adds `signin_endpoints` and `signin_leases`. It follows additive
migrations 023/024. Migration 026 adds a nullable, length-bounded, uniquely indexed
ephemeral `worker_public_key`; it is not a private key or a transport grant.
All must precede the matching backend/clients. No production migration
or rollout was performed. The optional `SIGNIN_AUTHORITY_ENABLED=true` setting
requires enabled control and sessions; it is absent by default. It enables
authorization and signaling development routes, not readiness or an accepted
end-to-end media path.

The ordinary paired host signs `/api/agent/signin-binding` in a new signing
domain to register or remove a third, independent public key. Only the local
administrator setup may call that binding operation to raise
permission. Guest/support hosts cannot bind it. Rebinding invalidates readiness
and existing leases; the registry rejects ordinary-user and boot-presence keys.
Boot binding also refuses a sign-in key.

The separate key signs `/api/signin/heartbeat` with its process instance, active
nonzero console session, sign-in state and actual worker readiness. Every field
is signed. Timestamp checks, shared replay nonces and the machine row lock apply.
Presence expires after 15 seconds and never refreshes interactive presence.
Fresh sign-in presence suppresses ordinary desktop admission. A heartbeat never
returns commands, a desktop token, or a worker launch request.

### Worker identity for authenticated transport

Each native worker generates a fresh Ed25519 secret in zeroizing memory, after
its platform/UI guards. Only the public half is carried in Ready messages.
The supervisor pins that public key at the initial authenticated handshake and
requires the same value on every fresh challenge reply. It retains its own
separate machine key; neither private key is copied between the processes or
stored in a new plaintext file.

Native presence now includes `workerPublicKey` (a public key or explicit null).
That field selects canonical domain `signin-heartbeat:v2` while the envelope's
protocol version remains 1. The key/null `off` value is signed after readiness.
Legacy messages without the field retain the v1 canonical domain; removing a
field from a signed v2 message cannot downgrade the signature to v1. Signed-in
and unavailable states cannot carry a worker key; a v2 ready report cannot carry
null. Current native heartbeats still report readiness false.

The backend stores the attested key against the process/console binding.
Registered ordinary, boot and machine sign-in keys cannot substitute for the
worker key; boot/sign-in binding also refuses an attested worker key. A signed
key replacement or downgrade during the same active sign-in instance consumes
its nonce, ends leases and clears readiness, rather than silently replacing the
signer. A fresh instance may establish a new key; sign-in completion clears it.
Public-key substitution with an unchanged signature fails authentication and
does not refresh presence. Rebinding/disable clears the stored worker key.

Legacy development reservations still exist for registry compatibility, but no
legacy heartbeat supplies a worker transport credential. The new backend
signaling route requires this attested key plus a live exact-bound lease;
worker-signed authentication is implemented at the server and initial native
client. Its actual peer/media consumer is still missing. Public connectability remains false. Native
public-key parsing rejects noncanonical, malformed and weak keys.
The IPC schema has no private-key field and rejects additional Ready fields;
the production sender emits only verifying-key bytes.

Scoped authority and connection routes are:

| Route                                                   | Purpose                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /api/machines/:id/signin-authority`                | Inspect local authority/readiness; always reports `connectable:false` |
| `POST /api/machines/:id/signin-authority/disable`       | Lower standing sign-in authority; never raises it                     |
| `POST /api/machines/:id/signin-leases`                  | Reserve one short owner controller for endpoint development           |
| `POST /api/signin/leases/:id/renew`                     | Renew from the exact original live browser login                      |
| `POST /api/signin/leases/:id/stop`                      | End the reservation                                                   |
| `POST /api/signin/authorize`                            | Revalidate a fresh, separately signed endpoint proof                  |
| `POST /api/signin/pending`                              | Discover only a current lease ID using a separate signed proof        |
| `GET /api/signin/leases/:id/signal?role=viewer\|worker` | Upgrade only the exact owner browser or an attested worker proof      |

### Scoped signaling contract

The ordinary WebSocket plugin is reused, but sign-in has its own route, roles,
signature purpose and lease registry. Worker upgrades require
`Authorization: Beacon-SignIn <base64url(JSON proof)>`. The strict bounded proof
contains version, machine/lease/instance/console, timestamp, fresh UUID nonce and
signature, using `signinWorkerConnectMessage`'s distinct
`beacon-remote:signin-worker-connect:v1` domain. Only the currently attested
ephemeral worker key is accepted; machine/ordinary/boot signatures and the
service-authorization domain cannot substitute. Proofs are absent from URLs.
Workers send no browser cookie/Origin; viewers require the exact configured
Origin and original owner browser-token hash. A second login, helper or guest
cannot take over the reservation. Legacy keyless presence cannot connect.

Upgrades, renewal, Stop and teardown lock the machine before related rows to
avoid lease-versus-machine lock inversions. Upgrades consume
valid worker replay nonces and admit one socket per role. Every signaling frame
and a periodic guard recheck the common live-lease predicate and pinned public
key/context. The server also caches a conservative monotonic deadline before DB
round trips; blocked reads cannot postpone peer closure beyond that deadline.
WebSocket traffic and pong replies do not renew the lease; only the existing
owner HTTP renewal can do that. Native private-IPC authorization remains its own
mandatory authority gate.

Each peer receives scoped `ready` configuration before a `peer-ready` notice.
That notice means both signaling sockets are present, **not** that a WebRTC peer
or screen is connected. Only the worker can send the single offer and only the
viewer its answer; both may exchange bounded ICE candidates after pairing.
Strict messages reject unknown fields, binary frames, input/arbitrary commands,
capability additions and renewal requests. Initial waiting, heartbeat/pong,
frame-rate, pending-frame/byte, socket-buffer and total-entry bounds apply.
TURN credentials are bounded by the reservation's absolute/browser deadline;
they are relay credentials, never desktop permission. No SDP, proof, token,
private key, pixels or typed input is logged by this module.

Peer loss, protocol failure, expiry, logout, policy/worker changes or Stop close
both sockets and end/disarm the matching reservation/worker with an audit record.
Successful HTTP Stop and authority transitions also notify local signaling
entries; they do not depend solely on polling. Notifications target the exact
ended lease IDs, so a delayed callback cannot close a newer lease on the same
machine. Peer-close/WS-Stop teardown starts
before persistence. If that persistence/audit fails, sockets remain closed and a
bounded in-process tombstone prevents re-admitting the old reservation. Ordinary
session behavior and its separate token/capability namespace remain unchanged.

Tests use real loopback TCP WebSockets and disposable PostgreSQL schemas, with
synthetic SDP/candidates. They verify role/key/domain/browser isolation, replay,
startup ordering, offer/answer/ICE forwarding, Stop/disconnect/expiry/policy/
logout, binary/unknown/flood rejection, missing pongs, blocked DB reads and actual
audit-trigger failure. These are signaling tests, not decoded video, real input,
SYSTEM worker or cross-network acceptance. Actual encoder/RTC/input consumption
of the native signaling client, visible session state, browser viewer and handoff
remain open.

Discovery uses the distinct `signin-pending:v1` signing
domain and consumes replay nonces even when no lease matches. It returns only
`leaseId` or null, requires the current worker/console and all live-lease policy
checks, and never renews a reservation or authorizes media. A fresh separate
`/api/signin/authorize` proof is still required. Discovery responses are not cached.

Leases last at most 15 seconds, have a five-minute absolute ceiling, and cannot
outlive the browser session or fresh endpoint presence. They bind the machine
owner, exact browser token hash, ordinary standing-control policy version,
separate endpoint generation, process instance and console session. A different
login by the same owner cannot renew an existing lease. Helpers, guests and
other owners cannot acquire it. Files, clipboard, audio, recording and automation
are absent from this authority. Neither an ordinary session token nor a boot
signature can be exchanged for it.

Sign-in and ordinary controller admission serialize on the machine row and
check both sets of live reservations. Policy lowering, logout, expiry,
revocation, rebinding, instance/console changes and Windows sign-in invalidate
authority. Backend restart ends both kinds of persisted grants with their audit
records. Disconnect/revoke also end sign-in reservations. Audit failures roll
back binding, disabling, grant creation and explicit Stop.

## Native installation and worker lifecycle

The experimental `signin-setup` command requires ordinary local standing owner
control, then explicit Windows administrator setup. It creates a third Ed25519
identity protected by machine DPAPI and SYSTEM/Administrators-only file ACLs.
Neither the ordinary nor boot private identity is copied. The ordinary host
signs only the public-key binding. This command does not enable media.

Program Files contains a protected public manifest and immutable SHA-256-versioned
executables. ProgramData contains the separate private identity and exclusive
maintenance lock. File creation supplies final ownership/ACL atomically and
never replaces existing identity bytes. Repair validates the existing manifest,
binary hash, service command, LocalSystem identity and protected service descriptor
before mutation. New services start on-demand until hardening is verified, then
become automatic. Uninstall preflights a bounded nonrecursive list, rejects
unexpected content/reparse points and waits for the service process to exit.
It does not recursively delete installation roots or move installed identities.

The Session 0 SYSTEM supervisor launches only its own protected executable with
fixed worker arguments. It duplicates its own token, assigns the active locked
console session and removes enabled privileges before launch. It never opens
another process token. The fixed desktop is `winsta0\\Winlogon`; station/desktop
ACLs and Windows authentication stay unchanged. A kill-on-close job is attached
atomically through `PROC_THREAD_ATTRIBUTE_JOB_LIST`, before the primary thread
runs; child processes are restricted. Failure to place the worker in the job
fails launch, with no unbounded fallback.

The worker verifies its actual session, locked console, window station, Winlogon
desktop and input-desktop state. The supervisor requires a fresh UUID challenge
on every liveness probe. Session notifications and console changes discard the
old worker, and network/binding loss also closes it. The worker accepts scoped
authorization messages into an opaque local lease, but does not connect a peer
or start capture. The supervisor now discovers and separately revalidates grants
using fresh signed proofs and bounded HTTP responses before private IPC delivery.
It probes between network requests, rechecks local disable/session/cancellation
before delivery and closes the worker on exchange failure, lost active lease or
lease replacement. A fresh challenge after ordered delivery confirms worker
processing, not capture/input readiness. Authorization expiry is anchored before
the request, so network and IPC delay consume its lifetime. No endpoint private
key or browser credential crosses the pipe.
Heartbeats always report `workerReady:false`, regardless of IPC liveness.

Real NTFS/private-pipe fixtures exercise protected immutable files, maintenance
exclusion and channel failures. A suspended current-user Windows process fixture
checks atomic job membership and termination without resuming its primary thread.
No actual SYSTEM service/cross-session worker has been installed or launched;
these fixtures cannot establish secure-desktop, reboot or uninstall acceptance.

### Offline local disable

`signin-disable` needs no backend connection or administrator prompt. The
protected SCM descriptor grants interactive logons only the user-defined control
right in addition to existing read/query rights. Control 128 requests disable;
129 confirms it. Every other custom code is rejected. These controls accept no
payload, path, desktop or enable operation. They do not grant start, stop,
configuration, delete or descriptor-write rights. Actual Windows Authz checks
exercise interactive, network, ordinary built-in-user, SYSTEM and administrator
roles without installing a service or depending on the runner's logon type.

The SCM handler only updates atomic state. On its next supervisor iteration,
the service removes the worker or verifies authenticated, permanently stopped
media before writing and flushing a protected
`disabled.latch` alongside its public manifest. Confirmation succeeds only
after teardown and successful persistence. A timeout/write failure is reported
as unconfirmed; in-memory disable stays set and persistence is retried without
network access or relaunch. Any existing/incomplete/unexpected latch blocks
worker startup on restart. Corruption is preserved rather than interpreted as
permission to enable.

Explicit administrator setup creates a protected, non-secret `enabled.marker`.
Interactive users can delete that file, but cannot write it, change its ACL or
recreate it in the protected parent directory. `signin-disable` removes it first,
so a stopped or absent supervisor is no longer an obstacle to persistent local
disable. A missing marker blocks worker startup. Ordinary repair never recreates
it; explicit administrator enable is required. SCM confirmation still proves
teardown when the service is running. If marker deletion fails, the SCM request
can still stop the worker and persist the secondary latch; only that successful
confirmation can acknowledge disable. Other failures remain unconfirmed.
Windows Authz checks also verify the marker's
delete-only right, denied sibling deletion and denied parent file creation.

Lowering ordinary local control invokes this disable before the policy POST.
Forget/uninstall also attempt disable before network waits or administrator
prompts. Ordinary `signin-install` repair preserves the latch. Explicit local
`signin-setup` uses the administrator-only enable path, which stops the existing
service/process before validating/clearing the latch and recreating the enable marker. It still needs an
ordinary host's fresh signed public binding. `signin-status` reports
`locallyDisabled`; `mediaReady` remains false. Current fixtures cover restart,
confirmation ordering, failed writes and corrupt state, not actual SCM control
delivery or physical Stop.

The scoped worker now creates a topmost native Disable window on its own verified
sign-in desktop before acknowledging Ready. Both Disable and closing the window
remove the enable marker; a failed save leaves a retry control visible and a
stop-request flag set. The UI's timer rechecks desktop validity and closes on
worker teardown without changing standing permission. Indicator closure ends
worker readiness. It currently states that screen sharing is unavailable;
controller identity and immediate capture/input teardown must be wired when the
lease/media adapters exist. Ordinary identities/desktops cannot create these
controls. A hidden ordinary-window fixture checks Close/Disable failure handling
and owned teardown; it cannot establish secure-desktop rendering or input.
No actual SYSTEM UI has been opened or visually accepted; desktop
placement, keyboard/mouse operation, DPI and failure feedback remain device gates.

Explicit Disable now has a separate one-way flag from incidental UI loss. If
marker deletion fails, the worker remains unable to authorize media and reports
`LocalDisable` on a fresh private probe, bound to the pinned key/instance/console.
Pending and confirmed cleanup are distinct; the service latches the request
before any further authorization. Repeated pending reports cannot extend the
four-second cleanup grace. After confirmed media cleanup a responsive worker
may retain its Retry window while service persistence is retried; a stalled or
unconfirmed worker is removed. The service confirms only a successful durable
flush, never mere receipt of the notice. A later Ready cannot undo the request.
Stop during an authorization/controller-label wait is handled as local Disable,
not as a recoverable media crash. The worker ignores later authorizations.

These are source/pipe/hidden-window regressions, not an actual SYSTEM service
failure drill. If storage remains unwritable, no saved revoke is claimed; the
in-memory supervisor latch alone cannot promise persistence across simultaneous
process loss/reboot. Stalled pipe/storage may also end the Retry window through
bounded teardown. Real failure/recovery feedback still needs device acceptance.

## Native work still required

The native endpoint must not treat this registry or a green backend check as
permission to capture. Complete all of the following before enabling a viewer:

1. Connect controller identity and the worker Disable flag to immediate active
   capture/input/lease teardown; validate the actual visible control on the
   designated sign-in desktop. Source/UI guards are not physical Stop acceptance.
2. Validate the new DXGI rotation/cursor handling and integrate the capture source;
   integrate the new scoped input adapter, visible controller
   identity/Stop, monotonic short-lease enforcement, cached-frame discard and
   held-input release on every teardown path. Ordinary WGC/input secure-desktop
   rejection must stay intact. No Windows credentials or pixels in logs/files.
3. Validate the source lease discovery/revalidation/delivery on the designated
   SYSTEM service/worker boundary, including network loss, expiry and local Stop.
   Source regressions and loopback HTTP do not prove cross-session delivery.
4. Authenticated peer transport and browser sign-in UI, then worker termination
   at sign-in and fresh ordinary-user authorization. Never preserve SYSTEM
   authority across a desktop/user handoff.

### Cross-session channel correction

ADR 0048's proposed inherited channel cannot be used directly from a Session 0
service to a worker in another session: Microsoft explicitly prohibits
cross-session handle inheritance in `CreateProcessAsUserW`. A replacement must
preserve the intended private-channel boundary. `windows-agent::signin_ipc`
implements a local-only, single-instance message pipe with a SYSTEM-only ACL,
remote clients rejected, an unpredictable name and no inherited handles. It
verifies the peer's actual PID against a held process handle, process liveness,
SYSTEM token and expected session before exchanging messages. The worker-side
connection requires the service in Session 0; the service-side connection
requires a nonzero console worker session. The pipe name is not authentication.

Only typed Ready/LocalDisable/Probe/Authorization/Stop/Stopped messages are accepted. Message size,
lease duration, controller text and console identifiers are bounded; role errors,
unknown fields and I/O failures permanently close the channel. I/O cancellation
drains pending operations before releasing their buffers/events. Client security
QoS prevents the server from impersonating the client's token. Credentials,
pixels, arbitrary commands, executable paths and input contents have no message
variant and cannot be sent through this API.

Development checks exercise real local Windows named pipes, peer PID/session
queries, role/framing restrictions, timeout cancellation and ordinary-user denial
of SYSTEM-channel creation. Their current-user fixture ACL is private to tests;
the public production factory always requires SYSTEM. A real SYSTEM service and
cross-session worker have not been launched or accepted. Actual desktop switches
and teardown still require device acceptance. Do not fall back to a
public pipe or a general command endpoint.

### Initial capture and native lease scope

`signin_scope` binds one lease, worker instance and console. IPC authorization
carries an absolute `expires_at_tick` in the Windows precise interrupt clock's
100-nanosecond units. The strict backend-reply decoder checks the proof's exact
scope/lease/instance/console, forbidden capabilities and bounded lifetime, and
anchors expiry before the HTTP request. Network delay and later IPC delivery
therefore consume the same lifetime. Wall time never starts a replacement timer.
Renewal cannot change identity/console, revive an expired scope or undo Stop.
Worker-loop teardown ends authority even if a capture clone still exists.

Capture requires a separate peer-connected gate, live lease, SYSTEM identity,
current sign-in desktop and the UI Stop flag. The primary-output DXGI source
selects that output's actual adapter, uses nonblocking Acquire/Map, bounds GPU
readback size/stride and strips padding into memory-only BGRA. Acquired frames
and mappings have owned cleanup; release/access-loss/layout/authority failures
end the scope and discard source resources. Authorization is checked before
graphics initialization and again before a copied frame is returned. The
initial native media runner now rechecks scope before encoding/sending and
discards queued frames on revoke. Positive SYSTEM/GPU/transport acceptance is
still unfinished.

This source normalizes all four output rotations, caches pointer updates and
composes bounded color, masked-color and monochrome shapes after rotation.
Cursor position is already in desktop coordinates; HotSpot is not subtracted.
Pointer/frame dimensions, masks and clipping are validated before indexing.
The source is not started by the current worker. No actual DXGI
duplication or input injection has run. Current regressions cover delayed/replayed
authority, exact scope matching, Stop/owner teardown, missing-peer rejection and
bounded padded-row copying using synthetic bytes. These do not prove real GPU,
rotation, cursor, secure-desktop or network acceptance. `workerReady` and public
connectability remain false.

### Initial native signaling client

`signin_signaling` runs on an owned worker thread and receives the ephemeral
worker signer once, on the first authorized scope. Its fixed worker-role upgrade
uses the separate worker-connect signing domain, exact lease/instance/console,
fresh timestamp/nonce and protected server configuration. The key is dropped
after a successful handshake; there is no reconnect or alternate-key fallback.
HTTPS uses normal certificate validation; plaintext is limited to loopback.

Ready metadata is bound to the worker scope/public key, forbids unrelated
capabilities and validates bounded ICE configuration. Ordered negotiation,
bounded message/frame/queue/traffic limits, ping/pong and silence deadlines fail
closed. Scope/platform/Stop is checked around network operations. Networking
cannot block private service IPC; Drop stops authority before its bounded join,
and process/job teardown owns a stuck DNS resolver. Pending signaling is
discarded on teardown. Nothing here sets the media peer-connected flag.

Real loopback fixtures independently verify the proof signature/domain and
header shape, offer/answer/ICE and ping/pong, scope-Stop closure and wrong-scope/
binary-message teardown. Ordinary user/platform denial is also checked. These
are signaling regressions only. The worker now consumes these events through
an initial separate native media runner. There is no positive SYSTEM/media/device
acceptance, and readiness/connectability stay false.

### Initial native media runner

`signin_media` negotiates H.264 send-only video and one ordered input lane.
Only actual RTC Connected may call the scope's peer-connected transition; peer
loss immediately ends that scope rather than recovering a privileged peer.
Unexpected remote tracks/channels also end it. The encoder/NV12 modules are
shared with the ordinary helper through the session library; capture/input and
grant authorization remain separate. The worker starts guarded DXGI/encoding
only after peer/lease/platform checks. Conversion/encoding/queue/send recheck
authority, packet queues are bounded, owned buffers are zeroized on discard and
pending RTC operations are cancellable on scope loss. Close transport before
waiting for input cleanup. Owned process/job teardown bounds a stalled codec.

The initial 1280x720/25fps stream composites the cursor once. Input geometry
reports original physical dimensions plus encoded dimensions so the browser can
map letterboxing correctly. SCTP messages are capped at 4 KiB, receive storage
at 64 KiB and input traffic at 500/s. Only the scoped native input decoder may
receive messages; clipboard/files/audio/recording/automation remain absent.
Stop acknowledgement requires confirmed input cleanup and completed media/video
threads; a timeout, panic or a desktop where release is forbidden cannot be
reported as successful cleanup. The selected native RTC path supports UDP TURN;
TCP/TLS configuration is rejected. Adaptive sign-in quality, native/browser acceptance,
supported secure attention and fresh ordinary-host handoff remain open.

Current checks establish missing-peer denial and cancellable operations, plus
the real RTC offer shape and input-byte exchange between two peers on loopback.
Candidate mapping supplies the video m-line when the SDK omits a usable mid.
They do not establish actual SYSTEM screen
capture, OS input, GPU behavior, browser decoding or direct/relay acceptance.

### Browser lease lifecycle foundation

The browser now has a separate `SignInLease` lifecycle and strict shared HTTP
response schemas. It anchors expiry before each request, clamps accepted lifetime
to 15 seconds and retains the original five-minute monotonic/wall-clock cap.
Latency consumes that budget. Renewals are serialized, timeout/invalid metadata
ends the context, and late replies cannot revive it. Stop first notifies local
teardown and aborts pending work, then makes a bounded best-effort authenticated
Stop POST. Navigation cancellation and malformed known reservations also attempt
cleanup; a lost response with no known lease ID relies on server/native expiry.
No reservation/cookie is persisted in local storage or placed in a bearer URL.

The browser viewer now consumes this lifecycle with a 100ms expiry/renewal poll,
strict ready/peer/SDP/ICE validation, bounded serial signaling and cancellable
async operations. Its dedicated input lane uses exact lease/instance/console
geometry and positive sequences, with shared physical-pixel/letterbox mapping.
Clipboard and Android navigation are excluded. Stop/page loss/peer loss clear
media/input immediately; there is no reload/reconnect authority. The app isolates
the sign-in attempt from ordinary-view resume and aborts it on navigation/logout.

The inspector entry respects owner readiness/connectability; real backend and
native rollout gates remain false. `apps/web/test-browser/signin.mjs` runs the
actual React viewer against a synthetic loopback API/RTC canvas producer, sends
pointer/key bytes, checks clipboard exclusion and verifies Stop/layout behavior.
It is not a production-authentication, native-capture or OS-input acceptance run.
Run after `Enter-Workspace.ps1` with `CHROME_PATH` pointing to an existing Chrome/
Chromium binary; it creates its own loopback server/browser and no real account.
Computer restart entry, fresh ordinary-host handoff and positive SYSTEM/device
acceptance remain unfinished. Public connectability stays false.

### Initial scoped input source

`signin_input` consumes a private input-lane envelope containing `version:1`,
`scope:"windows:sign-in"`, `leaseId`, `instanceId`, `consoleSessionId`, increasing
`sequence` and the shared typed `input`. The envelope is bounded to 4 KiB and
rejects unknown fields, other scopes/versions and replayed sequences. It matches
the existing opaque scope before any input; ClipboardRead is always rejected.
Parsed text/message ownership has zeroizing cleanup and no input-bearing Debug
or diagnostic output. Existing text/scan-code limits remain unchanged.

The OS adapter starts only after the peer/lease/platform gates. It queries the
primary monitor in a restored per-thread physical-DPI context, binds monitor,
virtual geometry and orientation, and rejects changes or out-of-range points.
Key/button/Unicode state is recorded before sending; failures end authority and
retain only cleanup ownership. Every fresh event checks the live scope, and
every cleanup send rechecks the original permitted sign-in desktop. Cleanup
never sends a new down or moves into another desktop, session or UAC prompt.

An independent watchdog releases idle held state after 1.5 seconds without input,
ends a silent input lane after 30 seconds and observes lease/peer/Stop loss without
waiting for a new packet. Cleanup retries are bounded to three seconds. A
successful cleanup flag requires an ended scope with no tracked state left;
failed/blocked cleanup stays unconfirmed. It is not proof of physical keyboard
state or successful Windows login. Future handoff must preserve that distinction.
The supervisor now allows the owned worker a bounded cleanup grace before job
termination. Unexpected Disable-window hide/destruction latches the current
scope's Stop signal; this does not itself change standing permission.

Current regression sinks record synthetic events only. They cover idle/expiry,
partial Unicode/down failure, replay, rejected clipboard, orientation changes,
cross-desktop cleanup denial and absolute-coordinate bounds. The actual OS
constructor is tested only for missing-peer rejection; no SendInput call or
positive SYSTEM/secure-desktop cleanup has run. Transport, visible controller
identity, actual cleanup acknowledgement and supported secure-attention handling
remain integration/acceptance work. The initial media runner now starts this
adapter only after peer connection, but no positive SYSTEM injection has run.

Microsoft references: [CreateProcessAsUserW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw),
[interactive services](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services),
[DXGI DuplicateOutput](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutput1-duplicateoutput),
[named-pipe security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights).
The expiry clock is [QueryInterruptTimePrecise](https://learn.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-queryinterrupttimeprecise),
not an elapsed-awake-time counter.

Development regressions use disposable PostgreSQL schemas, signed identities,
real account/browser boundaries, console/process transitions, expiry, policy
versions and audit rollback. They establish no Windows service, capture/input,
reboot, cross-network or handoff acceptance. Device testing remains paused at
the owner's request until development is ready.
