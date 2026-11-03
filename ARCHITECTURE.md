# Architecture: one backend, any client

The errand agent runs as **one backend process: the eve server**. Web, mobile, the eval harness and
scripts are all just clients of it. No business rule lives in a client.

## Services (runtime)

| Service | What it is | Port (dev) | Talks to |
|---|---|---|---|
| **backend** | The eve server. It hosts the agent, the chat API, the app API, live events and images. The mock provider world runs inside it, behind a port. | 3100 | SQLite file, MiniMax, Claude Code CLI |
| **web** | Next.js UI shell: home screen, chat, trace panel. No API routes and no business logic. | 3000 | backend only |
| **mobile** (later) | Expo app, same screens. Not built for the assignment. | — | backend only |

The backend serves these surfaces on one origin, with CORS enabled for the web and mobile origins:

- **`/eve/v1/*`** is eve's built-in chat API: sessions, messages, the event stream and answers. Web uses
  `useEveAgent`. Mobile and evals use the eve TypeScript client, which is plain `fetch` with no browser APIs.
- **`/api/v1/*`** is our app API, served by a custom eve channel. Everything a client needs besides chat:

  | Method | Route | Use case |
  |---|---|---|
  | GET | `/home` | GetHomeSummary (all the widgets in one call) |
  | GET | `/proposals?status=pending` | ListPendingProposals |
  | POST | `/proposals/:id/approve` `{fingerprint}` | ApproveProposal. **The only way to create a grant.** Idempotent |
  | POST | `/proposals/:id/decline` | DeclineProposal |
  | GET | `/bookings`, `/bookings/:id` | ListBookings, GetBooking |
  | GET | `/action-intents`, `/sessions/:id/action-intents` | ListActionIntents: the action ledger's booking intents (state, attempts, booking ID, who settled it) and the booking update the reconciler owes the person |
  | GET | `/providers?ids=`, `/providers/:id` | GetProviders (fills generated cards with real data) |
  | GET | `/availability?providerIds=&week=` | GetAvailability (slots-per-day chart) |
  | GET | `/spend?from=&to=` | GetSpend (spend chart) |
  | GET | `/memory` | ListMemoryFacts |
  | PATCH | `/memory/:key` | CorrectMemoryFact |
  | DELETE | `/memory/:key` | ForgetMemoryFact |
  | POST | `/memory/:id/confirm` | ConfirmInferredFact |
  | GET | `/alerts` | ListAlerts |
  | GET | `/events` | Server-sent events: `proposal.created`, `booking.updated`, `errand.state_changed`, `alert.created` |
  | GET | `/sessions/:id/errand` | GetErrand: the session's errand, its workflow state and what is still missing |
  | GET | `/sessions/:id/trace`, `/sessions/:id/context` | Operators only. Trace and context log for the operator console's trace panel; every read is recorded (RecordOperatorRead) |
  | GET | `/ops/sessions` | Operators only. ListOperatorSessions: every session, its owner and errand, newest first |
  | GET | `/ops/sessions/:id/transcript` | Operators only. The session's read-only transcript; the read is recorded |
  | GET | `/ops/sessions/:id/reads` | Operators only. ListOperatorReads: who read the session's trace, context or transcript, and how often |
  | GET | `/assets/providers/:file` | Provider photos, served by the backend so every client gets the same images |
  | POST | `/dev/scenario`, `/dev/world-events/provider-cancelled` | Dev only. Switch a seeded scenario or fire a provider-cancel event |
  | PUT | `/dev/model-script` `{script}` | Dev only. Load a scenario's model turns into the offline model (`null` unloads) |
  | PUT | `/dev/run-limits` `{limits}` | Dev only. Run-budget limits for runs that start afterwards (`null` restores the defaults) |
  | PUT | `/dev/world-fault` `{fault}` | Dev only. Make one world operation slow, throw, or `pause_after` (do the call, then hold its reply) until the next scenario switch (`null` clears it and lets held calls go) |
  | GET | `/dev/world-fault` | Dev only. The fault in force and how many calls a `pause_after` is holding (the restart eval kills the backend then) |

  Every request and response body is a schema from **contracts**. The user comes from the channel's
  auth context, never from the body. Locally that is a fixed dev user; real auth later means swapping the
  channel's auth function and nothing else. The auth walk (`CALLER_AUTH`) takes an HS256 access token first
  (signed with `ERRAND_AUTH_SECRET`), then the local-dev stand-in; a token that doesn't verify is refused.

  **Sessions belong to their owner (ticket 19).** The first signed-in caller to reach a session through a
  route that starts or continues it claims it (core `ClaimSession`, store `session_owners`). Every route
  scoped to a session id, here and eve's `/eve/v1/session/:id/*`, checks `CheckSessionOwnership` and answers
  **404**, never 403, when the session isn't the caller's, exactly as for an unknown id. **Operators** are
  token callers on `ERRAND_OPERATOR_IDS`, decided only from the auth context (`agent/lib/operator.ts`), never
  from a body, query flag, header or the client; the local-dev caller never is one. Operator-only routes
  answer 404 to everyone else, and each operator read of a trace, context log or transcript is recorded
  (`operator_reads`) and shown in the console at `/ops`.

