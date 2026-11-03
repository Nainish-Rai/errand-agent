# Errand agent

A chat agent that books home services through a fixed set of mock provider tools. Approval is enforced in code, bookings happen exactly once, and memory is inspectable. Built for the Orange Invest founding AI engineer assignment.

- Spec: [SPEC.md](SPEC.md)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Design system: [design-system/DESIGN_SYSTEM.md](design-system/DESIGN_SYSTEM.md)
- Tickets: [.scratch/errand-agent/issues](.scratch/errand-agent/issues)

## Run it

Needs Node 24+ and pnpm 10.

```bash
pnpm install
MINIMAX_API_KEY="$(security find-generic-password -s errand-agent-minimax -w)" pnpm dev
pnpm eval
```

`pnpm dev` starts the backend (the eve server, http://localhost:3100) and the web chat (http://localhost:3000). It needs nothing but the MiniMax key. The dev script reads `MINIMAX_API_KEY` from the environment; the one-liner above reads it from the macOS Keychain for that one command. Don't put the key in a file. Store it once with `security add-generic-password -s errand-agent-minimax -a "$USER" -w`.

`pnpm eval` runs offline: a scripted model replaces MiniMax, so it needs no key and no network. It regenerates [docs/EVAL_TABLE.md](docs/EVAL_TABLE.md).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Backend and web app together |
| `pnpm dev:backend` / `pnpm dev:web` | One of them |
| `pnpm dev:tui` | Backend with eve's terminal chat UI |
| `pnpm eval` | Offline evals (`evals/`): scripted model and scripted user. Writes the eval table |
| `pnpm eval:replay` | Recorded live runs played back with no network |
| `pnpm eval:live` | MiniMax agent and a Claude Code simulated user, `ERRAND_EVAL_TRIALS` (default 3) trials each, with pass^k |
| `pnpm eval:record` | A live run that also saves each scenario's first trial to `evals/fixtures/recorded/` |
| `pnpm check` | Typecheck, layer rules (dependency-cruiser), unit tests and the observatory checks |
| `pnpm observatory` | Turns `traces/` into a single-file dashboard (`observatory/out/dashboard.html`) and prints its path. `--fixtures` adds the failure fixtures; `--claude-sessions` adds this repo's Claude Code build sessions, redacted |
| `pnpm smoke:search` | With the backend running: sends "find a plumber in Koramangala this week" through `packages/client` and checks that `search_providers` ran |
| `pnpm verify -- --run ID <command>` | Browser verification with `control-errand` (see below) |
| `pnpm verify:install-skill` | Links the `verify-errand` agent skill into `~/.claude/skills` |
| `pnpm smoke:claude-code` | Gets a structured answer from the Claude Code CLI provider (uses your local `claude` login) and prints the cost a trace records for it |

## Models

One setting, `ERRAND_MODELS`, picks the provider for each model role:

```bash
ERRAND_MODELS="main=scripted"                       # offline agent
ERRAND_MODELS="main=minimax,review_reader=minimax"  # MiniMax for everything
```

| Role | Default | Allowed |
|---|---|---|
| `main` (calls tools) | `minimax` | `minimax`, `scripted` |
| `review_reader` (no tools) | `claude-code` | `minimax`, `claude-code`, `scripted` |
| `user_simulator` (no tools) | `claude-code` | `minimax`, `claude-code`, `scripted` |

The Claude Code provider has no AI SDK tool calling, so it is refused for `main`.

**MiniMax:** `MiniMax-M3`, called directly through MiniMax's Anthropic-compatible API (`https://api.minimax.io/anthropic`) with `@ai-sdk/anthropic`; no AI Gateway. Price (standard tier, input ≤ 512k tokens): **$0.30 / 1M input, $1.20 / 1M output, $0.06 / 1M cache read**. Confirmed 2026-11-03 at <https://platform.minimax.io/docs/guides/pricing> and <https://platform.minimax.io/docs/api-reference/text-anthropic-api>. The numbers live in [src/adapters/tracing/prices.json](src/adapters/tracing/prices.json).

## Run traces

Every run writes `traces/<sessionId>.jsonl` (gitignored; set `ERRAND_TRACE_DIR` to move it). Each line is one span, written when it starts and again when it settles, with OpenTelemetry GenAI names: `invoke_agent` per turn, `agent.step` per model run, `chat <model>` per model call (tokens, latency, `errand.cost.usd`) and `execute_tool <name>` per tool call (arguments, result, latency, error). Phone numbers, emails and keys are removed before a line is written. MiniMax cost is estimated from [prices.json](src/adapters/tracing/prices.json); Claude Code CLI calls record the cost the CLI reports. Errand state transitions are written to the same file as `state_transition` events, attached to the tool call that made them. Every time on a trace (spans, events and the route's "now") comes from the wall clock, even when the evals pin `ERRAND_CLOCK_START`. `GET /api/v1/sessions/:id/trace` serves a trace, and the chat's side panel draws it as a live waterfall (agents-ui `trace-waterfall`) with the errand's states above it; it follows the chat's session from the first message and refetches on every session event.

## Browser verification

`control-errand` (`tools/verify/`) lets an agent prove a change in a real browser. Each run is an isolated, owned copy of the app: an APFS copy-on-write snapshot of the checkout (uncommitted edits included), its own backend and web on free ports (never 3000/3100), its own data and trace directories, and its own headless Chrome that can reach only those two ports. Commands drive the page by role, label, test id or text, never by injected JavaScript.

```bash
RUN=my-check-1
pnpm verify -- --run $RUN launch                                     # scripted models: no key, no network
pnpm verify -- --run $RUN doctor                                     # every check true, networkGuard included
pnpm verify -- --run $RUN suite verification/suites/chat-search.json --report html
pnpm verify -- --run $RUN api GET /api/v1/sessions/current/trace     # world state through packages/client
pnpm verify -- --run $RUN cleanup                                    # daemonExited: true, nothing left
```

`launch --live` uses MiniMax for the main model and reads the key from the Keychain (`errand-agent-minimax`) at launch only. Evidence (state, logs, `browser.jsonl`, screenshots, ARIA snapshots, the command journal and suite reports) stays in `~/.local/share/errand-verify/<run-id>/` after cleanup. Seed suites live in `verification/suites/`. The agent skill is [.claude/skills/verify-errand](.claude/skills/verify-errand/SKILL.md), with a [feature map](.claude/skills/verify-errand/features/README.md); every UI ticket ends with a verify-errand report. `pnpm verify -- --help` lists every command.

## Observability dashboard

`pnpm observatory` after `pnpm eval` (or after any local session) reads the run traces and writes one HTML file. It shows every session with its turns, model and tool spans, tokens, latency, errors, retries and cost (estimated for MiniMax, CLI-reported for Claude Code). `--traces <dir>` reads another run's trace directory. `--fixtures` adds two fixture sessions: a cancel that gets a 503 and is retried, and a book that times out after succeeding and is then verified. Real runs produce those sequences once tickets 07 and 10 land. `--claude-sessions` renders the Claude Code sessions that built this repo, with prompts cut to 10-word redacted snippets, then checks the HTML against the raw transcripts. The dashboard comes from [harness-observatory](https://github.com/Nainish-Rai/harness-observatory) (MIT). Generated files go to `observatory/out/`, which git ignores. See [observatory/README.md](observatory/README.md) for what changed from the original and which dashboard to commit for the submission.

## The errand

Every chat session has one errand (`src/core/errand/`): service, area, time window (dates, and optionally hours), budget and preferences. Service, area and time window are required; budget and preferences narrow the options but are never asked for.

- `update_errand` patches only the fields it names; a correction such as "actually Saturday" changes the time window and nothing else. It returns the errand, the fields still missing and `question`: the one or two fields the agent may ask about next, with quick replies the chat renders as suggestion chips.
- `search_providers` writes its service, area and dates to the errand, searches the world, and core drops every provider over budget or with no free slot in the time window before tagging two or three options Best match, Cheapest and Earliest.
- The workflow is an explicit state machine (`errand-workflow.ts`): `gathering → searching → choosing → holding → awaiting_approval → executing → verifying → done`, plus `failed` (reachable from every unfinished state, when a run fails) and `cancelled`. Ticket 04 drives the first three; any move the table doesn't allow is refused as an `illegal_transition` outcome. Every transition is a `state_transition` event in the run trace, and the trace panel lists them under "Errand states".
- `GET /api/v1/sessions/:id/errand` serves the errand. Errands live in memory for now, so a backend restart forgets them.

## Run budget and outcomes

Every run (one turn of the agent answering one message) has a budget: at most 16 model calls, 24 tool calls and 180 s by default (`src/core/budget/run-budget.ts`). eve has no caps of its own on these, so the main model is wrapped per run (`agent/agent.ts` resolves it with `defineDynamic`; the wrapper is `src/adapters/models/run-budget-gate.ts`):

- each model call is charged first; a run out of turns, past its deadline, or with a failed tool is not sent to the model;
- the tool calls a response asks for are admitted all together or not at all, and only when a model turn is left to read their results, so a call over the cap never reaches a tool. This covers every tool, whatever ticket adds it;
- a model call that keeps failing ends the run once its retries are spent.

Every tool is exported as `withRunBudget(defineTool({...}))` (`agent/lib/run-budget-tool.ts`; a unit test fails for a tool without it): a call still running at the run's deadline stops waiting, and a call that throws is recorded so the run ends `failed` instead of carrying on. The budget is in SQLite (`run_budgets`), so a restart keeps a run's counts and start time.

Every run ends in one typed outcome: `completed`, `needs_user`, `verifying`, `budget_exhausted` or `failed` (`src/core/budget/outcome.ts`). A stopped run answers with its outcome's message as the reply; a run that ends on its own takes its outcome from where it left the errand. Each outcome has one message, from `agent/lib/run-outcome-presenter.ts`. A `failed` run moves its errand to `failed`. The outcome is a `run_outcome` event in the run trace, and the global invariant "every run ends with a typed outcome" checks every scenario's trace for exactly one per run. The evals and browser checks tighten the limits with `PUT /api/v1/dev/run-limits` and make a world operation slow or throw with `PUT /api/v1/dev/world-fault` (dev only; a scenario switch resets both).

## Approval

The model can't book. It holds the chosen slot (`hold_slot`) and calls `propose_action`, and core (`src/core/approval/`) snapshots the world's hold, not the model's arguments, into a proposal whose fingerprint is SHA-256 over action, provider, slot, price and hold. The chat renders the fixed approval card (`apps/web/features/trust`) from `GET /api/v1/proposals/:id`: provider, time in IST, address, price, cancellation terms, the hold's countdown, and Approve ₹PRICE, Other options and Decline.

- **Approve** posts the card's fingerprint to `POST /api/v1/proposals/:id/approve`, the only place a grant is minted (dependency-cruiser rule `only-the-approve-route-mints-grants`). The person comes from the channel's auth context. Repeating it returns the same grant. The grant is single-use and expires with the hold or after five minutes, whichever is first. Then the card sends "I approved it on the card." and the agent calls `execute_proposal`.
- **`execute_proposal`** books only with an unused grant whose fingerprint matches. It uses the grant (atomically, once), calls `book` with the key `book:<grantId>`, and checks `get_booking_status` before it reports `booked` with the booking ID. A timeout the status can't settle is `verifying`, never booked or failed.
- **A typed "yes"** reaches `execute_proposal` too, which finds no grant, books nothing and hands the card back to be shown again.
- **Decline** (and Other options) calls `POST /api/v1/proposals/:id/decline`: nothing is booked, the hold is released, and the errand goes back to its options.

Proposals and grants live in SQLite (`src/adapters/sqlite/sqlite-proposal-store.ts`, migrations `0500_proposals` and `0501_grants`). `GET /api/v1/bookings` lists the world's bookings, each with the proposal and grant that made it. `GET /api/v1/proposals?status=pending` and `GET /api/v1/sessions/:id/proposals` list proposals.

## Layout

```
agent/            eve agent: agent.ts, instructions, tools/, channels/ (eve.ts = /eve/v1, app-api.ts = /api/v1), instrumentation/ (run trace)
src/core/         pure rules and ports (no eve, Zod, AI SDK)
src/adapters/     mock provider world (seeded, scenario-driven), models, tracing (JSONL sink, sanitiser, prices)
src/composition/  the only place adapters are constructed
packages/         contracts (Zod wire schemas), client (typed API + chat client, no React)
apps/web/         Next.js UI shell: assistant-ui bound to eve's useEveAgent; no API routes
evals/            eve evals; each one is a client of the backend
tools/verify/     control-errand: browser verification CLI and daemon (reaches the app only through the browser and packages/client)
verification/     seed suites for control-errand
.claude/skills/   verify-errand: the agent skill and its feature map
observatory/      run dashboard (from harness-observatory, MIT): analyzer, template, fixtures
```

The web app is a fork of eve's [`eve-chat-template`](https://github.com/vercel/eve/tree/main/apps/templates/eve-chat-template), stripped to local-development mode: no Slack, no Linear/Notion/Sentry connections, no Neon, no Upstash, no Vercel sign-in.

## Evals

Every scenario in `evals/scenarios/` runs in three modes, picked with `ERRAND_EVAL_MODE`, and is graded on the end state, never the wording (τ-bench style). The evals are clients: they drive `/eve/v1` and `/api/v1` through `packages/client`.

| Mode | Agent | User | Needs |
|---|---|---|---|
| `offline` (default, CI) | the scenario's scripted model turns | the scenario's scripted user | nothing |
| `replay` | a recording's model turns | the recording's user | a fixture in `evals/fixtures/recorded/` |
| `live` | MiniMax | a simulated user (Claude Code CLI, `user_simulator` role) with the scenario's goal | `MINIMAX_API_KEY`, a `claude` login |

```bash
pnpm eval                                                                                   # offline
MINIMAX_API_KEY="$(security find-generic-password -s errand-agent-minimax -w)" ERRAND_EVAL_TRIALS=2 pnpm eval:record scenarios/search/plumber-in-koramangala
pnpm eval:replay                                                                            # no key, no network
```

The evals pin the backend's clock with `ERRAND_CLOCK_START` (default `2026-11-04T09:00:00+05:30`; time still moves forward from there), so "this week", the seeded slots and every recording are the same on any day. The scripted model finds its step from the conversation (which user message, how many model responses since), fails loudly when the script runs out, and falls back to the ticket 01 search responder when no script is loaded. Scenarios run one at a time, because one backend holds one world and one loaded script.

After each run a custom eve reporter (`evals/reporter.ts`) writes `evals/results/<mode>.json` and regenerates [docs/EVAL_TABLE.md](docs/EVAL_TABLE.md): scenario, expected, actual, pass/fail and notes per mode, and pass^1 and pass^k (`C(c,k)/C(n,k)`) for live. Never edit the table by hand.

The global invariants from [SPEC.md](SPEC.md) run after every scenario. Until the ticket that builds a feature gives its invariant a `check` in `evals/invariants.ts`, it is recorded as pending, with no pass rule, so it never counts as passing.

**Add a scenario:** create `evals/scenarios/<area>/<name>.eval.ts` with `defineScenario` (see `evals/scenarios/approval/approve-click-reaches-the-api.eval.ts`). Give it the eval id of its path, the world (`scenario` and `seed`), the scripted user's steps (`{ say }`, `{ card: "approve" | "decline" | "other_options" }` to tap the latest approval card as the web app does, or a hand-made `{ approve: { proposalId, fingerprint } }` request), the scripted model turns, a goal for the simulated user, a one-line `expected`, and `expect(t, run)` asserting the end state. Record it with `pnpm eval:record <id>` so replay covers it.

## Mock world

`src/adapters/world` implements the assignment's eight tools (`search_providers`, `get_provider`, `hold_slot`, `book`, `get_booking_status`, `cancel`, `reschedule`, `list_bookings`) with their failure behaviour. Every outcome is a function of a seed and a named scenario (`default`, `happy_path`, `slot_taken`, `timeout_after_success`, `timeout_without_booking`, `price_changed_on_hold`, `reschedule_conflict`). Switch with `POST /api/v1/dev/scenario {"scenario":"…","seed":42}`; a switch also discards every proposal and grant, since they name the old world's holds. The agent sees `search_providers` (through the errand, see above) and `hold_slot`. It never sees `book`: only core's ExecuteProposal calls it, with a grant. The world also has a `releaseHold`, which is not one of the eight tools and which only core calls, when a proposal is declined.
