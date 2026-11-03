import { equals } from "eve/evals/expect";

import { ASK_FOR_PLUMBER, SEARCH_TURN } from "../../booking-conversation";
import { presentUi } from "../../generated-ui-conversation";
import { generatedUiCalls, tracedUiVerdicts } from "../../generated-ui-checks";
import { defineScenario } from "../../scenario";

// A program that doesn't parse is never drawn: present_ui says unreadable with the parse errors,
// the same errors are in the trace, and the agent answers in text.

export default defineScenario({
  id: "scenarios/generated-ui/malformed-ui-falls-back-to-text",
  description: "A generated UI program that doesn't parse is not drawn; the reply is text and the parse error is in the trace.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: "Which is the cheapest?" }],
  model: {
    turns: [
      SEARCH_TURN,
      {
        steps: [
          presentUi(["root = Stack([cards", 'cards = ProviderChoices([ProviderChoice("prv_plumber_koramangala_5", "Cheapest"']),
          { text: "The cheapest is Shiva Sanitary Solutions." },
        ],
      },
    ],
  },
  expected: "present_ui is unreadable with its parse errors; a generated_ui trace event holds them; the reply is text",
  async expect(t, run) {
    t.succeeded();
    const calls = generatedUiCalls(run.turns);
    await t.require(calls.map((call) => call.verdict.kind), equals(["unreadable"]));
    const verdict = calls[0]?.verdict;
    t.check(verdict?.kind === "unreadable" && verdict.errors.length > 0, equals(true)).label("the tool result names the parse errors");

    const traced = await tracedUiVerdicts(run.operatorApi, run.sessionId);
    t.check(traced.map((event) => event.verdict), equals(["unreadable"]));
    t.check(traced[0]?.errors.length !== 0, equals(true)).label("the parse errors are in the trace");
    t.check((run.turns.at(-1)?.reply ?? "").trim().length > 0, equals(true)).label("the reply is text");
  },
});
