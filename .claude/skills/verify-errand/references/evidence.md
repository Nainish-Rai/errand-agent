# Evidence

## What a run keeps

Everything stays in `~/.local/share/errand-verify/RUN/` (directories 700, files 600) and survives
cleanup:

| File | Holds |
| --- | --- |
| `state.json` | checkout, branch, revision, source digest, ports, URLs, models, clock, daemon and server PIDs, timings, cleanup result |
| `launch.json`, `launch-error.json` | launch options (no secrets); why a launch failed |
| `backend.log`, `web.log`, `daemon.log` | server and daemon output, keys and tokens redacted |
| `browser.jsonl` | the root page: actions (no typed values), console, page errors, every request's method + origin + path + status, failures, guard blocks; no query strings, no bodies |
| `*.png`, `*.txt` | requested screenshots and ARIA snapshots |
| `command-failure.json`, `failure-*.png` | the last failed command and the page when it failed |
| `commands/` | the journal: one start and end entry per command (name, status, timing, error) |
| `suite-FEATURE-…/` | `report.json`, `report.html`, and one directory per scenario with its own `browser.jsonl`, `doctor.json`, `result.json` and screenshots |
| `traces/` | the backend's run traces (`<sessionId>.jsonl`) |

```sh
pnpm -s verify --run "$RUN" screenshot after.png --viewport
pnpm -s verify --run "$RUN" screenshot moving.png --viewport --animations allow   # a frame mid-motion (default: animations settle first)
pnpm -s verify --run "$RUN" snapshot after.txt                       # ARIA tree of the page
pnpm -s verify --run "$RUN" network --method POST --path '/eve/v1/*'
pnpm -s verify --run "$RUN" network --status 500
pnpm -s verify --run "$RUN" logs --level error
pnpm -s verify --run "$RUN" history                                  # also after cleanup
```

## Proof standard

- Drive the real user path and capture the **settled** result: assert on what the person sees,
  then screenshot (suites do both automatically).
- Assert world state next to UI state when the change touches it (`api GET /api/v1/...`).
- A chat-reply check on `--live` proves the live model path only for that run; say which model.
- Report PASS / FAIL / BLOCKED / NOT RUN per sub-feature with the run ID, revision, the report
  paths, and what was not covered. Every run's world is disposable seed data.

## HTML reports

`suite FILE --report html` writes `report.html` beside `report.json`: source and scope, every
scenario's steps with what each proves, and every screenshot embedded (with its SHA-256). It is
self-contained: a strict Content-Security-Policy (`default-src 'none'; img-src data:`), nothing
loaded from anywhere. It refuses to write PASS when any scenario has no screenshot, refuses a
contradictory status, and never overwrites an earlier report. Open it locally.

## PR screenshots

Pick the settled-outcome screenshots that prove the change, inspect each for private data, copy
them to `docs/evidence/TICKET/` with names that say what they show, and embed them in the PR
body with a caption, status, run ID and revision. Never commit run directories, reports or traces.
