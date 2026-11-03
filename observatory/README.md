# Observatory

A single-file HTML dashboard of the errand agent's runs: sessions, turns, model and tool spans,
tokens, latency, errors, retries and cost. The same dashboard renders the Claude Code sessions that
built this repo, with prompts redacted.

```bash
pnpm eval                                   # or any local session; both write traces/
pnpm observatory                            # traces/ -> observatory/out/dashboard.html
pnpm observatory --traces <dir>             # another run's trace directory (repeatable)
pnpm observatory --fixtures                 # add the failure fixtures below
pnpm observatory --claude-sessions          # add this repo's Claude Code build sessions, then check redaction
pnpm observatory --claude-sessions --claude-match errand-agent   # only folders whose name contains this
pnpm observatory --out observatory/out/x.html
```

The command prints the path of the dashboard. It opens offline: no web fonts, no network requests.

## Where it came from

Copied from [Nainish-Rai/harness-observatory](https://github.com/Nainish-Rai/harness-observatory)
at commit `5416d928eefdf79ca101468f93df53fe6a13b67b`, MIT licensed ([LICENSE](LICENSE)). The first
commit on this folder is the verbatim copy, so `git log -p -- observatory/` shows every change.

| File | Original | What changed |
|---|---|---|
| `harness_summary.py` | `skills/harness-observatory/scripts/harness_summary.py` | New errand-agent source; Claude Code limited to this repo's folders; Codex opt-in; cost; LLM failures, LLM retries, verification and trace events |
| `dashboard.template.html` | `skills/harness-observatory/assets/dashboard.template.html` | Errand-agent tool, cost tile and columns, retry and verify marks, event spans; no Google Fonts; small layout fixes |
| `render_dashboard.py` | `skills/harness-observatory/scripts/render_dashboard.py` | Template path only |
| `check_tokens.py` | `skills/harness-observatory/scripts/check_tokens.py` | Unchanged |
| `check_redaction.py`, `test_harness_summary.py`, `fixtures/` | new | |

The look comes from observatory-ui, the original author's design system. The template already
carries its tokens and styles inline, so nothing is loaded from it.

## Sources

| Source | Read from | Shown |
|---|---|---|
| Errand agent | `traces/*.jsonl` (`errand.trace/1`, or `--traces DIR`) | Each root session is one row. A subagent's spans (other `sessionId`, same `traceId`) form a subagent run inside its parent. `invoke_agent` spans are turns, `chat` spans are LLM calls (tokens, latency, `errand.cost.usd`) and `execute_tool` spans are tool calls. `state_transition` and `context` events show as event marks |
| Claude Code (`--claude-sessions`) | `~/.claude/projects/` folders whose names contain `errand-agent` or `larp-about-https-www-orangeinvest` | As in the original: sessions, turns, tools, tokens and subagents. Cost is `not logged` |
| Codex (`--codex`) | `~/.codex/sessions` | As in the original. Off by default |

The trace reader keeps the latest finished record of each `spanId`; a late `running` record never
reopens a span. This is the rule `src/core/use-cases/get-session-trace.ts` applies.

**Cost.** Cost is shown per LLM call, per session and in total, with its source.
`price_table` is the MiniMax estimate from `src/adapters/tracing/prices.json`. `provider_reported`
is the cost the Claude Code CLI reports (the review reader and the simulated user). The offline
evals use the free scripted model, so their cost is $0.00.

**Failures and retries.** A tool call fails when its span has status `error`. It also fails when
the tool returns a transient failure as a value (`kind` `timeout` or `service_unavailable`). A
failed call that is followed, within the next three calls, by the same tool with the same input or
the same idempotency key marks that later call as a retry (↻). A status check after a timeout is
marked verify (✓). A failed LLM call followed by another LLM call is an LLM retry.

**Scenario names.** The traces carry no eval scenario id yet, so each eval run is titled by its
turns and tool calls (for example `2 turns · search_providers`). Fixing this takes a scenario
attribute on the turn span, in `agent/` or `evals/`.

## Fixtures

`fixtures/` holds two sessions in the exact `errand.trace/1` format that
`agent/instrumentation/run-trace.ts` writes. Each span has a start record and an end record, and
the files use the same ids and attributes. `fixtures/make_fixtures.py` regenerates them.

- `cancel503-fixture`: cancel fails with a 503 (`service_unavailable`). The same idempotency key
  is retried and succeeds, and `list_bookings` confirms the cancellation.
- `booktimeout-fixture`: the first MiniMax call fails as overloaded and is retried. A review-reader
  subagent runs on the Claude Code CLI with a CLI-reported cost. `book` times out after
  succeeding, and `get_booking_status` verifies the booking.

Real runs don't produce these sequences yet: cancel and the booking path land in tickets 10 and 07.
Once they do, `pnpm observatory` after `pnpm eval` shows the same failed, retried and verified spans
from real traces. The fixture tool names follow the mock world's eight operations. If tickets 07
and 10 name the spans differently (say, `execute_proposal`), retries still match on the
idempotency key.

## Privacy and git

- Errand traces are sanitised when they are written. The dashboard embeds no prompt, argument or
  result text from them: only names, timings, tokens, errors and cost.
- Claude Code prompts are redacted the way the original does it: at most 10 words, with keys,
  paths, URLs, emails, mentions and long ids stripped (`snippet()`). Titles are snippets too. With
  `--claude-sessions`, `check_redaction.py` runs after rendering. It reads every human prompt and
  subagent brief in the raw transcripts. It fails if a full prompt, any 6-word run past a prompt's
  snippet, a snippet over 10 words, the home path or an email is in the HTML. It prints counts,
  never text.
- `observatory/out/` is ignored by git. Generated dashboards and summaries stay out of the repo.
  The one exception is the dashboard committed for the submission (ticket 16); see below.

## For the submission (ticket 16)

Commit one dashboard as the AI-assistant transcript deliverable:

```bash
pnpm eval && pnpm observatory --fixtures --claude-sessions --out observatory/out/submission.html
# read the redaction line it prints (0 leaked), open the file and check it, then:
mkdir -p docs/deliverables && cp observatory/out/submission.html docs/deliverables/observatory.html
```

Copy it out of `observatory/out/` instead of un-ignoring it, so no other generated file can slip in.
Check the session titles before committing. The matching folders also hold the interview-research
sessions (their titles are AI-written snippets). To drop them, pass `--claude-match <text>` with
narrower folder names.

## Checks

`pnpm check:observatory` runs the token lint on the template and the analyzer tests (stdlib
`unittest`). `pnpm check` includes it.
