# Design note

The model plans and talks. Core code (`src/core/`, with no eve, Zod or AI SDK) owns every rule that touches money or trust.

**Workflow state.** One errand per chat, with an explicit state machine (`src/core/errand/errand-workflow.ts`): `gathering → searching → choosing → holding → awaiting_approval → executing → verifying → done`, plus `failed` and `cancelled`. An allowed-moves table drives it, and any other move is an `illegal_transition` outcome. Every move is a `state_transition` trace event. No tool sets a state directly. Only core use cases move the errand, and only the grant-holding booking use cases reach `executing`.

**Approval is enforced on the server and bound to the card.** The model has no `book`, `cancel` or `reschedule` tool. It holds a slot and calls `propose_action`. Core snapshots the *world's* hold, not the model's arguments, into a proposal fingerprinted with SHA-256 over action, provider, slot, price and hold. Only `POST /api/v1/proposals/:id/approve` mints a grant: it needs the card's fingerprint and takes the person from the auth context, and a dependency-cruiser rule keeps it the only minter. Grants are single-use and expire with the hold or after five minutes. Before a grant is used, core re-reads the live hold. A changed price, slot or provider voids the grant and puts a fresh card up. A typed "yes" finds no grant and books nothing.

**Idempotency and recovery.** Every `book` goes through an action ledger (SQLite `action_intents`). Intents are keyed `book:<grantId>`, so there is one per grant, and every change is a compare-and-swap. `book`'s reply is never trusted: core asks `get_booking_status` with the same key. After a timeout, the intent is marked `unknown` first. If the status shows a booking, the intent is confirmed with no retry. If it shows nothing, `book` is re-sent with the same key, up to three attempts. If the outcome is still unknown, it becomes `verifying`, never a guessed "booked" or "failed". A reconciler settles open intents at startup and at each turn. The mock world persists its state and enforces keys too. An eval SIGKILLs the backend mid-`book` and checks that exactly one booking remains (`scenarios/booking/restart-mid-booking`).

The excerpt below comes from [`docs/traces/timeout-after-success.jsonl`](traces/timeout-after-success.jsonl). It is offline eval `scenarios/booking/timeout-after-success-booked`, world `timeout_after_success`, seed 42. Only settled lines are shown, cut to a few fields with `jq`; `line` is the line in the raw file.

<!-- jq -c 'select(.name|test("^ledger|execute_tool (book|get_booking_status|execute_proposal)$|executing")) | select(.status!="running") | {line: input_line_number, name, status, args: .attributes["gen_ai.tool.call.arguments"], result: .attributes["gen_ai.tool.call.result"].kind, attempts: .attributes["errand.ledger.attempts"]} | with_entries(select(.value!=null))' docs/traces/timeout-after-success.jsonl -->

```jsonc
{"line":49,"name":"ledger recorded → pending","attempts":0}       // intent written before the grant is used
{"line":50,"name":"ledger pending → pending","attempts":1}        // attempt counted before book is sent
{"line":52,"name":"execute_tool book","status":"error","args":{"hold_id":"hold_0001","idempotency_key":"book:grt_c380318bb4f8fb0677bf1a62"},"result":"timeout"}  // provider booked, reply lost
{"line":53,"name":"ledger pending → unknown","attempts":1}        // not failed: we don't know yet
{"line":55,"name":"execute_tool get_booking_status","status":"ok","args":{"idempotency_key":"book:grt_c380318bb4f8fb0677bf1a62"},"result":"booked"}  // same key: it exists
{"line":56,"name":"ledger unknown → confirmed","attempts":1}      // settled by the status; no retry
{"line":57,"name":"awaiting_approval → executing"}
{"line":58,"name":"executing → done"}
{"line":59,"name":"execute_tool execute_proposal","status":"ok","args":{},"result":"booked"}  // one booking, bkg_0002
```

**Memory.** Facts are per person, in SQLite. A fact is `explicit` (the person said it) or `inferred` (pending until the person confirms it, and never used before then). A correction supersedes the old fact; a trigger refuses in-place edits. A forget leaves a tombstone. A write whose quote isn't in the person's own messages is refused as `untrusted_source`, so tool output never becomes memory. A pure filter-then-rank (`selectContext`) picks the facts each turn, and the turn traces what was included or excluded, and why.

**Run budget.** Each run is capped at 16 model calls, 24 tool calls and 180 s. A gate around the main model enforces the caps; the counts live in SQLite, so they survive a restart. A response's tool calls are admitted all together or not at all. Every run ends in one typed outcome (`completed`, `needs_user`, `verifying`, `budget_exhausted`, `failed`), and one presenter gives each outcome its message.

**Observability.** Each session writes `traces/<sessionId>.jsonl` with OpenTelemetry GenAI names (`invoke_agent`, `chat <model>` with tokens and cost, `execute_tool <name>`), plus errand and ledger transitions, and each model call's packed context against a 40,000-token cap. Only operators can see them: `/ops` lists sessions, and `/ops/sessions/ID` shows the transcript beside the trace. Anyone else gets 404, and every operator read is audited.

**The review reader.** The agent never reads a review. `get_provider_insight` hands the raw reviews to a separate, tool-less reader model, which must answer in a strict schema: sentiment, strength and complaint enums, and a count of instruction attempts. Core drops anything off-schema and averages the stars in code. The evals measure attack success rate on a seven-variant injection campaign. Remaining risk: reviews can bias which provider is picked, never approve (`docs/notes/review-reader-remaining-risk.md`).

**Trade-offs.**
- **Code, not prompts, for every guarantee.** These hold however the model behaves. The cost is more core code and fewer tools for the model.
- **Status check before any retry.** It costs one extra provider call per book, and a lost reply can never double-book.
- **`verifying` is a real state.** The person may wait for an update instead of getting a false answer.
- **SQLite and one backend process.** This is simple and restart-safe. Errands are in memory, so a restart drops an unfinished errand; the ledger and the world remember. Scaling out needs a shared database and a leased reconciler.
- **The home screen polls every 5 s** instead of using server-sent events, which would need an event publisher across every use case.
- **Evals grade the end state, not the wording.** They check world, ledger and trace state, so a reworded reply passes and a false "Booked" fails.
