# 15: Observability dashboard for agent runs, built into this repo

**What to build:** A reviewer runs one command after the eval suite (or after any local session) and gets a single-file HTML dashboard of the errand agent's runs: sessions, turns, model and tool spans, tokens, latency, errors, retries and cost. The dashboard code comes from Nainish-Rai/harness-observatory (MIT, our own repo) and lives in this repo. There is no separate PR and no dependency on the other repo. The copied analyzer is adapted to read our trace files instead of Claude Code/Codex logs, adds an errand-agent source next to the hardcoded ones, and shows cost. The same dashboard also renders the Claude Code sessions used to build this repo, which is the AI-assistant transcript deliverable.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] The copied code is in this repo with its MIT notice and a short note on where it came from and what changed
- [ ] One command turns the run traces into the dashboard; after the eval suite it shows every scenario run with tokens, latency, errors and cost
- [ ] Failed tool calls and retries (e.g. cancel 503 then success, timeout-after-success) show up as failed and retried spans
- [ ] The same command can render this repo's own Claude Code build sessions, with prompts redacted the way the original does
- [ ] Generated dashboards and summaries stay out of git, except the one committed for the submission
