import { equals } from "eve/evals/expect";

import { THIS_WEEK } from "../../errand-checks";
import { askUi } from "../../generated-ui-conversation";
import { generatedUiCalls } from "../../generated-ui-checks";
import { defineScenario } from "../../scenario";

// The missing-details form: "a plumber in Koramangala" misses only when, so the agent asks with an
// AskForm of that one field. The person fills it and sends it; the answer is an ordinary message
// ("When: This week") and the errand fills in from it, then the search runs.

export default defineScenario({
  id: "scenarios/generated-ui/ask-form-fills-the-errand",
  description: "A request missing only the time window gets an ask form with just that field; sending it fills the errand.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: "I need a plumber in Koramangala" }, { ask: { timeWindow: "This week", area: "Indiranagar" } }],
  goal:
    "You need a plumber in Koramangala; your first message says only that, not when. When the assistant asks when, " +
    "answer this week. Don't book anything; once you have seen some options you are done.",
  maxSimulatedMessages: 2,
  model: {
    turns: [
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { service: "plumber", area: "Koramangala" } }] },
          askUi(["root = Stack([form])", 'form = AskForm(["timeWindow"], "When should the plumber come?")']),
          { text: "When should the plumber come?" },
        ],
      },
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { time_window: THIS_WEEK } }] },
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } }] },
          { text: "Here are the best match, the cheapest and the earliest plumber in Koramangala this week." },
        ],
      },
    ],
  },
  expected:
    "turn 1 asks with an AskForm of only timeWindow (verdict asked); the scripted form sends only that field as an ordinary message; the errand ends with the time window filled, nothing missing, area unchanged, choosing",
  async expect(t, run) {
    t.succeeded();
    const asks = generatedUiCalls(run.turns).filter((call) => call.tool === "ask_ui");
    await t.require(asks.map((call) => call.verdict.kind), equals(["asked"]));
    t.check(asks[0]?.turn, equals(1)).label("asked in the first turn");

    // The form only showed (and sent) the missing field: the area it was also given is not sent.
    // A simulated user types its answer instead (it can't tap), so this holds for the scripted form.
    if (run.steps.some((step) => "ask" in step)) {
      t.check(run.uiTaps.map((tap) => tap.sent), equals(["When: This week"])).label("the form sends only the missing field");
    }

    const errand = await run.api.getErrand(run.sessionId);
    t.check({ from: errand?.timeWindow?.from, to: errand?.timeWindow?.to }, equals(THIS_WEEK));
    t.check(errand?.area, equals("Koramangala")).label("the area is unchanged");
    t.check(errand?.missing, equals([]));
    t.check(errand?.state, equals("choosing"));
  },
});
