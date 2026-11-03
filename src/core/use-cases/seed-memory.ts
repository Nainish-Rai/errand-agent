import type { FactSource, FactStatus, MemoryFact, MemoryKey, Tombstone } from "../memory/memory-fact";
import type { MemoryDependencies } from "./memory-session";

// Dev only: replaces what is remembered about the person with a known set, so each eval scenario
// starts from the memory it declares (none by default) and ticket 12 can seed 50+ facts.

export interface SeedFact {
  readonly key: MemoryKey;
  readonly value: string;
  readonly source: FactSource;
  readonly status: FactStatus;
  /** How long ago, in days, the fact was recorded (default 0: now). */
  readonly ageDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

export async function seedMemory(
  deps: MemoryDependencies,
  request: { readonly ownerId: string; readonly facts: readonly SeedFact[] },
): Promise<{ readonly facts: number; readonly tombstones: number }> {
  const nowMs = deps.clock.now().getTime();
  const evidence = { kind: "user_action", action: "seed" } as const;
  const facts: MemoryFact[] = request.facts.map((seed) => {
    const validFromMs = nowMs - (seed.ageDays ?? 0) * DAY_MS;
    const closes = seed.status === "superseded" || seed.status === "forgotten";
    return {
      id: deps.memory.newFactId(),
      ownerId: request.ownerId,
      key: seed.key,
      value: seed.value,
      source: seed.source,
      status: seed.status,
      evidence,
      validFromMs,
      ...(closes ? { validToMs: nowMs } : {}),
    };
  });
  const forgottenKeys = [...new Set(facts.filter((fact) => fact.status === "forgotten").map((fact) => fact.key))];
  const tombstones: Tombstone[] = forgottenKeys.map((key) => ({ ownerId: request.ownerId, key, forgottenAtMs: nowMs, evidence }));
  await deps.memory.replace(request.ownerId, { facts, tombstones });
  return { facts: facts.length, tombstones: tombstones.length };
}
