import { ApiClient, ChatClient } from "@errand/client";
import { defineEval } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";

import { settledTrace } from "../session-trace";

// A run leaves a trace with every span kind the trace panel draws: the turn (`invoke_agent`), its
// model runs (`agent.step`), the model calls (`chat`, with tokens and cost) and the tool call
// (`execute_tool`, with its arguments and result). Read through the same client the web app uses.

interface SearchArguments {
  readonly service?: string;
  readonly area?: string;
}

export default defineEval({
  description: "A run writes a trace with turn, step, model and tool spans, tokens, latency and cost.",
  async test(t) {
    const api = new ApiClient({ baseUrl: t.target.url });
    const chat = new ChatClient({ baseUrl: t.target.url });

    await api.switchScenario({ scenario: "default", seed: 42 });
    // The backend serves every eval in turn; a script an earlier scenario loaded must not answer here.
    await api.loadModelScript({ script: null });
    const turn = await chat.sendFirstMessage("find a plumber in Koramangala this week", { signal: t.abortSignal });
    const session = t.target.attach(turn.sessionId, { startIndex: 0 });
    await session.nextTurn();
    t.succeeded();

    const trace = await settledTrace(api, turn.sessionId);
    const kinds = [...new Set(trace.spans.map((span) => span.kind))].sort();
    await t.require(kinds, equals(["agent", "model", "step", "tool"]));
    t.check(trace.spans.every((span) => span.status === "ok" && span.durationMs !== undefined), equals(true));

    const agent = trace.spans.find((span) => span.kind === "agent");
    t.check(agent?.attributes["gen_ai.operation.name"], equals("invoke_agent"));
    t.check(agent?.attributes["gen_ai.conversation.id"], equals(turn.sessionId));

    const models = trace.spans.filter((span) => span.kind === "model");
    t.check(
      models.every(
        (span) =>
          span.name.startsWith("chat ") &&
          typeof span.attributes["gen_ai.usage.input_tokens"] === "number" &&
          typeof span.attributes["gen_ai.usage.output_tokens"] === "number" &&
          typeof span.attributes["errand.cost.usd"] === "number" &&
          span.attributes["errand.cost.source"] === "price_table",
      ),
      equals(true),
    );
    t.check(trace.totals.modelCalls, satisfies((count: number) => count >= 2, "at least two model calls"));

    const tool = trace.spans.find((span) => span.kind === "tool");
    t.check(tool?.name, equals("execute_tool search_providers"));
    t.check(
      tool?.attributes["gen_ai.tool.call.arguments"],
      satisfies(
        (args: SearchArguments | undefined) => args?.service === "plumber" && args.area === "Koramangala",
        "the search's arguments",
      ),
    );
    t.check(
      tool?.attributes["gen_ai.tool.call.result"],
      satisfies((result: { kind?: string } | undefined) => result?.kind === "found", "the search's result"),
    );

    // Every span hangs off the turn, through its step.
    const ids = new Set(trace.spans.map((span) => span.spanId));
    t.check(
      trace.spans.every((span) => span.kind === "agent" || (span.parentSpanId !== undefined && ids.has(span.parentSpanId))),
      equals(true),
    );
  },
});
