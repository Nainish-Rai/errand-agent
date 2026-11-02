# 01: Tracer bullet: ask for a provider in chat, see real search results

**What to build:** Fork eve's `eve-chat-template` and remove what we don't need (Slack, Linear/Notion/Sentry connections, Neon, Upstash, Vercel sign-in). Run it in local-development mode. A user types "find a plumber in Koramangala this week" in the web chat. The real MiniMax model, called directly through its Anthropic-compatible API and passed to eve as an AI SDK model instance (no AI Gateway), calls `search_providers` on the seeded mock world, and the chat shows the providers it returns. The chat thread and composer are assistant-ui components bound to `useEveAgent`. This ticket includes the spike that proves that binding works. One offline eval runs the same request against a scripted model (`mockModel`) and asserts that `search_providers` was called with the right service and area.

**Blocked by:** None (can start immediately)

**Status:** done (PR #1)

- [x] One command starts the agent and the web app locally, with no external services except the MiniMax API key
- [x] One setting selects the model per role (`minimax`, `claude-code`, `scripted`); the MiniMax model ID and price are confirmed against MiniMax's docs and written down
- [x] Smoke check: the Claude Code CLI provider (local `claude` login) returns a structured answer for a role without tools, so later tickets can rely on it
- [x] The mock world is seeded and named-scenario driven. `search_providers` returns 3–8 providers with IDs, prices, ratings, slots and attributes, and the same seed gives the same output
- [x] All 8 fixed tool contracts exist in the mock world with their exact names, inputs, outputs and failure behaviours. Later tickets will expose them to the agent
- [x] The web chat renders through assistant-ui on top of `useEveAgent` and streams the agent's reply
- [x] `pnpm eval` runs one offline scenario with the scripted model and passes without network access
- [x] The directory and services follow ARCHITECTURE.md: one backend (the eve server, with `/eve/v1` and `/api/v1`), a web app that is only a UI shell, and shared `contracts` and `client` packages
- [x] The web app reaches the backend only through the `client` package. The ticket 01 eval uses the same client, which proves a non-browser client works
- [x] `pnpm check` enforces the layer rules with dependency-cruiser. It is shown failing on a planted `src/core` → `eve` import, then passing

**Notes (PR #1):**
- MiniMax model: `MiniMax-M3`, $0.30 / 1M input, $1.20 / 1M output, $0.06 / 1M cache read (standard tier, input ≤ 512k tokens). Source: https://platform.minimax.io/docs/guides/pricing, checked 2026-11-03. Recorded in `src/adapters/tracing/prices.json`.
- The 8 tool contracts exist as `ProviderWorld` port methods (camelCase: `searchProviders`, `holdSlot`, …). Only `search_providers` has wire schemas and is exposed to the agent so far.
- The mock world's state is in memory; SQLite comes with the ledger ticket.
- The web app imports `eve/react` (`useEveAgent`) and nothing else from eve. It passes in a `ClientSession` that `packages/client` created, so all its requests go through the client package.
