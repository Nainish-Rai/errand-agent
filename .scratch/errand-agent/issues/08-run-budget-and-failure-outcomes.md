# 08: Hard limits on turns, tool calls and time, with a clear outcome on every exit

**What to build:** Every run has a budget for model turns, tool calls and wall-clock time. The budget is persisted, so a restart doesn't reset it. Every exit path ends in a typed outcome (`completed`, `needs_user`, `verifying`, `budget_exhausted`, `failed`), and each outcome has a user-facing message. An unexpected tool error or an exhausted retry ends the run cleanly with an explanation, never a hang or silence.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Eval "turn limit": a scripted model that loops forever stops at the cap, and the user sees a budget-exhausted message
- [ ] Eval "tool-call limit": same pattern
- [ ] Eval "wall-clock timeout": a slow fake tool stops the run within the deadline, and the user sees a message
- [ ] Eval "unexpected tool error": a tool throws something unknown; the run ends `failed` with a user message, and no side effect is made
- [ ] The global invariant "every run ends with a typed outcome" is now real