Mobile-readiness has a test. The **eval harness is a client too**: it drives `/eve/v1` and `/api/v1`
through the same client package the web uses. If evals pass, any client that speaks the API works.

## Layers and the dependency rule

```
          ┌──────────── apps/web · apps/mobile · evals (clients) ────────────┐
          │                 import only: packages/client, contracts           │
          └──────────────────────────────┬───────────────────────────────────┘
                                         │ HTTP (/eve/v1, /api/v1)
┌─ agent/ (eve: framework ring) ─────────▼──────────────────────────────────────┐
│ tools, channels, memory provider, subagents — humble: parse → use case → present │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               │ calls use cases via composition root
┌─ src/composition (Main) ─────▼──── wires adapters into use cases ──────────────┐
└──────────────┬───────────────────────────────────────────────┬─────────────────┘
┌─ src/adapters ▼ (world mock, sqlite, models, tracing) ─┐       │
│ implement core ports                                    │──────►│
└─────────────────────────────────────────────────────────┘       ▼
┌─ src/core (entities + use cases + ports) — imports nothing outside core ───────┐
└─────────────────────────────────────────────────────────────────────────────────┘
```

| Layer | May import | Must never import |
|---|---|---|
| `src/core` | `src/core` only | eve, SQLite, AI SDK, React, Zod, `contracts` |
| `src/adapters` | `src/core`, `packages/contracts`, drivers (SQLite, AI SDK) | `agent/`, `apps/` |
| `src/composition` | `src/core`, `src/adapters` | `agent/`, `apps/` |
| `agent/` | `src/composition`, `src/core` (use cases and types), `packages/contracts`, eve | `src/adapters` directly, `apps/` |
| `packages/contracts` | Zod | anything else in the repo |
| `packages/client` | `packages/contracts`, the eve client | React, `src/`, `agent/` |
| `packages/design-tokens` | nothing in the repo (Node built-ins for its CSS build) | anything else in the repo |
| `apps/*` | `packages/client`, `packages/contracts`, `packages/design-tokens` (its generated CSS and types), UI libraries | `src/`, `agent/` |
| `evals/` | `packages/client`, `packages/contracts`, `src/adapters/world` (seeding and state assertions), `src/adapters/models` and `src/adapters/tracing/price-table` (the simulated user's model and its cost) | `agent/`, the rest of `src/` (tests depend inward; nothing depends on tests) |

**The review reader is not an eve subagent.** It reads untrusted reviews, so it must have no tools
and answer only in a schema. An eve declared subagent runs eve's turn loop, and a per-call model
override needs an AI Gateway id, so the fallback from Claude Code to MiniMax couldn't be expressed.
It is instead one no-tools model call behind a core port (`ReviewReader`), with the fallback order and
the schema gate as core rules (`get-provider-insight.ts`, `review/provider-insight.ts`). See
[docs/notes/review-reader-remaining-risk.md](docs/notes/review-reader-remaining-risk.md).

A dependency-cruiser rule set enforces this table in `pnpm check`. When it is first added, it is shown to
fail on a planted violation (`src/core` importing `eve`), and that run is the proof the check works.

Why core doesn't use Zod: core defines plain TypeScript types. `contracts` holds the Zod schemas for the
wire, and the adapters and agent tools map between the two. A change to the wire format can't reach the
business rules.

## Directory

```
errand-agent/
├── agent/                                # eve agent directory (eve's convention: at the repo root)
│   ├── agent.ts                          # model per role + limits; gets use cases from composition
│   ├── instructions.md
│   ├── skills/
│   │   ├── clarify-errand.md
│   │   ├── compare-providers.md
│   │   ├── recover-booking.md
│   │   └── rebook-after-cancellation.md
│   ├── tools/                            # one file per model-callable tool, each a thin adapter
│   │   ├── search-providers.ts
│   │   ├── get_provider_insight.ts       # calls the review reader, returns schema only
│   │   ├── hold-slot.ts
│   │   ├── propose-action.ts             # book | cancel | reschedule → fixed approval card
│   │   ├── execute-proposal.ts           # refuses without a valid grant
│   │   ├── list-bookings.ts · find-reschedule-slots.ts
│   │   ├── remember-fact.ts · correct-fact.ts · forget-fact.ts
│   │   └── present-ui.ts · ask-ui.ts     # OpenUI generative surfaces
│   ├── memory/preferences.ts             # eve memory provider → BuildModelContext
│   └── channels/
│       ├── eve.ts                        # chat API config (CORS, auth)
│       └── app-api.ts                    # /api/v1/* routes + /events SSE + assets
├── src/
│   ├── core/
│   │   ├── errand/            errand.ts · errand-workflow.ts
│   │   ├── approval/          proposal.ts · grant.ts · fingerprint.ts
│   │   ├── booking/           action-intent.ts · reconciliation.ts · booking-change.ts · cancellation-fee.ts
│   │   ├── budget/            run-budget.ts · outcome.ts
│   │   ├── memory/            memory-fact.ts · context-selection.ts
│   │   ├── review/            provider-insight.ts (the insight schema and the gate the reader's answer passes)
│   │   ├── use-cases/         one file per operation, verb-noun:
│   │   │                      propose-action · approve-proposal · decline-proposal · execute-proposal
│   │   │                      propose-booking-change · change-approved-booking · settle-booking-change · find-reschedule-slots
│   │   │                      reconcile-pending-actions · handle-provider-cancelled
│   │   │                      remember-fact · correct-memory-fact · forget-memory-fact · confirm-inferred-fact
│   │   │                      build-model-context · get-home-summary · get-availability · get-spend
│   │   └── ports/             provider-world · action-ledger · proposal-store · memory-store
│   │                          clock · id-source · trace-sink · event-publisher · review-reader
│   ├── adapters/
│   │   ├── world/             mock-provider-world.ts (the 8 fixed tools) · scenarios/ · seed/ · assets/ (WebP + CREDITS.md)
│   │   ├── sqlite/            database.ts · migrations/ · *-store.ts (one per port)
│   │   ├── models/            minimax.ts · claude-code.ts · scripted.ts · select-model.ts
│   │   ├── review-reader/     the quarantined review reader: no tools, Claude Code CLI then MiniMax, strict schema
│   │   └── tracing/           jsonl-trace-sink.ts · sanitize.ts · prices.json · context-log-middleware.ts
│   └── composition/           container.ts — the only place that constructs adapters
├── packages/
│   ├── contracts/             api/ (request and response schemas) · events/ · ui/ (OpenUI component props)
│   └── client/                api-client.ts · event-stream.ts · chat-session.ts (wraps the eve client)
│   └── design-tokens/         src/ (typed tokens, dark and light) → tokens.css (generated)
├── apps/
│   ├── web/                   app/ (home, chat/[id]) · features/home/widgets · features/chat
│   │                          (assistant-ui runtime, approval-card, openui-library) · features/trace-panel
│   └── mobile/                README.md only: how an Expo app plugs into the same backend
├── evals/                     scenarios/ · users/ · scenario.ts · invariants.ts · reporter.ts · eval-table.ts
│                              fixtures/recorded/ (replay fixtures) · results/<mode>.json (feeds docs/EVAL_TABLE.md)
├── observatory/               dashboard copied from harness-observatory (MIT), adapted to our traces
├── scripts/                   fetch-stock-images.ts · export-observatory.ts
└── docs/                      SPEC.md · DESIGN.md (1 page) · BUGS.md · EVAL_TABLE.md (generated) · tickets/
```

## Clean-code conventions (repo rules)

- **Ubiquitous language.** These words mean one thing everywhere, in code, the UI and docs:
  - Errand, Provider, Slot, Hold, Quote, Proposal, Fingerprint, Grant, Booking, Action intent, Outcome
  - Memory fact (explicit or inferred), Tombstone, Context selection, Run budget

  We never use both *approve* and *confirm* for the same act. A *Grant* comes from *approving* a *Proposal*.
- **Names.** Use cases are verb-noun (`executeProposal`). Predicates read as questions (`isExpired`,
  `matchesFingerprint`). There are no `utils`, `helpers` or `manager` files: a function lives with the concept it serves.
- **Functions** are small, at one level of abstraction, with no flag arguments; split instead
  (`proposeCancellation` and `proposeReschedule`, not `propose(kind)` with branches inside). Command–query
  separation: a use case either changes state and returns an outcome, or answers a query.
- **Errors.** Expected failures are values. Core returns a discriminated `Outcome`
  (`slot_taken`, `approval_invalidated`, `verifying`, …). Exceptions are only for bugs and at boundaries.
  Every outcome maps to one user-facing message in one presenter, so there are no ad-hoc strings in tools.
- **Comments** explain *why* (for example, why we query status before retrying). They never restate *what*.
- **Tests** are named by behaviour ("a changed price voids the grant"). They assert outcomes and state,
  never internal calls. The Boy Scout rule applies to every ticket.

## Score against Clean Architecture: 9/10

The dependency rule is enforced by a check that we show can fail. Core is pure, Main is the only place
that wires concrete classes, delivery is a detail (the same use cases serve the agent tools, `/api/v1`, web,
mobile and evals), and the database and the models are plugins.

The missing point is deliberate. The mock world runs in the backend process behind a port, not as its own
service. A real provider network would be a separate adapter, and only `src/adapters/world` and
`composition` would change. We note this rather than building it, to keep the system simple.
