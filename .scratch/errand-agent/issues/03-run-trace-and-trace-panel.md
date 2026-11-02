# 03: Every run leaves a trace, shown beside the chat

**What to build:** Each agent run writes a trace file (JSONL). It records model calls (model, tokens, latency, estimated cost from a versioned price table covering MiniMax; Claude Code CLI calls record the cost the CLI reports), tool calls (name, sanitised arguments and result, latency, error), and a slot for state-transition and context events that later tickets fill in. Span and attribute names follow the OpenTelemetry GenAI conventions. The web chat has a toggleable side panel that shows the current session's trace as a waterfall, using the agents-ui trace-waterfall component.

**Blocked by:** 01

**Status:** done (PR #2)

- [x] Running the ticket 01 request produces a trace file with model and tool spans, tokens, latency and estimated cost
- [x] Sanitisation removes phone numbers, emails and keys from arguments and results before they are written
- [x] The chat's side panel shows the waterfall for the session as it runs
- [x] An eval asserts the trace exists and has the expected span kinds
