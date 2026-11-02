# 19: Browser verification for agents: `control-errand` CLI and `verify-errand` skill

**What to build:** An agent that changes the app can prove its change in a real browser, the way `control-netz` and the `verify-netz` skill do for Netz. `control-errand` starts an isolated, owned copy of the app and drives it. The copy is a copy-on-write snapshot of the checkout with its own backend and web ports, its own data and trace directories, and its own headless Chrome. Every launch's browser is network-guarded so it can reach only its own localhost ports. Commands drive the page by role, label, test id or text, never by injected JavaScript, and return evidence. Suites run each scenario in a fresh browser context and write an HTML report with screenshots. `cleanup` stops everything it started and proves it. The `verify-errand` skill tells an agent when and how to use it, and holds a feature map of what can be verified and how. From this ticket on, every UI ticket ends with a `verify-errand` report.

**Blocked by:** 01, 02, 03, 18 (all merged)

**Status:** ready-for-agent

- [x] `control-errand --run ID launch` snapshots the checkout, uncommitted edits included, and starts backend, web and Chrome on free ports, all owned by a daemon. Model selection: scripted by default (no key, no network); `--live` uses MiniMax, reading the key from the Keychain at runtime only
- [x] `doctor` reports owned processes, ports, an unchanged snapshot, backend health (`/api/v1`), web ready, and `networkGuard: true`. The guard is proven by a blocked request to a public host appearing as blocked in `network`
- [x] Driving: `goto`, `click`, `fill`, `type`, `key`, `hover`, `wait`, `text`, `count`, `assert` (text, value, count, attr, hidden, url; retrying to a timeout) and `locate` (match count, uniqueness, actionability, without acting). Targets are given by role and name, label, test id or text; `--theme dark|light` and `viewport` presets
- [x] Evidence: `screenshot`, `snapshot` (ARIA tree), `network` (filter by method, path or status), `logs` (console and page errors), and `api GET /api/v1/...` through the client package, so world state can be asserted next to UI state
- [x] `suite FILE.json [--report html]` runs scenarios in fresh contexts, each with its own steps, assertions and screenshots, and reports PASS, FAIL or BLOCKED per scenario, with a self-contained HTML report
- [x] Seed suites under `verification/suites/`: chat search (scripted model: providers render), trace panel (toggle shows the waterfall with model and tool spans), and `/design` (theme toggle persists across reload in both directions, approval card states render). All pass against main
- [x] Proof that it can fail: a planted wrong expectation makes the suite report FAIL with a screenshot of the failing state, then passes once reverted
- [x] `cleanup` stops the daemon, servers and Chrome, removes the snapshot, keeps evidence, and reports `daemonExited: true` with no owned process or port left. `history` lists command outcomes, including failures, after cleanup
- [x] The `verify-errand` skill is in the repo (`.claude/skills/verify-errand/`) with a feature map, the verification loop, evidence rules and cleanup rules; `pnpm verify:install-skill` links it into `~/.claude/skills`
- [x] Layer rules: nothing in the app imports the verification tool, and the tool reaches the app only through the browser and `packages/client`
