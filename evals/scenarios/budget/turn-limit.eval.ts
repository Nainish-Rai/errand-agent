import { equals } from "eve/evals/expect";

import { tracedRuns } from "../../run-outcomes";
import { defineScenario } from "../../scenario";
import { settledTrace } from "../../session-trace";

// SPEC "turn and tool-call limit exhaustion", the turn half. The scripted model never stops: every
// step reads the errand again. With four model turns, three of its tool calls run, the fourth
// turn's call is refused (no turn would be left to read its result), and the run ends
// budget_exhausted with the outcome's message as the reply.

const MODEL_TURNS = 4;

export default defineScenario({
  id: "scenarios/budget/turn-limit",
  description: "A model that loops forever stops at the model-turn cap, and the person sees the budget-exhausted message.",
  world: { scenario: "default", seed: 42 },
  runLimits: { modelTurns: MODEL_TURNS },
  user: [{ say: "find a plumber in Koramangala this week" }],
  model: { turns: [{ steps: [{ toolCalls: [{ name: "get_errand", input: {} }] }], loop: true }] },
  expected: `the run stops after ${MODEL_TURNS} model calls and ${MODEL_TURNS - 1} tool calls; outcome budget_exhausted (model_turns); the reply is the outcome's message`,
  actual(run) {
    return `${run.toolCalls.length} tool calls; reply: ${run.turns[0]?.reply.slice(0, 60) ?? "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    const [traced] = await tracedRuns(run.api, run.sessionId);
    const outcome = traced?.outcomes[0];
    await t.require(outcome !== undefined, equals(true));
    t.check(outcome?.kind, equals("budget_exhausted")).label("the run ends budget_exhausted");
    t.check(outcome?.limit, equals("model_turns")).label("on the model-turn limit");

    const trace = await settledTrace(run.api, run.sessionId);
    t.check(trace.totals.modelCalls, equals(MODEL_TURNS)).label("the model is called exactly up to the cap");
    t.check(trace.totals.toolCalls, equals(MODEL_TURNS - 1)).label("no tool call runs on the last turn");

    const reply = run.turns[0]?.reply ?? "";
    t.check(outcome !== undefined && outcome.message !== "" && reply.endsWith(outcome.message), equals(true)).label(
      "the person sees the outcome's message",
    );
  },
});
