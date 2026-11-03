# Suites

```sh
pnpm -s verify --run "$RUN" suite verification/suites/chat-search.json --report html
```

A suite reuses the run's servers and Chrome. Each scenario gets a **fresh browser context**
(its own storage, cookies, network guard and evidence directory `suite-…/SCENARIO/`), runs its own
doctor (including the guard probe), runs its setup, then its steps, and closes. Scenarios run one
at a time: they share the run's one backend world, so a scenario that needs a known world seeds it
in `setup`.

## Results

| Status | Meaning |
| --- | --- |
| PASS | every step passed, no request left the run, the context closed |
| FAIL | a step's expectation did not hold (or a request was blocked): the product is wrong |
| BLOCKED | the context, the doctor or a `setup` step failed: the environment is wrong |
| NOT RUN | steps after the one that stopped the scenario |

The suite's status is FAIL if any scenario failed, else BLOCKED if any was blocked, else PASS.
A FAIL scenario keeps `failure.png`, the settled state when it stopped.

## File format

```json
{
  "version": 1,
  "title": "Chat search: …",
  "feature": "chat-search",
  "description": "What this proves and for which ticket.",
  "scenarios": [
    {
      "id": "enter-sends-and-providers-render",
      "title": "…",
      "theme": "dark",
      "viewport": "desktop",
      "setup": [
        { "command": "api", "args": ["POST", "/api/v1/dev/scenario"], "options": { "body": { "scenario": "default", "seed": 42 } } }
      ],
      "steps": [
        { "command": "goto", "args": ["/"] },
        { "command": "fill", "options": { "role": "textbox", "name": "Message the errand agent", "value": "find a plumber in Koramangala this week" } },
        { "command": "key", "args": ["Enter"] },
        { "command": "assert", "options": { "role": "region", "name": "Search results for plumber in Koramangala", "text": "8 plumber in Koramangala" }, "note": "the provider results render" },
        { "command": "api", "args": ["GET", "/api/v1/sessions/current/trace"], "options": { "expect": { "path": "totals.toolCalls", "equals": 1 } } }
      ]
    }
  ]
}
```

- Step commands: `goto`, `reload`, `click`, `hover`, `fill`, `type`, `key`, `wait`, `assert`,
  `api`, `viewport`, `theme`, `screenshot`, `snapshot`. Setup commands: `api`, `goto`, `theme`,
  `viewport`. Options are the CLI's, in JSON (`timeoutMs` for `--timeout-ms`).
- Every scenario needs an assertion (`assert`, or `api` with `expect`), and the last action needs
  its own assertion after it: an earlier landmark cannot vouch for a later click.
- `note` says what the step proves; it is shown in the report next to its screenshot.
- Screenshots are automatic: before every action except `goto` (`step-N-action.png`) and after
  every assertion (`step-N-outcome.png`), viewport-sized.
- Unknown fields, commands or options are refused before anything runs.

## Seed suites (`verification/suites/`)

| Suite | Proves |
| --- | --- |
| `chat-search.json` | scripted search renders 8 providers from the world (Enter and Send), the reply follows, the trace holds one `search_providers` |
| `trace-panel.json` | Hide/Show trace toggle and close button; the waterfall shows 2 model spans and 1 tool span, matching the backend trace; a panel open before the first message shows the turn |
| `clarify-errand.json` | "I need a plumber this week" gets one area question with area chips; a chip answers it; two or three options tagged Best match / Cheapest / Earliest; the open trace panel lists the errand's state transitions, matching the backend errand and trace |
| `memory.json` | the Memory panel lists seeded facts with explicit/inferred badges and Confirm only on guesses; Correct supersedes (old fact kept as replaced); Forget leaves a tombstone that survives a reload; Confirm activates a guess; a remembered area fills a new errand and the reply says so; a chat forget reaches the open panel; each checked against `GET /api/v1/memory` |
| `run-budget.json` | a scripted model that loops forever stops at four model turns (three tool calls) and the chat shows the budget-exhausted message, with the `run budget_exhausted` outcome in the trace; a world search that throws ends the run failed with the failure message, the search shows as failed, and the errand is failed |
| `approval-card.json` | choosing an option shows the fixed approval card (provider, time in IST, address, price, cancellation terms, hold countdown); Approve ₹399 books exactly one booking whose grant has the card's fingerprint and is consumed, with the receipt and the agent's reply giving the booking ID; Decline books nothing and frees the slot; a typed yes books nothing and shows the card again |
| `design-system.json` | `/design` theme toggle persists across reload dark→light and light→dark against the system setting; every approval card state (declined included) renders in both panels |
| `review-insight.json` | in the `review_injection` world, each option's insight card renders from the schema only (strengths, red flags, the flagged-review count, the reader) in both themes; no review sentence is on the page while the world holds the attacks; the errand is unchanged, the trace has the reader's spans, and only the seeded bookings exist |
| `design-system.json` | `/design` theme toggle persists across reload dark→light and light→dark against the system setting; every approval card state renders in both panels |

When a ticket adds UI, add its scenarios to the matching suite or a new one, and list it in the
[feature map](../features/README.md).

## Proving a suite can fail

Copy a suite outside the repo, change one expectation (for example `8 plumber` → `9 plumber`),
run the copy: it must report FAIL with `failure.png` showing the real state. Run the original
again: PASS. Never commit the planted copy.
