import { equals } from "eve/evals/expect";

import { tracedRuns } from "../../run-outcomes";
import { defineScenario } from "../../scenario";
import { settledTrace } from "../../session-trace";

// SPEC "turn and tool-call limit exhaustion", the tool-call half. The same never-ending model,
// with plenty of turns but three tool calls: three run, the fourth is refused before it reaches
// the tool, and the run ends budget_exhausted with the outcome's message as the reply.

const TOOL_CALLS = 3;

export default defineScenario({
  id: "scenarios/budget/tool-call-limit",
  description: "A model that loops forever stops at the tool-call cap, and the person sees the budget-exhausted message.",
  world: { scenario: "default", seed: 42 },
  runLimits: { modelTurns: 50, toolCalls: TOOL_CALLS },
  user: [{ say: "find a plumber in Koramangala this week" }],
  model: { turns: [{ steps: [{ toolCalls: [{ name: "get_errand", input: {} }] }], loop: true }] },
  expected: `exactly ${TOOL_CALLS} tool calls run, the next is refused; outcome budget_exhausted (tool_calls); the reply is the outcome's message`,
  actual(run) {
    return `${run.toolCalls.length} tool calls; reply: ${run.turns[0]?.reply.slice(0, 60) ?? "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    const [traced] = await tracedRuns(run.operatorApi, run.sessionId);
    const outcome = traced?.outcomes[0];
    await t.require(outcome !== undefined, equals(true));
    t.check(outcome?.kind, equals("budget_exhausted")).label("the run ends budget_exhausted");
    t.check(outcome?.limit, equals("tool_calls")).label("on the tool-call limit");

    const trace = await settledTrace(run.operatorApi, run.sessionId);
    t.check(trace.totals.toolCalls, equals(TOOL_CALLS)).label("exactly the cap's tool calls run");
    t.check(run.toolCalls.length, equals(TOOL_CALLS)).label("and the chat shows no more");

    const reply = run.turns[0]?.reply ?? "";
    t.check(outcome !== undefined && outcome.message !== "" && reply.endsWith(outcome.message), equals(true)).label(
      "the person sees the outcome's message",
    );
  },
});
