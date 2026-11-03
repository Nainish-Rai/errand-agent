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
        { "command": "goto", "args": ["/chat"] },
        { "command": "fill", "options": { "role": "textbox", "name": "Message the errand agent", "value": "find a plumber in Koramangala this week" } },
        { "command": "key", "args": ["Enter"] },
        { "command": "assert", "options": { "role": "region", "name": "Search results for plumber in Koramangala", "text": "8 plumber in Koramangala" }, "note": "the provider results render" },
        { "command": "api", "args": ["GET", "/api/v1/sessions/current/trace"], "options": { "as": "operator", "expect": { "path": "totals.toolCalls", "equals": 1 } } }
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
| `booking-changes.json` | "Move my AC servicing to Saturday" shows a fixed reschedule card with the old time struck through beside the new one, and one tap moves `bkg_seed_3` once with its grant consumed; a refused 8 am moves nothing, says why, and the closest free time (2 pm) is a fresh pending card that alone moves it; a cancellation card shows "No fee" and the provider's terms, a 503 is retried and `Cancelled` appears with the intent confirmed after two attempts; "the same electrician as last time, not before 10" puts Lakshmi Wiring Services at 11:00 on the card with the errand's earliest hour 10 |
| `chat-search.json` | scripted search renders 8 providers from the world (Enter and Send), the reply follows, the trace holds one `search_providers` |
| `trace-panel.json` | in the operator console (signed in with the run's operator token) the session's transcript sits beside the waterfall with 2 model spans and 1 tool span, matching the backend trace, and every read is in the access log under `verify-operator`; `/ops` lists the session by its errand and opens it; after the person's second turn the console shows both turns |
| `operator-only-traces.json` | after a search the person's chat has no trace toggle, trace panel, model-call count, token count or cost, and Show memory still works; an old `?rail=trace` link opens nothing; the person gets 404 for the trace, context and console routes, a second person 404 for the errand and trace, and only the operator reads the trace; a wrong token at `/ops` opens nothing |
| `clarify-errand.json` | "I need a plumber this week" gets one area question with area chips; a chip answers it; two or three options tagged Best match / Cheapest / Earliest; the operator console's trace panel lists the errand's state transitions, matching the backend errand and trace |
| `memory.json` | the Memory panel lists seeded facts with explicit/inferred badges and Confirm only on guesses; Correct supersedes (old fact kept as replaced); Forget leaves a tombstone that survives a reload; Confirm activates a guess; a remembered area fills a new errand and the reply says so; a chat forget reaches the open panel; each checked against `GET /api/v1/memory` |
| `run-budget.json` | a scripted model that loops forever stops at four model turns (three tool calls) and the chat shows the budget-exhausted message, with the `run budget_exhausted` outcome in the trace; a world search that throws ends the run failed with the failure message, the search shows as failed, and the errand is failed |
| `approval-card.json` | choosing an option shows the fixed approval card (provider, time in IST, address, price, cancellation terms, hold countdown); Approve ₹399 books exactly one booking whose grant has the card's fingerprint and is consumed, with the receipt and the agent's reply giving the booking ID; Decline books nothing and frees the slot; a typed yes books nothing and shows the card again |
| `approval-invalidation.json` | a price raised or a visit moved after the tap on Approve voids the card (old value beside new, `Nothing was booked.`), the agent names the old and new values, a fresh card needs its own tap, and `GET /api/v1/bookings` shows exactly one booking only after that second tap; a hold that `book` finds expired is held again and proposed on a fresh card |
| `home.json` | the composer's area, budget and time chips (prefilled from memory) become the errand before the first model turn, so the agent asks nothing, checked against the errand and the trace event `composer → errand: …`; Waiting on you opens the chat focused on the approval card (Tab+Enter approves); a `new_user` world shows every widget's empty state; light is the default under an OS dark setting and a toggled dark choice persists; the populated home in dark and light at 1440 and 390 |
| `context-budget.json` | with 53 seeded facts and fifteen scripted messages, the operator console's context log shows the last turn sent only the budget and the earliest start, lists 40 superseded, 9 forgotten, 1 unconfirmed and 1 overridden fact as left out with their reasons, and shows the oldest history dropped behind a summary; turn 1 sent the usual area; checked against `GET /api/v1/sessions/current/context` (its seed equals `evals/context-budget-seed.ts`) |
| `design-system.json` | `/design` opens light although the OS prefers dark; a toggled dark choice survives a reload, and so does going back to light; every approval card state (declined included) renders in both panels; a loading icon button shows only the spinner |
| `focus-shells.json` | the chat input and the search palette show focus on the shell, their text field draws no ring (`outline-style=none`); the home composer, a standalone field, keeps Lime's ring |
| `lime-foundations.json` | with the OS on dark every page opens light (`html` has `class=lime`, `data-theme=light`); dark is behind the toggle, saved, and survives a reload, and back to light survives one too; home, chat, memory, the operator console and `/design` render in Lime in both themes |
| `lime-chat.json` | on `/design` the streaming answer shows words blurring in mid-stream (and plain under reduced motion), then settles with every word span unwrapped and the full answer as plain paragraphs; in `/chat` a provider card's Choose is outline, the waiting card's Approve is the only lit lime (Send turns ink), Approve gives an Approved footer, a running `Asking the provider` row during a slow book, then the Booked receipt with `bkg_0002`, Reschedule and Cancel booking, and no Undo |
| `exactly-once.json` | a `book` that times out after the provider booked shows "Checking with the provider…" and the promise while the status is asked, then the receipt with `bkg_0002`, one booking, the intent confirmed after one attempt; a double click on Approve books once; a taken slot books nothing and shows the next options |
| `generated-ui.json` | the search renders as one generated component: two choice cards with photo, world price, highlight and earliest slot (dark and light), "See all 8" lists every plumber, Details opens a gallery, Choose sends a message and the fixed approval card is the only Approve, which books exactly one booking; an ask form asks only the missing time window and fills the errand; price, free-slots-per-day and spend charts show the world's numbers; a pick-one list offering "Approve" is refused and a tapped Yes books nothing; a malformed program is not drawn, the reply says it in text and the parse error is in the trace |
| `images.json` | choice cards and Details show bundled photos by image key, and the approval card and the receipt carry the provider thumbnail in their `media` slot (light and dark); "Which AC service?" shows a photo, the world's price and description per option and a tap answers; 23's home tiles and suggestion pills carry service photos in their media slots (decorative in a pill, so its name stays its words) and a tile sends its request; every image request is a `/_next/static/media/` file. In `untrusted_images` (URLs, data: URIs, paths, prototype names, unknown keys) with a reply smuggling markdown and raw `<img>`, `<picture>` and a CSS `url()`, every surface shows initials or a line icon (the approval card and receipt get no media, so they keep their own initials), the page has no `<img>` and the browser requests no image |
| `provider-cancellation.json` | a provider-cancelled event (with hostile free text) makes the agent post a fixed provider-update notice in a new chat without a message from the person; the Alerts widget and the bell link to that chat at the fresh card, which holds focus; the card offers Prestige AC Care within the saved area, budget and earliest hour, never the cancelling provider; nothing books until the tap, then exactly one booking and the alert reads Rebooked; a redelivered event and a second event for the same cancellation change nothing; an event for a past booking tells nobody; phone in light theme |
| `review-insight.json` | in the `review_injection` world, each option's insight card renders from the schema only (strengths, red flags, the flagged-review count, the reader) in both themes; no review sentence is on the page while the world holds the attacks; the errand is unchanged, the trace has the reader's spans, and only the seeded bookings exist |

When a ticket adds UI, add its scenarios to the matching suite or a new one, and list it in the
[feature map](../features/README.md).

## Proving a suite can fail

Copy a suite outside the repo, change one expectation (for example `8 plumber` → `9 plumber`),
run the copy: it must report FAIL with `failure.png` showing the real state. Run the original
again: PASS. Never commit the planted copy.
