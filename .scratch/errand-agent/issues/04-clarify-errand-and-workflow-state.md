# 04: The agent asks only for missing details and keeps an explicit errand state

**What to build:** From the user's first message the agent fills a structured errand: service, area, time window, budget and preferences. It asks only for fields that are still empty, at most one or two per message, and offers quick-reply suggestions. A correction such as "actually Saturday" changes that one field and leaves the others alone. The errand moves through an explicit workflow state machine in core (`gathering → searching → choosing → …`). Illegal transitions are rejected, and every transition appears in the trace. The agent shows 2–3 options tagged Best match / Cheapest / Earliest, and drops any option outside the budget or time window.

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] Core tests: patching one field leaves the other fields unchanged, and illegal transitions are refused
- [ ] Eval "only missing details asked": a fully specified request produces no clarifying question; a request missing the area produces exactly one question, about the area
- [ ] Eval "correction keeps context": after changing the date, service, area and budget are unchanged in the errand state
- [ ] Eval: no option shown is outside the budget or time window
- [ ] State transitions appear in the trace panel
- [ ] Out-of-scope or nonsense input gets a clear "can't help with that" reply, covered by an adversarial-input eval
