# 01: Tracer bullet: ask for a provider in chat, see real search results

**What to build:** Fork eve's `eve-chat-template` and remove what we don't need (Slack, Linear/Notion/Sentry connections, Neon, Upstash, Vercel sign-in). Run it in local-development mode. A user types "find a plumber in Koramangala this week" in the web chat. The real MiniMax model, called directly through its Anthropic-compatible API and passed to eve as an AI SDK model instance (no AI Gateway), calls `search_providers` on the seeded mock world, and the chat shows the providers it returns. The chat thread and composer are assistant-ui components bound to `useEveAgent`. This ticket includes the spike that proves that binding works. One offline eval runs the same request against a scripted model (`mockModel`) and asserts that `search_providers` was called with the right service and area.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] One command starts the agent and the web app locally, with no external services except the MiniMax API key
- [ ] One setting selects the model per role (`minimax`, `claude-code`, `scripted`); the MiniMax model ID and price are confirmed against MiniMax's docs and written down
- [ ] Smoke check: the Claude Code CLI provider (local `claude` login) returns a structured answer for a role without tools, so later tickets can rely on it
- [ ] The mock world is seeded and named-scenario driven. `search_providers` returns 3–8 providers with IDs, prices, ratings, slots and attributes, and the same seed gives the same output
- [ ] All 8 fixed tool contracts exist in the mock world with their exact names, inputs, outputs and failure behaviours. Later tickets will expose them to the agent
- [ ] The web chat renders through assistant-ui on top of `useEveAgent` and streams the agent's reply
- [ ] `pnpm eval` runs one offline scenario with the scripted model and passes without network access
- [ ] The directory and services follow ARCHITECTURE.md: one backend (the eve server, with `/eve/v1` and `/api/v1`), a web app that is only a UI shell, and shared `contracts` and `client` packages
- [ ] The web app reaches the backend only through the `client` package. The ticket 01 eval uses the same client, which proves a non-browser client works
- [ ] `pnpm check` enforces the layer rules with dependency-cruiser. It is shown failing on a planted `src/core` → `eve` import, then passing
