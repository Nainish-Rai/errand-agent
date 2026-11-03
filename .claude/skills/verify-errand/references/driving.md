# Driving the page

The daemon keeps one root page; every CLI call drives that same page, in order, one at a time.

```sh
V="pnpm -s verify --run $RUN"
$V goto /chat                                               # or / (home), /design
$V locate --role textbox --name "Message the errand agent" --operation fill
$V fill --role textbox --name "Message the errand agent" --value "find a plumber in Koramangala this week"
$V key Enter
$V assert --role region --name "Search results for plumber in Koramangala" --text "8 plumber in Koramangala"
$V count 'role=region[name="Search results for plumber in Koramangala"] >> role=listitem'
$V api GET /api/v1/sessions/current/trace --expect '{"path":"totals.toolCalls","equals":1}'
$V screenshot results.png --viewport
```

## Commands

| Command | What it does |
| --- | --- |
| `goto /ROUTE`, `reload` | navigate within the run's web app (only its own origin) |
| `click`, `hover TARGET` | act on exactly one element (an ambiguous match fails); `click --clicks 2` double-clicks |
| `fill TARGET --value TEXT` | replace a field's value |
| `type TEXT`, `key KEY` | type into the focused element; press `Enter`, `Escape`, `ControlOrMeta+A` … |
| `wait TARGET [--state visible\|hidden\|attached\|detached]` | wait for a state |
| `text TARGET`, `count TARGET` | read visible text (redacted) or count matches |
| `assert …` | a retrying expectation (below) |
| `locate TARGET [--operation click\|hover\|fill]` | match count, uniqueness, visibility, enabled, actionability and a ready suite step, without acting |
| `viewport desktop\|laptop\|tablet\|phone\|WxH` | 1440×900, 1280×800, 834×1112, 390×844 |
| `theme dark\|light` | the system color scheme the page sees (not the app's saved choice) |
| `screenshot`, `snapshot`, `network`, `logs`, `api` | evidence; see [evidence](evidence.md) |

Every command accepts `--timeout-ms MS` (default 15000).

## Targets

- `--role ROLE --name NAME`: the accessible name, exact. Prefer this.
- `--role ROLE --text PART`: part of the accessible name (outside `assert`).
- `--label LABEL` (exact), `--testid ID`, `--text TEXT` (visible text, substring).
- A positional `SELECTOR`: CSS (`html`, `body`) or a Playwright selector
  (`role=tree[name="Steps"] >> role=treeitem[name*="search_providers tool"]`, `text=…`). With
  `--role`/`--label`/`--testid`/`--text` it scopes the lookup.
- `--nth N` picks one of several; tie it to observed content with an assertion first.

## Assertions

`assert TARGET` plus one or more of `--text T` (contains, whitespace-normalised; in `assert`,
`--text` is the expectation, not the target), `--value V`, `--count N` (0 allowed), `--attr
name=value` (`disabled=` for a present boolean attribute), `--state visible|hidden|attached|detached`.
`assert --url /ROUTE` checks the path. They retry until the timeout; the failure says what was
seen (`found 3, expected 8`, `text is "…"`).

## World state: `api`

`api GET|POST|PUT|PATCH|DELETE /api/v1/...` goes through `packages/client`, so the body is parsed
against the contracts. Known routes: `GET /providers?ids=`, `GET /providers/:id`,
`GET /sessions/:id/trace`, `GET /sessions/:id/context`, `GET /sessions/:id/errand`, `GET /sessions/:id/proposals`, `GET /proposals?status=`,
`GET /proposals/:id`, `GET /bookings`, `GET /action-intents`, `GET /sessions/:id/action-intents`, `GET /memory`, `PATCH /memory/:key`,
`DELETE /memory/:key`, `POST /memory/:id/confirm`, `POST /dev/scenario`, `PUT /dev/model-script`,
`PUT /dev/run-limits`, `PUT /dev/world-fault`, `POST /dev/world-events/provider-cancelled` (a provider cancels a booking; the agent handles the event), `PUT /dev/memory` (seed the person's memory), `GET /home` (the home summary), `POST /sessions/:id/errand` (draft the errand from the composer's chips). `sessions/current` is the chat session the page
opened (read from its `/eve/v1/session/…` requests). When a ticket adds a route to the client,
add it to `tools/verify/src/world-api.ts`.

`--expect` takes one object or a list: `{"path":"spans[*].name","includes":"execute_tool search_providers"}`,
`{"path":"totals.toolCalls","equals":1}`, `atLeast`, `length`. GET expectations retry; a write
(`POST`, `PUT`, `PATCH`, `DELETE`) is sent exactly once and never replayed.

```sh
$V api POST /api/v1/dev/scenario --body '{"scenario":"slot_taken","seed":42}'
```

## Stable handles (seen 2026-11-03)

- Chat `/`: heading `What do you need done?`; textbox `Message the errand agent`; button `Send`
  (disabled while empty); results region `Search results for SERVICE in AREA` with one `listitem`
  per provider; theme button `Switch to light theme` / `Switch to dark theme`.
- Trace panel: toggle button `Hide trace` / `Show trace` (`aria-pressed`); `complementary "Run trace"`
  with summary `N model calls · N tool calls · …`, close button `Close the trace`, `tree "Steps"`
  with `treeitem`s named `chat errand-script …` (model) and `search_providers tool …` (tool);
  region `Context log` with a `Turn N context` button and region per turn (ticket 12).
- Approval card in chat (ticket 05): region `Approve booking`, buttons `Approve ₹PRICE`, `Other options`,
  `Decline`; after Approve the card reads `Approved` and the receipt is region `Booked`.
- Approval invalidation (ticket 06): a voided card is `section[aria-label="Approve booking"]:has-text("voided")`
  with `Price changed ₹OLD → ₹NEW` / `Time changed …` and button `Review new price` / `Review new time`;
  an expired one `:has-text("Expired")`; the replaced card shows twice (in place, and beside the fresh card).
- `/design`: heading `Errand design system`; `html[data-theme]`; approval cards are
  `region "Approve booking" | "Approve cancellation" | "Approve reschedule"` (each state in both panels).

## When a drive goes wrong

| Observation | Next evidence | Boundary |
| --- | --- | --- |
| Missing or ambiguous target | `snapshot`, then `locate` | refine it; never take an arbitrary `--nth 0` |
| Assertion failed | `command-failure.json` and its screenshot | a product FAIL until proven otherwise; do not loosen the step |
| `network` lists `blocked` without `probe: true` | the step before it | something tried to leave the run; a finding |
| `sourceDiff: false` | `fingerprint` vs `status` | the checkout changed; relaunch |
| Launch failed | `launch-error.json`, `backend.log`, `web.log` | launch stops what it started; fix and use a new run ID |
| `Another command is driving this run` | — | one command at a time per run; wait or use another run |
