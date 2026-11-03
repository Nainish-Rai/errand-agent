# Errand agent verification map

What can be verified in the browser, how, and what was last proven. Start with
[the skill](../SKILL.md); `doctor` must be all `true`. A result applies only to the source it ran
on: rerun the suite for yours. A mapped feature with no run on your source is **NOT RUN**.

## Baseline

- Launched with `pnpm -s verify --run RUN launch` from the checkout under test (scripted models,
  clock pinned to 2026-11-04 09:00 IST, world `default` seed 42 unless a scenario seeds another).
- Routes: `/` (chat with the trace panel), `/design` (the design system gallery).
- Prefer roles and accessible names; the handles below were observed live.

## Features

| Feature | Ticket | Entry | Handles | Recipe | Last live result |
| --- | --- | --- | --- | --- | --- |
| Chat search | 01 | `/`, type a search, Enter or Send | textbox `Message the errand agent`, button `Send`, region `Search results for SERVICE in AREA` with a `listitem` per provider | [chat-search.json](../../../../verification/suites/chat-search.json) | PASS, see the ticket 19 PR |
| Trace panel | 03, 04 | `/`, the `Hide trace` / `Show trace` toggle, `Close the trace`; open before the first message | `complementary "Run trace"`, summary `N model calls · N tool calls`, `tree "Steps"`, `treeitem`s `chat errand-script …` and `search_providers tool …`, region `Errand states`; `api GET /api/v1/sessions/current/trace` | [trace-panel.json](../../../../verification/suites/trace-panel.json) | PASS (with `open-panel-follows-first-message`), see the ticket 04 PR |
| Design system and theme | 18 | `/design`; theme toggle on `/` and `/design` | `html[data-theme]`, button `Switch to light theme` / `Switch to dark theme`, regions `Approve booking` / `Approve cancellation` / `Approve reschedule` | [design-system.json](../../../../verification/suites/design-system.json) | PASS, see the ticket 19 PR |
| Live chat (MiniMax) | 01 | `launch --live`, then a search on `/` | as chat search; the reply wording varies | by hand (see the ticket 19 PR) | PASS once, see the ticket 19 PR |
| Clarify errand and workflow state | 04 | `/`, an underspecified errand ("I need a plumber this week"); setup loads the clarifying model script | group `Quick replies: Area` with a `button` per chip (`Koramangala` …), region `Options for SERVICE in AREA` with a `listitem` per tagged option (`Best match`, `Cheapest`, `Earliest`), region `Errand states` in the trace panel (`start → gathering`, `gathering → searching`, `searching → choosing`); `api GET /api/v1/sessions/current/errand` | [clarify-errand.json](../../../../verification/suites/clarify-errand.json) | PASS (scripted) and by hand with `--live` (one area question, chips, two tagged options, three transitions), see the ticket 04 PR |
| Run budget and failure outcomes | 08 | `/`, any errand; setup tightens the limits (`PUT /api/v1/dev/run-limits`), loads a looping model script, or faults the world (`PUT /api/v1/dev/world-fault`) | the reply text (`I stopped working on this because it reached …`, `Something went wrong on my side, …`), button `Stop` gone when the run ends, `The search for SERVICE in AREA failed.`, region `Errand states` (`gathering → failed`), trace panel summary `N model calls · N tool calls`; `api GET /api/v1/sessions/current/trace` (`events[*].name` includes `run budget_exhausted` / `run failed`) | [run-budget.json](../../../../verification/suites/run-budget.json) | PASS (scripted), see the ticket 08 PR |
| Approval card in chat | 05 | `/`, a search, then choose an option ("The cheapest one, please."); setup loads the booking model script | region `Approve booking` (text: provider, `Thu, 5 Nov, 8:00 am IST`, `Koramangala, Bengaluru`, cancellation terms, `N:NN left`, then `Approved` / `Declined`), buttons `Approve ₹399`, `Other options`, `Decline`; region `Booked` (the receipt, with the booking ID); `api GET /api/v1/bookings` (`bookings[*].approval.grantFingerprint`, `grantConsumed`), `api GET /api/v1/sessions/current/proposals`, `api GET /api/v1/proposals/:id` | [approval-card.json](../../../../verification/suites/approval-card.json) | PASS (scripted): Approve books exactly one booking carrying the card's fingerprint with its grant consumed, Decline books nothing and frees the slot, a typed yes books nothing and shows the card again; and by hand with `--live` (MiniMax held the cheapest slot, the card showed, Approve booked `bkg_0002` with its grant consumed); see the ticket 05 PR |
| Memory panel and remembered errands | 11 | `/`, the `Show memory` / `Hide memory` toggle (closed by default), `Close memory`; setup seeds memory with `api PUT /api/v1/dev/memory` | `complementary "Memory"`, `list "Remembered facts"` with a `listitem` per current fact named `LABEL · VALUE` (`Area · Koramangala`, `Budget · ₹1,500`) holding the `explicit` / `inferred` badge and buttons `Confirm` (guesses only), `Correct`, `Forget`; correction form `textbox "New area"` + `Save` / `Cancel`; `listitem "Forgotten: Area"` (tombstone, `never used again`); region `Replaced` (superseded facts); `api GET /api/v1/memory`, `GET /api/v1/sessions/current/errand` and the trace event `memory → errand: area` | [memory.json](../../../../verification/suites/memory.json) | PASS (scripted, 6 scenarios: badges, Correct supersedes, Forget survives a reload, Confirm, remembered area fills a new errand and is said aloud, a chat forget reaches the open panel), run `t11-c064344`, see the ticket 11 PR |
| Review insight (prompt injection) | 09 | `/`, an errand with options in the `review_injection` world; setup loads a model script that calls `get_provider_insight` | region `Review insight` with a region `Review insight for PROVIDER` per option (`Strengths`, `Red flags`, "N review tried to instruct the assistant and was ignored", "Read by …"); `text=/…review sentences…/` with `count 0`; `api GET /api/v1/providers/:id` (the world's raw reviews), `/api/v1/sessions/current/errand`, `/api/v1/sessions/current/trace` (`chat review_reader …` spans), `/api/v1/bookings` | [review-insight.json](../../../../verification/suites/review-insight.json) | PASS (scripted, dark and light; run t09-c1 on 05's main), see the ticket 09 PR |
| Home screen | 13 | to map: the home route | to map: hero, errand composer, widgets, both themes | none yet | NOT RUN (not built) |
| Generated UI in chat | 17 | `/`, a turn that renders OpenUI | to map: generated surfaces; prove none renders an approve button | none yet | NOT RUN (not built) |

## Known findings

- **Trace panel, running spans under a pinned clock** (found 2026-11-03, run `t19-live`; fixed in
  ticket 04): span times used the real clock but the trace route's `generatedAtMs` used the pinned
  clock, so a running span looked about 99,000 s long. Every trace time (spans, errand transitions
  and the route's "now") now comes from the container's `wallClock`.
- **Trace panel open before the first message looked empty** (found by ticket 19's chat-search
  suite; fixed in ticket 04): the panel only polled once a second, so a fast scripted turn ended
  before it refreshed. It now follows the chat's session from eve's store and refetches on every new
  session event; `trace-panel.json` `open-panel-follows-first-message` covers it.

## When a ticket adds UI

1. Drive it by hand once in a fresh run: `snapshot`, then `locate` each handle you need.
2. Add its scenarios to the matching suite (or a new `verification/suites/FEATURE.json`) with an
   assertion after every action and `api` world-state checks where the change touches the backend.
3. Fill in its row here: entry, handles, recipe and the last live result with the PR.
4. If a new API route is needed for world state, add it to `packages/client` first, then to
   `tools/verify/src/world-api.ts`.
