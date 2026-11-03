import type { GetSessionContextResponse } from "@errand/contracts";

import type { SessionContext } from "../../src/core/use-cases/get-session-context";

// Core's context log to the wire shape of GET /api/v1/sessions/:sessionId/context.

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
        included: call.memory.included.map((fact) => ({ ...fact })),
        excluded: call.memory.excluded.map((fact) => ({ ...fact })),
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
