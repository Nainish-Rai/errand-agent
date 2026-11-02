import type { ApiClient } from "@errand/client";
import type { GetSessionTraceResponse } from "@errand/contracts";

const SETTLE_TIMEOUT_MS = 5_000;
const POLL_MS = 100;

/** Trace writes run beside the turn, so the last span can land a moment after the reply. */
export async function settledTrace(api: ApiClient, sessionId: string): Promise<GetSessionTraceResponse> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let trace = await api.getSessionTrace(sessionId);
  while (Date.now() < deadline && (trace.spans.length === 0 || trace.spans.some((span) => span.status === "running"))) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    trace = await api.getSessionTrace(sessionId);
  }
  return trace;
}
