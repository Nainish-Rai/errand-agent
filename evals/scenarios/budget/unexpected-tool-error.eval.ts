import { equals } from "eve/evals/expect";

import { THIS_WEEK, tracedTransitions } from "../../errand-checks";
import { tracedRuns } from "../../run-outcomes";
import { defineScenario } from "../../scenario";
import { settledTrace } from "../../session-trace";

// SPEC "unexpected tool error". The world's search throws a TypeError (a dev-only fault): nothing
// any tool expects. The run must not carry on as if the search had answered: the next model call
// ends it failed, the errand moves to failed, the person gets the outcome's message, and nothing
// runs after the error, so no side effect is made.

export default defineScenario({
  id: "scenarios/budget/unexpected-tool-error",
  description: "A tool throws something unknown: the run ends failed with a message, the errand fails, and nothing else runs.",
  world: { scenario: "default", seed: 42 },
  worldFault: { kind: "throw", operation: "searchProviders" },
  user: [{ say: "find a plumber in Koramangala this week" }],
  model: {
    turns: [
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { service: "plumber", area: "Koramangala", time_window: THIS_WEEK } }] },
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } }] },
          // Never reached: the run stops before the model can try again.
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } }] },
          { text: "Here are the plumbers in Koramangala with free slots this week." },
        ],
      },
    ],
  },
  expected:
    "search_providers throws; the run ends failed (tool_error) with the outcome's message as the reply; " +
    "the errand goes gathering → failed; no tool runs after the error",
  actual(run) {
    return `${run.toolCalls.map((call) => `${call.name} ${call.state}`).join(", ")}; reply: ${run.turns[0]?.reply.slice(0, 60) ?? "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    const [traced] = await tracedRuns(run.api, run.sessionId);
    const outcome = traced?.outcomes[0];
    await t.require(outcome !== undefined, equals(true));
    t.check(outcome?.kind, equals("failed")).label("the run ends failed");
    t.check(outcome?.failureReason, equals("tool_error")).label("because a tool threw");

    const reply = run.turns[0]?.reply ?? "";
    t.check(outcome !== undefined && outcome.message !== "" && reply.endsWith(outcome.message), equals(true)).label(
      "the person sees the outcome's message",
    );

    // No side effect: the failed search is the last tool call, and the errand only ever failed.
    const trace = await settledTrace(run.api, run.sessionId);
    const tools = trace.spans.filter((span) => span.kind === "tool").map((span) => `${span.name} ${span.status}`);
    t.check(tools, equals(["execute_tool update_errand ok", "execute_tool search_providers error"])).label(
      "nothing runs after the error",
    );
    const errand = await run.api.getErrand(run.sessionId);
    t.check(errand?.state, equals("failed")).label("the errand is failed");
    const transitions = await tracedTransitions(run);
    t.check(transitions.inErrand, equals(["start → gathering", "gathering → failed"]));
    t.check(transitions.inTrace, equals(transitions.inErrand)).label("every transition is in the trace");
  },
});
