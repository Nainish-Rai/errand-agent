---
name: verify-errand
description: Verify the errand agent (errand-agent repo) in a real browser with the control-errand CLI — an isolated copy-on-write snapshot with its own eve backend, Next web app, data and trace directories, and a network-guarded headless Chrome; drive by role, label, test id or text; prove outcomes with settled screenshots, assertions and API world state; run fresh-context suites with HTML reports; always clean up. Use whenever asked to verify, test in the browser, check the UI, prove it works, or accept a UI ticket (chat search, trace panel, /design and the theme, approval card, home, generated UI).
---

# Verify the errand agent in a browser

`control-errand` (`tools/verify/`) starts an owned, isolated copy of the app and drives it like a
person would. Every UI ticket ends with a verify-errand report. Read
[the feature map](features/README.md) and the changed feature first; a mapped feature is
**NOT RUN** until a run on the exact source proves it.

Run it from the checkout being verified (or pass `--repo PATH`):

```sh
pnpm -s verify --run RUN_ID <command> …     # -s keeps the output pure JSON; or node_modules/.bin/control-errand
```

## Read the needed reference

| Work | Read before acting |
| --- | --- |
| Launch, scripted vs `--live` models, ports, doctor, the network guard | [Setup](references/setup.md) |
| Commands, targets (role, label, test id, text), assertions, `locate`, `api` | [Driving](references/driving.md) |
| Suite files, fresh contexts, PASS / FAIL / BLOCKED, the seed suites | [Suites](references/suites.md) |
| What a run keeps, the proof standard, HTML reports, PR screenshots | [Evidence](references/evidence.md) — every verification |
| Cleanup, leak checks, orphaned daemons, a drive that went wrong | [Cleanup](references/cleanup.md) — every verification, on failure too |

## The verification loop

1. **Scope.** Find the changed feature in the [feature map](features/README.md). Record what you
   verify: `pnpm -s verify fingerprint` (checkout, branch, revision, source digest).
2. **Fresh run.** Launch a new, unique run ID against the current source and set a cleanup trap:
   `trap 'pnpm -s verify --run "$RUN" cleanup' EXIT`. A snapshot never sees later edits: after any
   source change (a commit included), clean up and launch a new run ID.
3. **Doctor.** Every check must be `true`, including `networkGuard`. Any `false` means BLOCKED:
   fix the environment, never the expectation.
4. **Drive.** Run the feature's suite with `--report html`. For a path no suite covers, drive it
   by hand (`locate` first, then the action, then an assertion), then add it to a suite.
5. **Prove the outcome**, not the click: a settled-result screenshot, a retrying assertion on what
   the person sees, and the world state through `api GET /api/v1/...` when the change touches it.
   A screenshot alone, an HTTP 200 or a model reply alone is not proof.
6. **Report** PASS / FAIL / BLOCKED / NOT RUN per sub-feature, with the run ID, revision, report
   paths and what was not covered. A FAIL keeps its report; never weaken a step to get PASS.
7. **Always clean up** — after failures too — and confirm `daemonExited: true`,
   `processesRemaining: []` and `portsListening: []`.
8. **Keep the map current.** When a ticket adds or changes UI, update
   [features/README.md](features/README.md) and add or extend a suite in `verification/suites/`.

## Rules

- Drive real user paths: buttons, typing, keys. There is no command that runs page JavaScript;
  never add one, and never read state out of the page in place of what a person sees.
- Prefer roles and accessible names, then labels, then test ids, then text. Add a `data-testid`
  to the app only when no role or name identifies the element, and keep that edit minimal.
- Scripted models by default (no key, no network). `--live` (MiniMax) only when the change needs a
  real model; the key comes from the Keychain at launch and is never written anywhere.
- Never commit run directories. Commit only reviewed screenshots (for a PR) to `docs/evidence/`.
- At most two runs at once on one machine (each is a backend, a Next dev server and a Chrome).

`pnpm -s verify --help` has the complete syntax. `pnpm verify:install-skill` links this skill into
`~/.claude/skills/verify-errand` (pointing at the main checkout, so it outlives worktrees).
