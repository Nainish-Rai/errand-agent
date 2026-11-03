# OpenUI with eve: spike result (ticket 17)

## Question

Can the agent draw interface through OpenUI (`@openuidev/lang-core`, `@openuidev/react-lang`,
`@openuidev/assistant-ui`) on top of eve's chat, without giving the model a way to book, approve or
show a number the world didn't give?

## Answer: yes, through two server-side tools and a client binder

- **Two eve tools, server-side.** `present_ui` and `ask_ui` (`agent/tools/`) take one argument,
  `{ ui }`, an OpenUI Lang program. They run on the backend like every other tool, so their result is
  in eve's history, the trace and every client (web, evals, a future mobile app) the same way.
  OpenUI's own "the client renders a tool call" path was not used: it would make the drawing a
  client-only fact, invisible to evals and the trace.
- **Core judges every program.** The adapter `src/adapters/generated-ui/openui-lang-reader.ts` parses
  the program with OpenUI's parser against our library's JSON Schema; core
  (`src/core/generated-ui/`) then judges the parsed tree with the library rules: a component outside
  the library, an approval word on a tappable option (`Approve`, `Book it`, `Confirm` …), an action
  expression (`@…(`, `Mutation(`, `Query(`, `$var`), a provider id the errand's search didn't return,
  or a fact id that isn't one of the person's unconfirmed inferred facts is refused. The tool returns
  `shown`, `asked`, `unreadable` (with the parse errors) or `refused` (with the problems), and a
  `generated_ui` trace event records the verdict and errors.
- **The client binds, the model only points.** The web app renders a drawn program with
  `OpenUIContent` from `@openuidev/assistant-ui` and our react-lang library
  (`apps/web/features/generated-ui/`). Components take ids and wording only: a card's name, price,
  rating, photo and slots, a chart's numbers and a review insight are read from the backend by id
  (`packages/client/src/generated-ui/bind.ts`), so a model that writes "₹99" in a highlight still
  shows the world's ₹399 (the binder hides model text that states a fact).
- **No commit path.** No component has an action. Choose, form Send, chip taps and Keep / Don't keep
  each send an ordinary user message as the person; the agent then holds a slot and shows the fixed
  approval card, which stays the only Approve button. An `ask_ui` answer is a plain message too:
  OpenUI's `addResult` is not used, so a tap can't impersonate a tool result.
- **Text fallback.** An unreadable or refused program is not drawn; the tool result tells the model
  to say it in text, and the chat shows one muted line where the part would have been. The parse
  error stays in the trace.

## Integration notes

- **Parser shape.** Nested elements stay AST nodes `{ type: "element", typeName, props }`; the
  binder and the eval tap helpers walk them. Chips render as `role=option` inside a listbox.
- **Devtools.** `@openuidev/react-lang` auto-mounts its devtools in development and loads a script
  from cdn.jsdelivr.net, which the verify network guard blocks.
  `apps/web/features/generated-ui/no-devtools.ts` sets
  `globalThis[Symbol.for("openui.devtools.autoMount")] = true` before react-lang loads.
- **Theme.** OpenUI's theme variables are mapped to our semantic tokens and type scale
  (`openui-theme.ts`), dark and light. Our components use semantic token classes only.
- **Telemetry.** Nothing from OpenUI calls out at runtime once the devtools are off; the browser
  suites run with the network guard on.

## Cost in the context budget

The generated-UI instructions (`library.prompt()` plus our rules) are a system message, so ticket
12's budget counts them in the instructions share (24,000 tokens):

| Measure | Value |
| --- | --- |
| Characters | 5,623 |
| Budget estimate (UTF-8 bytes / 2) | 2,833 tokens, 11.8% of the instructions share |
| MiniMax-M3 measured (input with minus input without) | 1,254 tokens |

`scenarios/memory/context-budget` and `verification/suites/context-budget.json` pass with them in.

## Live parse rate (MiniMax-M3)

From the eval table's live section (`pnpm eval:live`, k = 2, the three generated-UI scenarios with a
live recording): 7 of 7 generated-UI payloads parsed and drawn on the last run, and 5 of 5 from the
recorded payloads in replay. MiniMax wrote valid OpenUI Lang from the library prompt alone; the
things it did wrong were facts in highlights (hidden by the binder) and re-presenting the search's
cards (the chat drops a repeat of providers the same reply's search already shows).
