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
| Trace panel | 03 | `/`, the `Hide trace` / `Show trace` toggle, `Close the trace` | `complementary "Run trace"`, summary `N model calls · N tool calls`, `tree "Steps"`, `treeitem`s `chat errand-script …` and `search_providers tool …`; `api GET /api/v1/sessions/current/trace` | [trace-panel.json](../../../../verification/suites/trace-panel.json) | PASS, see the ticket 19 PR |
| Design system and theme | 18 | `/design`; theme toggle on `/` and `/design` | `html[data-theme]`, button `Switch to light theme` / `Switch to dark theme`, regions `Approve booking` / `Approve cancellation` / `Approve reschedule` | [design-system.json](../../../../verification/suites/design-system.json) | PASS, see the ticket 19 PR |
| Live chat (MiniMax) | 01 | `launch --live`, then a search on `/` | as chat search; the reply wording varies | by hand (see the ticket 19 PR) | PASS once, see the ticket 19 PR |
| Clarify errand and workflow state | 04 | `/`, an underspecified errand | to map: the clarifying question, quick-reply chips, the options tagged Best match / Cheapest / Earliest | none yet | NOT RUN (not built) |
| Approval card in chat | 05 | `/`, choose an option | to map: the in-chat `Approve booking` region, `Approve ₹PRICE`, `Other options`, `Decline`; `POST /api/v1/proposals/:id/approve` in `network`; the booking via `api` once the client has the route | none yet | NOT RUN (not built) |
| Home screen | 13 | to map: the home route | to map: hero, errand composer, widgets, both themes | none yet | NOT RUN (not built) |
| Generated UI in chat | 17 | `/`, a turn that renders OpenUI | to map: generated surfaces; prove none renders an approve button | none yet | NOT RUN (not built) |

## When a ticket adds UI

1. Drive it by hand once in a fresh run: `snapshot`, then `locate` each handle you need.
2. Add its scenarios to the matching suite (or a new `verification/suites/FEATURE.json`) with an
   assertion after every action and `api` world-state checks where the change touches the backend.
3. Fill in its row here: entry, handles, recipe and the last live result with the PR.
4. If a new API route is needed for world state, add it to `packages/client` first, then to
   `tools/verify/src/world-api.ts`.
