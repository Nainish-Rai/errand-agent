# Setup, launch and doctor

## Prerequisites

macOS (APFS for the copy-on-write snapshot; elsewhere it falls back to a full copy), Node 24,
pnpm 10, Google Chrome installed, and `pnpm install` done in the checkout under test (the snapshot
copies its `node_modules`). Nothing else: no Docker, no login, no database server.

## Launch

```sh
RUN=ticket-04-$(date +%H%M%S)                       # unique; 1-40 lowercase letters, digits, hyphens
pnpm -s verify --run "$RUN" launch                     # scripted models (default)
pnpm -s verify --run "$RUN" launch --live              # MiniMax for the main model
```

What launch does, in order (about 20-25 s measured on 2026-11-03):

1. Claims `~/.local/share/errand-verify/RUN/` (a run ID is used once; evidence is never shared).
2. Snapshots the checkout into `RUN/snapshot/` with `cp -c -R` — uncommitted edits and
   `node_modules` included; `.git`, `.scratch`, `.eve`, `traces`, `.next` and `.env*` excluded
   (about 12 s).
3. Picks two free localhost ports (never 3000 or 3100, which belong to `pnpm dev`), or takes
   `--backend-port N` / `--web-port N`.
4. Starts, in the snapshot, each in its own process group:
   - backend: `eve dev --no-ui --host 127.0.0.1 --port B`
   - web: `next dev --hostname 127.0.0.1 --port W`, with `NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:B`
   with the run's own `ERRAND_TRACE_DIR=RUN/traces` and `ERRAND_DATA_DIR=RUN/data`, telemetry off,
   and every inherited `ERRAND_*`, `NEXT_PUBLIC_*`, `MINIMAX_API_KEY` and `ANTHROPIC_API_KEY` removed.
5. Waits for `GET /api/v1/providers` through `packages/client` and for the web app to answer 200,
   and warms `/design`.
6. Opens the owned Chrome (headless; `--headed` to watch), a root context on `/`, and prints doctor.

## Identities

Ticket 19 made traces, context logs, token counts and costs operator-only. At launch the CLI makes a
fresh random `ERRAND_AUTH_SECRET` for the run, registers it with the redactor, and gives it and
`ERRAND_OPERATOR_IDS=verify-operator` to the backend only (never to the web app, a file or the
output). It mints two access tokens and keeps them in the daemon's memory:

| Who | User id | How to act as them |
| --- | --- | --- |
| the person (local dev) | `dev-user` | the browser; `api` with no `--as` |
| the dev operator | `verify-operator` | `api --as operator`; in the browser, `/ops` and `fill --label "Operator token" --value "{{operator-token}}"` |
| a second person | `verify-other-person` | `api --as other-person` (their sessions are not the person's: expect `--status 404`) |

The local-dev person is never an operator. To be an operator outside the CLI, see the README's
"Operator console" (`pnpm -s operator-token`).

The world lives in the backend process (an in-memory mock world for now), so each run has its own.
When a later ticket adds SQLite it reads `ERRAND_DATA_DIR`, which is already per run.

### Models and clock

| Launch | `ERRAND_MODELS` | Needs |
| --- | --- | --- |
| default | `main=scripted,review_reader=scripted,user_simulator=scripted` | nothing |
| `--live` | `main=minimax,review_reader=minimax,user_simulator=scripted` | the Keychain item `errand-agent-minimax` |
| `--models SETTING` | as given | whatever the setting needs |

The scripted main model answers any search with the ticket 01 search responder. `--live` reads
the key with `security find-generic-password -s errand-agent-minimax -w` at launch and passes it
only to the backend's environment; it is redacted from every log. Without the item, launch fails
(BLOCKED), it never falls back silently.

The clock is pinned like the evals (`ERRAND_CLOCK_START=2026-11-04T09:00:00+05:30`, time moves on
from there), so dates and seeded slots match on any day. `--clock system` or `--clock ISO` changes it.

`--theme dark|light` sets the root context's system color scheme (default dark).

## Doctor

```sh
pnpm -s verify --run "$RUN" doctor
```

All checks must be `true`:

| Check | Meaning |
| --- | --- |
| `ownedProcesses` | the backend and web processes the daemon started are alive |
| `ownedPorts` | every listener on the two ports is one of this run's processes |
| `sourceRevision`, `sourceDiff` | the checkout's revision and uncommitted diff still match the snapshot |
| `backendHealth` | `/api/v1` answers through `packages/client`, parsed against the contracts |
| `webReady` | the web app answers 200 |
| `browser` | the owned Chrome and the root page are alive |
| `networkGuard` | the guard is installed **and** a probe to `https://example.com/…` was aborted and logged as blocked |

`sourceRevision`/`sourceDiff` false means the checkout changed after launch (including a commit):
the run still verifies the old snapshot. Clean up and relaunch.

## Network guard (mandatory, no flag)

A driven browser reaches only its own run:

- every context routes every request; anything not on the run's two origins is aborted
  (`blockedbyclient`) and written to `browser.jsonl` as `network-guard-blocked`;
- Chrome's resolver maps every host except localhost/127.0.0.1 to NOTFOUND (covers WebSockets and
  Chrome's own background requests), and background networking is off;
- service workers are blocked, so nothing bypasses the route.

The doctor proves it on every run and in every suite scenario: the probe shows up in
`pnpm -s verify --run "$RUN" network` under `blocked` with `probe: true`. Any other blocked entry is a
finding: a suite scenario with one is FAIL. The backend's own calls (MiniMax in `--live`) are
server-side and not affected.
