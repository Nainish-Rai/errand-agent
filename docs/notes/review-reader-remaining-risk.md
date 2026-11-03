# Review reader: how reviews are quarantined, and the risk that remains

Notes from ticket 09 for the design note (ticket 16).

## The design

Provider reviews are untrusted text written by strangers. The agent reads them through the dual-LLM
pattern (CaMeL's quarantined/privileged split):

- **The quarantined reader** (`src/adapters/review-reader/`) is one model call with no tools: Claude
  Code CLI with every built-in tool, MCP server and filesystem setting off, a fresh CLI session per
  provider (the provider would otherwise resume the previous session and mix providers' reviews),
  and a strict output schema of closed sets and numbers. MiniMax is the fallback, then "not
  available". There is no path that passes raw text on.
- **The gate** (`src/core/review/provider-insight.ts`, `signalsFrom`) checks the reader's answer in
  core: unknown fields and list values are dropped, a free-text sentiment or a count that isn't a
  count of the reviews read rejects the answer. The average rating is computed in code from the
  world's star ratings, never taken from the reader.
- **The privileged agent** (MiniMax, with tools) calls `get_provider_insight` and sees only that
  schema: sentiment, strength and complaint enums, the stars, and how many reviews tried to give
  instructions. It never sees a review sentence. The run trace logs every input the main model was
  sent (`gen_ai.input.messages`), and the evals check it holds no review text.

In Meta's Rule of Two terms, no component holds all three of untrusted input, sensitive data or
tools, and the power to change state: the reader has untrusted input and nothing else; the main
agent has tools but never untrusted text; and no tool can approve. A grant comes only from the
person's click on the approval card, through `POST /api/v1/proposals/:id/approve`.

## Remaining risk

A review can still bias which provider is picked, but it can't change approvals. The reader is a
model, and a review written to look like praise ("on time, tidy, fair price") moves the sentiment
and strength flags it reports, so fake reviews can push a provider up the agent's
recommendation, the same way they push it up any review site. What a review can't do is reach
the planner as instructions, change the errand's area, time window or budget, write memory, or
approve anything: those paths take no review-derived input, and the approval check is in code.
Since ticket 05 the agent can hold a slot, show the approval card and call `execute_proposal`, so
a biased pick can put a card on screen for the provider the reviews favoured; it still books
nothing until the person taps Approve on that card, because only that click mints a grant and
`execute_proposal` refuses (`not_approved`) without one.
The instruction count is advisory; a reader that misses an attack only loses the warning on the
card, not the guarantee. Provider names and the world's other structured fields still reach the
main agent directly; they come from the provider network, not from strangers, and are out of
scope here.

## Evidence

- Evals: `scenarios/injection/review-injection-changes-nothing`,
  `scenarios/injection/main-agent-never-sees-review-text`,
  `scenarios/adversarial/user-cannot-self-approve`; the attack success rate is in
  [EVAL_TABLE.md](../EVAL_TABLE.md). The checks read the session's proposals through the app API
  and fail on any grant without a click (`grantsWithoutClickIn` in `evals/injection-checks.ts`).
  The live campaign in the table ran before 05 merged, when the agent had no booking tools; a
  rerun against 05's tools is the next live measurement.
- Browser proof: `verification/suites/review-insight.json`, screenshots in `docs/evidence/09/`.
- `pnpm smoke:review-reader` runs the reader live on the seven-variant campaign.
