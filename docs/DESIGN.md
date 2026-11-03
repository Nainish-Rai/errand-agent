# Design note

The errand agent books home services through eight mock provider tools. The model plans and talks. Core code (`src/core/`, with no eve, Zod or AI SDK) owns every rule that matters for money or trust. The README has the details; this page covers the decisions.

**Workflow state.** Each chat session has one errand, and its state machine lives in `src/core/errand/errand-workflow.ts`: `gathering → searching → choosing → holding → awaiting_approval → executing → verifying → done`, plus `failed` and `cancelled`. An allowed-moves table drives it, and any other move returns an `illegal_transition` outcome. Each transition is a `state_transition` trace event. No tool sets a state directly. Tools call core use cases, and only those use cases move the errand. So `executing`, `verifying` and `done` are reached only from the booking use cases, which need a grant.

**Approval is enforced on the server and bound to the card.** The model can't book: it has no `book`, `cancel` or `reschedule` tool. It holds a slot and calls `propose_action`. Core then snapshots the *world's* hold, not the model's arguments, into a proposal with a SHA-256 fingerprint over action, provider, slot, price and hold. A grant is minted only by `POST /api/v1/proposals/:id/approve`, with the card's fingerprint, for the person in the channel's auth context. A dependency-cruiser rule makes that route the only code that can mint one. Grants are single-use and expire with the hold or after five minutes. Before the grant is used, core re-reads the live hold. If the price, slot or provider changed, the grant is voided and a fresh card is shown. A typed "yes" finds no grant and books nothing.

**Idempotency and recovery.** Every `book` goes through an action ledger (SQLite `action_intents`). The intent is keyed `book:<grantId>`, so there is one per grant, and every state change is a compare-and-swap. `book`'s reply is never trusted. Core asks `get_booking_status` with the same key; after a timeout, it marks the intent `unknown` before reading the status. If the status shows a booking, the intent is confirmed and nothing is retried. If it shows nothing, `book` is re-sent with the same key, up to three attempts. If the result is still unknown, the outcome is `verifying`, never "booked" or "failed". A reconciler settles `pending` and `unknown` intents at startup and at the start of each turn. The mock world persists its own state and also enforces keys. Exactly-once is tested by a SIGKILL mid-`book` (`scenarios/booking/restart-mid-booking`).

Excerpt from the raw trace [`docs/traces/timeout-after-success.jsonl`](traces/timeout-after-success.jsonl): the offline eval `scenarios/booking/timeout-after-success-booked`, world `timeout_after_success`, seed 42. The lines are settled spans and events only (the `running` copies are dropped), projected with `jq -c 'select(.name|test("^ledger|execute_tool (book|get_booking_status|execute_proposal)$|executing")) | select(.status!="running") | {line: input_line_number, name, status, args: .attributes["gen_ai.tool.call.arguments"], result: .attributes["gen_ai.tool.call.result"].kind, attempts: .attributes["errand.ledger.attempts"]} | with_entries(select(.value!=null))'`:

```jsonc
{"line":49,"name":"ledger recorded → pending","attempts":0}       // intent written before the grant is used
{"line":50,"name":"ledger pending → pending","attempts":1}        // attempt counted before book is sent
{"line":52,"name":"execute_tool book","status":"error","args":{"hold_id":"hold_0001","idempotency_key":"book:grt_c380318bb4f8fb0677bf1a62"},"result":"timeout"}  // provider booked, reply lost
{"line":53,"name":"ledger pending → unknown","attempts":1}        // not failed: we don't know yet
{"line":55,"name":"execute_tool get_booking_status","status":"ok","args":{"idempotency_key":"book:grt_c380318bb4f8fb0677bf1a62"},"result":"booked"}  // same key: the booking exists
{"line":56,"name":"ledger unknown → confirmed","attempts":1}      // settled by the status check; no retry
{"line":57,"name":"awaiting_approval → executing"}
{"line":58,"name":"executing → done"}
{"line":59,"name":"execute_tool execute_proposal","status":"ok","args":{},"result":"booked"}  // one booking, bkg_0002
```

**Memory.** Facts are per person, in SQLite. A fact is `explicit` (the person said it) or `inferred` (the agent noticed it). An inferred fact stays `pending_confirmation` and is never used until the person confirms it. A correction supersedes the old fact; it never edits it, and a trigger refuses in-place changes. A forget writes a tombstone. Core refuses any write whose quote isn't in the person's own messages (`untrusted_source`), so tool output can't become memory. The facts that reach the model come from a pure filter-then-rank (`selectContext`), and each turn traces which facts were included or excluded, and why.

**Run budget.** Each run (one turn) is capped at 16 model calls, 24 tool calls and 180 s (`src/core/budget/run-budget.ts`). A gate around the main model enforces the caps, and the counts are stored in SQLite, so a restart keeps them. Tool calls in one response are admitted all together or not at all. Every run ends in one typed outcome: `completed`, `needs_user`, `verifying`, `budget_exhausted` or `failed`. One presenter maps each outcome to its message.

**Observability.** Every session writes `traces/<sessionId>.jsonl` with OpenTelemetry GenAI span names: `invoke_agent`, `chat <model>` (tokens, latency, cost), `execute_tool <name>`, and errand and ledger transitions. Each model call also gets its packed context, checked against a fixed 40,000-token budget. Traces, context logs and costs are for operators only. `/ops` lists the sessions, and `/ops/sessions/ID` shows the transcript beside the trace panel. Every other caller gets a 404, and every operator read is audited.

**The review reader.** The agent never reads a review. `get_provider_insight` sends the raw reviews to a separate reader model with no tools, and it must answer in a strict schema: sentiment, strength and complaint enums, plus a count of reviews that tried to give instructions. Core drops anything outside the schema and averages the stars in code, so only schema values reach the agent and the chat. The seven-variant injection campaign tests this, measured as an attack success rate in the evals. Reviews can still bias which provider is picked, but they can never approve (`docs/notes/review-reader-remaining-risk.md`).

**Trade-offs.**
- **Code over prompts for every guarantee.** Approval, exactly-once, memory trust and budgets hold even if the model misbehaves. The cost is more core code and a narrower model surface.
- **Status-check-then-retry** costs an extra provider call on every book. In return, a lost reply never makes a second booking.
- **`verifying` is a real state.** The person may wait for an update instead of getting a false "booked" or "failed".
- **SQLite and one backend process** keep the system simple and restart-safe. Errands live in memory, so a restart forgets an unfinished errand (the ledger and the world remember). Scaling out would mean a shared database and leases on the reconciler.
- **Polling for the home screen** (every 5 s) instead of server-sent events, which would need an event publisher across every use case.
- **Graded on end state, not wording.** The evals check world, ledger and trace state (τ-bench style), so a reworded reply doesn't fail them, and a reply that claims a booking that never happened does.
