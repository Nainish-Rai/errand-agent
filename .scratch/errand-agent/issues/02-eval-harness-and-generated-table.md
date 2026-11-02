# 02: Eval harness with scripted users, global invariants and a generated eval table

**What to build:** A reviewer runs `pnpm eval` and gets an eval table (scenario · expected · actual · pass/fail · notes) produced by the run itself. Each scenario declares four things: a world seed and scenario, a scripted user (answers to questions, which approval cards to click, what to say when), the scripted model turns, and expected end state. After every scenario a shared set of global invariants is checked against world state, the ledger and the logs. Later tickets add their scenarios here.

**Blocked by:** 01

**Status:** done (PR #4)

- [x] A scenario format covers seed, faults, scripted user, scripted model and expected state
- [x] The scripted user can click approval cards through the same endpoint the UI uses. The endpoint can be a stub until ticket 05
- [x] The global invariant checks run after every scenario. Each check is a placeholder that turns real as its feature lands: no side effect without a consumed matching grant; at most one booking per grant; no "booked" claim without verification; no forgotten or unconfirmed fact in logged context; every run ends with a typed outcome
- [x] A custom eve reporter writes the eval table as Markdown, and the table is not edited by hand
- [x] Three modes run the same scenarios: `offline` (scripted model and user; the default and CI), `replay` (recorded real MiniMax runs) and `live` (real MiniMax agent plus a Claude Code CLI simulated user, k trials, with a pass^k column)
- [x] Record mode saves a live MiniMax run as a fixture that replay mode plays back with no network
- [x] Proof that a check can fail: planting a defect (for example a scenario that books without approval) makes the run report FAIL
