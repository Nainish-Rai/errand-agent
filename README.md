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

`pnpm eval` runs offline: a scripted model replaces MiniMax, so it needs no key and no network.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Backend and web app together |
| `pnpm dev:backend` / `pnpm dev:web` | One of them |
| `pnpm dev:tui` | Backend with eve's terminal chat UI |
| `pnpm eval` | Offline evals (`evals/`) against the scripted model |
| `pnpm check` | Typecheck, layer rules (dependency-cruiser) and unit tests |
| `pnpm smoke:search` | With the backend running: sends "find a plumber in Koramangala this week" through `packages/client` and checks that `search_providers` ran |
| `pnpm smoke:claude-code` | Gets a structured answer from the Claude Code CLI provider (uses your local `claude` login) |

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

## Layout

```
agent/            eve agent: agent.ts, instructions, tools/, channels/ (eve.ts = /eve/v1, app-api.ts = /api/v1)
src/core/         pure rules and ports (no eve, Zod, AI SDK)
src/adapters/     mock provider world (seeded, scenario-driven), models
src/composition/  the only place adapters are constructed
packages/         contracts (Zod wire schemas), client (typed API + chat client, no React)
apps/web/         Next.js UI shell: assistant-ui bound to eve's useEveAgent; no API routes
evals/            eve evals; each one is a client of the backend
```

The web app is a fork of eve's [`eve-chat-template`](https://github.com/vercel/eve/tree/main/apps/templates/eve-chat-template), stripped to local-development mode: no Slack, no Linear/Notion/Sentry connections, no Neon, no Upstash, no Vercel sign-in.

## Mock world

`src/adapters/world` implements the assignment's eight tools (`search_providers`, `get_provider`, `hold_slot`, `book`, `get_booking_status`, `cancel`, `reschedule`, `list_bookings`) with their failure behaviour. Every outcome is a function of a seed and a named scenario (`default`, `happy_path`, `slot_taken`, `timeout_after_success`, `timeout_without_booking`, `price_changed_on_hold`, `reschedule_conflict`). Switch with `POST /api/v1/dev/scenario {"scenario":"…","seed":42}`. Only `search_providers` is exposed to the agent so far.
