# How Beacon Remote is tested

Five layers, cheapest first. A change needs the layers that can actually catch its risk, not all of them.

| Layer                 | What it proves                                                                                   | Where it runs                      | Command                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------- |
| Unit                  | Pure rules (protocol, deadlines, path safety, token parsing)                                     | CI, any computer                   | `cargo test --workspace`, `pnpm --filter @beacon-remote/web test`     |
| Backend integration   | Authorization, ownership, invitations, revocation, cleanup against a real PostgreSQL             | CI, any computer with a `_test` DB | `TEST_DATABASE_URL=… pnpm --filter @beacon-remote/backend test`       |
| Local fixture         | The real programs against a throwaway local server, in a signed-in Windows session               | A Windows desktop                  | `apps/backend/scripts/support-development.ts`, `input-development.ts` |
| **Device acceptance** | The whole journey on a real second computer: download, run, approve, break, resume, clean up     | Two Windows computers (or one)     | `node scripts/acceptance/support.mjs …` (below)                       |
| Manual checklist      | What only a person can judge: look and feel, SmartScreen wording, real network changes, hardware | A person with the devices          | `docs/acceptance-checklist.md`                                        |

CI cannot run the last three: they need a visible Windows desktop (consent windows are real windows), a signed installer,
and for the second device a second computer.

## Device acceptance

`scripts/acceptance/support.mjs` runs scenarios for temporary support (ADR 0038 to 0040). It plays both people:

- **Technician**, on the computer you run it from, through the product's own API (sign-in, support links, chat, ending).
- **The person being helped**, through `scripts/acceptance/Device-Support.ps1`, which downloads the support program
  the way the Downloads page does, runs it, answers its question, presses its buttons, types in its chat, kills it, and
  reports what is left on the computer (folder, processes, startup entry, downloaded file).

Scenarios (each starts clean and ends clean even if it fails): the person ends support; the technician ends support; the
window crashes and support comes back; everything is killed and the restart entry brings it back; the local time limit
passes; a connection request asks the person and a view link refuses control; chat reaches both sides.

### On one computer (a local fixture)

```bash
cd apps/backend && pnpm exec tsx scripts/support-development.ts      # leave running; writes .remote-dev/support-development/login.json
# build a support program with a payload folder (see docs/input-development.md), then:
node scripts/acceptance/support.mjs --login .remote-dev/support-development/login.json \
  --installer <path to the setup exe> --server http://127.0.0.1:3011
```

### With a second computer

1. On the second Windows computer: Settings, System, Optional features, add **OpenSSH Server**, start it, and sign in
   once from this computer so `ssh user@host` works with a key. Nothing else is installed there.
2. Make a test account on the server under test (or use the fixture) and put its sign-in in a git-ignored file:
   `{ "origin": "https://remote.builtbysai.com", "email": "…", "password": "…" }`. Two-step accounts are not supported by
   the runner; use a test account without it.
3. Run:

```bash
node scripts/acceptance/support.mjs --login .remote-dev/prod-test-login.json --device ssh:user@host
```

With no `--installer` it downloads exactly what the Downloads page offers, so the signed installer, the file name and the
real server are all in the test. Windows will still show whatever it shows for an untrusted publisher on that computer; the
runner never changes trust. Add `--scenario "<name>"` to run one.

### Adding a scenario

Add an entry to `scenarios` in `support.mjs`. Use `start()`, the `device(action, …)` helpers and `waitFor`, finish with
`expectClean`. Add a new device action to `Device-Support.ps1` only if a person would do something it cannot yet (it must stay
limited to Beacon Support's own folder, processes and startup entry). Keep each scenario short and independent.

## What is still manual

Looking at the screens, SmartScreen and certificate prompts, a real restart or sign-out (the runner only runs the stored
startup command), network changes, sleep and resume, UAC and the lock screen, and anything with a second monitor or a
different GPU. Those stay in `docs/acceptance-checklist.md`.
