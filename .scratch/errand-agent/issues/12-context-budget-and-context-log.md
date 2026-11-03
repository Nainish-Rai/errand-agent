# 12: Fixed context budget with 50+ memories and a long history; every turn's context is logged

**What to build:** The world is seeded with 50+ stored memories (some forgotten, superseded, inferred-unconfirmed or irrelevant) and a long prior conversation. Before each model call, core's context builder first filters (active, and explicit or confirmed, and not forgotten), then ranks by relevance to the current errand, then packs into a fixed token budget. Model calls go through a wrapper that logs the exact context sent each turn, with included and excluded facts and the reasons, and that enforces the cap. The logged context is visible in the trace panel.

**Blocked by:** 11, 03

**Status:** done (PR #15)

- [x] Core tests: filtering happens before ranking, so a ranking that would favour a forgotten fact still excludes it; the token cap is never exceeded
- [x] Eval "context budget": with 50+ memories and a long history, every logged turn is within the budget and contains only relevant, current preferences
- [x] The global invariant "no forgotten or unconfirmed-inferred fact in any logged context" is now real across all scenarios
- [x] The trace panel shows each turn's context and the exclusion reasons
