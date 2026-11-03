import { equals, satisfies } from "eve/evals/expect";

import { THIS_WEEK } from "../../errand-checks";
import { tracedRuns } from "../../run-outcomes";
import { defineScenario } from "../../scenario";
import { settledTrace } from "../../session-trace";

// SPEC "wall-clock timeout". The world's search is made slow (a dev-only fault, never on a
// production path): it would take 20 s, and the run may take 1.5 s. The search call stops waiting
// at the deadline, the next model call ends the run budget_exhausted, and the person sees why
// well before the search would have answered.

const WALL_CLOCK_MS = 1_500;
const SEARCH_DELAY_MS = 20_000;
/** Time for the model call after the deadline and for the reply to land. */
const SLACK_MS = 2_500;

export default defineScenario({
  id: "scenarios/budget/wall-clock-timeout",
  description: "A slow tool stops the run within its wall-clock deadline, and the person sees the budget-exhausted message.",
  world: { scenario: "default", seed: 42 },
  runLimits: { wallClockMs: WALL_CLOCK_MS },
  worldFault: { kind: "slow", operation: "searchProviders", delayMs: SEARCH_DELAY_MS },
  user: [{ say: "find a plumber in Koramangala this week" }],
  model: {
    turns: [
      {
        steps: [
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } }] },
          { text: "Here are the plumbers in Koramangala with free slots this week." },
        ],
      },
    ],
  },
  expected: `the slow search is cut off at the ${WALL_CLOCK_MS} ms deadline; the run ends budget_exhausted (wall_clock) within ${WALL_CLOCK_MS + SLACK_MS} ms; the reply is the outcome's message`,
  actual(run) {
    return `${run.toolCalls.map((call) => `${call.name} ${call.state}`).join(", ")}; reply: ${run.turns[0]?.reply.slice(0, 60) ?? "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    const [traced] = await tracedRuns(run.api, run.sessionId);
    const outcome = traced?.outcomes[0];
    await t.require(outcome !== undefined, equals(true));
    t.check(outcome?.kind, equals("budget_exhausted")).label("the run ends budget_exhausted");
    t.check(outcome?.limit, equals("wall_clock")).label("on the wall-clock limit");
    t.check(
      traced?.durationMs,
      satisfies((ms: number | undefined) => ms !== undefined && ms < WALL_CLOCK_MS + SLACK_MS, `under ${WALL_CLOCK_MS + SLACK_MS} ms`),
    ).label("the run ends within the deadline, not when the slow search would have answered");

    const trace = await settledTrace(run.api, run.sessionId);
    const search = trace.spans.find((span) => span.name === "execute_tool search_providers");
    t.check(search?.status, equals("error")).label("the search call was cut off");

    const reply = run.turns[0]?.reply ?? "";
    t.check(outcome !== undefined && outcome.message !== "" && reply.endsWith(outcome.message), equals(true)).label(
      "the person sees the outcome's message",
    );
  },
});
