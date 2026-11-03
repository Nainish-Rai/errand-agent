import type { ContextFact, GetSessionContextResponse } from "@errand/contracts";

import { isMemoryKey } from "../../src/core/memory/memory-fact";
import type { LoggedFact, SessionContext } from "../../src/core/use-cases/get-session-context";
import { displayOf, labelOf } from "./memory-presenter";

// Core's context log to the wire shape of GET /api/v1/sessions/:sessionId/context. Facts get the
// same label and display value the Memory panel shows.

function presentFact(fact: LoggedFact): ContextFact {
  const known = isMemoryKey(fact.key);
  return {
    ...fact,
    label: known ? labelOf(fact.key) : fact.key,
    display: known ? displayOf(fact.key, fact.value) : fact.value,
  };
}

export function presentSessionContext(context: SessionContext): GetSessionContextResponse {
  return {
    sessionId: context.sessionId,
    calls: context.calls.map((call) => ({
      ...call,
      split: { ...call.split },
      tokens: { ...call.tokens },
      instructions: call.instructions.map((block) => ({ ...block })),
      memory: {
        text: call.memory.text,
        included: call.memory.included.map(presentFact),
        excluded: call.memory.excluded.map(presentFact),
        nowMs: call.memory.nowMs,
      },
      history: {
        kept: call.history.kept.map((message) => ({ ...message })),
        dropped: call.history.dropped.map((message) => ({ ...message })),
        summary: call.history.summary,
      },
    })),
  };
}
