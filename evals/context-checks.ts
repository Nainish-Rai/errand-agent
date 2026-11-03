import type { ListMemoryResponse, MemoryFactView, ModelCallContext } from "@errand/contracts";

import type { ScenarioRun } from "./scenario-run";
import { settledTrace } from "./session-trace";

// Reads the context log (GET /api/v1/sessions/:id/context): what every model call was sent against
// the context budget. The global invariant "no forgotten or unconfirmed-inferred fact in any logged
// context" checks it against the memory the API serves, not against what the log says about itself.

/** Every model call's logged context in the run, oldest first, after each session's trace settles. */
export async function modelContextsOf(run: Pick<ScenarioRun, "operatorApi" | "sessionIds">): Promise<ModelCallContext[]> {
  const calls: ModelCallContext[] = [];
  for (const sessionId of run.sessionIds) {
    await settledTrace(run.operatorApi, sessionId);
    calls.push(...(await run.operatorApi.getSessionContext(sessionId)).calls);
  }
  return calls;
}

function msOf(iso: string | null): number | undefined {
  return iso === null ? undefined : Date.parse(iso);
}

/**
 * Whether the fact could be used at `nowMs` (the memory clock's time the call's facts were filtered
 * at): inside its validity window (so not yet superseded or forgotten), and explicit or confirmed
 * by then. Read from the stored fact's own timestamps, so a fact forgotten later in the run still
 * counts as usable for the turns before.
 */
export function wasUsableAt(fact: MemoryFactView, nowMs: number): boolean {
  const from = msOf(fact.validFrom) ?? Number.POSITIVE_INFINITY;
  const to = msOf(fact.validTo) ?? Number.POSITIVE_INFINITY;
  const confirmed = fact.source === "explicit" || (msOf(fact.confirmedAt) ?? Number.POSITIVE_INFINITY) <= nowMs;
  return from <= nowMs && nowMs < to && confirmed;
}

/** What breaks the invariant in one call: facts it carried that it shouldn't have, by id and by the words sent. */
export function leaksIn(call: ModelCallContext, memory: ListMemoryResponse): string[] {
  const where = `call ${call.spanId ?? call.eventId}`;
  if (call.memory.text === "") return [];
  const { nowMs } = call.memory;
  if (nowMs === null) return [`${where} sent memory text with no logged selection`];
  const byId = new Map(memory.facts.map((fact) => [fact.id, fact]));
  const problems = call.memory.included.flatMap((logged) => {
    const fact = byId.get(logged.id);
    if (fact === undefined) return [`${where} included ${logged.id}, which memory doesn't have`];
    return wasUsableAt(fact, nowMs) ? [] : [`${where} included ${fact.key} "${fact.display}" (${fact.status}, ${fact.source})`];
  });
  // The words sent: a fact that wasn't usable must not appear in the memory text, unless a usable
  // fact that was included says the same thing.
  const includedDisplays = new Set(
    call.memory.included.flatMap((logged) => {
      const fact = byId.get(logged.id);
      return fact === undefined ? [] : [fact.display];
    }),
  );
  const inText = memory.facts.filter(
    (fact) => !wasUsableAt(fact, nowMs) && !includedDisplays.has(fact.display) && call.memory.text.includes(`: ${fact.display} (`),
  );
  return [...problems, ...inText.map((fact) => `${where} sent the words of ${fact.key} "${fact.display}" (${fact.status}, ${fact.source})`)];
}

const SHOWN_PROBLEMS = 3;

/** Every leak in the run, the first few spelled out, so the eval table's note stays readable. */
export async function factsLeakedIntoContext(run: Pick<ScenarioRun, "api" | "operatorApi" | "sessionIds">): Promise<string[]> {
  const memory = await run.api.listMemory();
  const problems = (await modelContextsOf(run)).flatMap((call) => leaksIn(call, memory));
  if (problems.length <= SHOWN_PROBLEMS) return problems;
  return [...problems.slice(0, SHOWN_PROBLEMS), `${problems.length - SHOWN_PROBLEMS} more`];
}
