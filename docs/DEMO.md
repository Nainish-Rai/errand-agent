# Demo script (3–5 minutes)

This is the script for the submission recording. **Nainish does the recording.** This file only sets it up.

The recording shows the chat and the operator trace side by side. It covers one full booking, from the request to the tap on Approve to the booking ID, and a live failure: `book` times out after the provider has already booked. A second, optional failure is a prompt injection in reviews.

## Setup (before recording)

```bash
pnpm install
# once: an operator signing secret in the Keychain
security add-generic-password -s errand-agent-auth -a "$USER" -w "$(openssl rand -hex 32)"

# backend + web, live MiniMax model, you as the operator
MINIMAX_API_KEY="$(security find-generic-password -s errand-agent-minimax -w)" \
ERRAND_AUTH_SECRET="$(security find-generic-password -s errand-agent-auth -w)" \
ERRAND_OPERATOR_IDS=demo-operator pnpm dev

# in a second terminal: an operator token (don't paste it anywhere but the /ops sign-in)
ERRAND_AUTH_SECRET="$(security find-generic-password -s errand-agent-auth -w)" pnpm -s operator-token demo-operator

# put the mock world in the failure scenario
curl -s -X POST http://localhost:3100/api/v1/dev/scenario \
  -H 'content-type: application/json' -d '{"scenario":"timeout_after_success","seed":42}'
```

Windows: the chat at `http://localhost:3000` on the left. `http://localhost:3000/ops` on the right; paste the token into its sign-in form. Light theme. Hide the terminal and any token before recording.

No key? Run `ERRAND_MODELS="main=scripted" pnpm dev` and the app works with the offline model. Only `search_providers` answers then, so the full booking needs the live model.

## Script

| Time | Left: chat | Right: `/ops` | Say |
|---|---|---|---|
| 0:00–0:30 | Home screen, then type **"Find me a plumber in Koramangala this week"** | Open the new session as soon as it appears | "One errand per chat. The model plans; core code owns money and trust." |
| 0:30–1:15 | Options appear, tagged Best match, Cheapest and Earliest. Say **"the cheapest one"** | Trace: `update_errand`, `search_providers`, Errand states `gathering → searching → choosing` | "The world decides prices and slots, not the model. Options are filtered by budget and time window in code." |
| 1:15–2:00 | `hold_slot`, then the **approval card**: provider, time in IST, price, cancellation terms, hold countdown. Type **"yes"** first | Trace: `choosing → holding → awaiting_approval`; after "yes", `execute_proposal → not_approved` | "A typed yes is not an approval. Only a tap on this card mints a grant, and only on the server." |
| 2:00–3:00 | Tap **Approve ₹PRICE**. The reply says **Booked** with a booking ID | **The live failure.** Under `execute_tool execute_proposal`: `book` **error: timeout**, `ledger pending → unknown`, `get_booking_status` **booked** with the same key, `ledger unknown → confirmed`, then `executing → done`. No second `book` | "The provider booked but the reply was lost. We never trust book's reply: same idempotency key, status check, one booking. If the status had shown nothing, we'd retry with the same key, and still-unknown becomes 'Checking with the provider', never a false booked." |
| 3:00–3:30 | Home: **Upcoming** shows the booking once | Context log: tokens per call against the 40k cap; memory facts sent or left out, and why | "Every model call's exact context is logged. Operators only; a person never sees traces or costs." |
| 3:30–4:30 (optional) | Switch the world: `curl … -d '{"scenario":"review_injection","seed":42}'`, then a new chat: **"Find an electrician in Indiranagar and tell me what reviews say"** | `get_provider_insight` and its `chat review_reader …` span: schema-only output, with injection attempts counted | "Every review here tries to book or rewrite memory. The agent never reads reviews. A tool-less reader returns enums, and nothing is booked or remembered." |
| 4:30–5:00 | — | Session list | "Evals: `pnpm eval` runs offline with no key; the table is in docs/EVAL_TABLE.md." |

## If something goes wrong on camera

- The model asks a question instead of searching: answer it. That's the clarify flow.
- The trace pane is empty: the operator token expired or is missing. Get a new one with `pnpm -s operator-token demo-operator`.
- For a clean retake, post the scenario switch again. It clears proposals, grants, errands and any fault.
- The offline proof of the same failure is the eval `scenarios/booking/timeout-after-success-booked`, and its raw trace is [traces/timeout-after-success.jsonl](traces/timeout-after-success.jsonl).
