# Android mobile-network acceptance preparation

The owner supplied an Android viewer on T-Mobile mobile data on 2026-10-10.
The first requested step is synthetic video playback and local Stop, followed by
a fresh, explicitly approved primary-display session. Neither phone playback nor
desktop acceptance has been reported yet. This is a temporary milestone 4 test,
not a production media release or proof of Android compatibility.

## Prepared and verified

- Exact application/native release `b1c2ae488e3d42824c7fbc82aab967dc96c02287`
  passed local checks and Windows/control-plane CI run `38079747430`.
- Temporary origin `https://remote-test.builtbysai.com`, DNS-only A record to
  the existing Oracle VM, valid public HTTPS, health/readiness passed.
- Separate database `beacon_remote_acceptance_20261010` and non-superuser role
  `remote_acceptance_20261010` in the existing Remote PostgreSQL container.
  Public database CONNECT is revoked; migration/schema/role verification passed.
  A disposable account has a random password; credentials remain outside Git.
- Independent bounded containers `beacon-remote-acceptance-backend` and
  `beacon-remote-acceptance-web` use the existing private/edge Docker networks,
  unique DNS aliases and no published ports. No new VM, paid tier or database
  service. Backend lifetime is one hour with restart disabled.
- A separate Caddy product fragment routes only the test hostname. The shared
  config validated and reloaded; View and production Remote readiness passed.
- TURN uses patched shared Coturn with per-session REST credentials and forced
  relay policy. Production Remote media configuration remains disabled.
- Matching native binaries are in ignored `.agent-state/android-acceptance-b1c2ae4`.
  A separate user-DPAPI identity successfully enrolled over HTTPS. Browser sign-in
  displayed **Windows test PC — Online**. The host's default route is Wi-Fi.
  No desktop request or capture was started during setup.

## Live test operation and cleanup

The local host runner is `C:/Dev/beacon-remote-android-host.mjs`; its isolated state
is `C:/Users/Saiha/.beacon-remote-recovery/android-acceptance-20261010`.
Its maximum runtime is 45 minutes. An empty `STOP` file inside that exact state
directory stops only this fixture agent. Each media request still has the native
two-minute deadline, consent where applicable and visible local Stop control.
Do not approve desktop consent through automation or infer success from audit.

Oracle sources are under `/opt/beacon-remote/acceptance/20261010-b1c2ae4`.
Operational Compose is `/etc/beacon-remote/acceptance-compose-20261010.yaml`;
the protected environment and disposable account material remain under
`/etc/beacon-remote/`. Do not print or commit them.
The separate edge fragment is
`/etc/beacon/products/beacon-remote-acceptance.caddy`.

After the test, stop/remove only the two named acceptance containers, remove the
test edge fragment and validate/reload Caddy, then remove only the named acceptance
database/role and test credential files. Preserve production containers, databases,
original Caddy fragments, relay configuration and owner Windows identity. Verify
both production products afterward. Remove only this fixture's local identity once
its agent/helper have exited. Never use a broad process kill or volume deletion.

Record actual Android browser version, moving decoded frames, candidate route,
start latency, Stop behavior and reconnect/fresh-consent behavior. A synthetic
success is followed by a separate desktop request and does not complete the
desktop or sustained-performance gates by itself.
