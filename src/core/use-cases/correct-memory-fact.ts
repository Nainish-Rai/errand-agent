import {
  closed,
  currentFact,
  normalizedValue,
  trustOf,
  type InvalidValueReason,
  type MemoryEvidence,
  type MemoryFact,
  type MemoryKey,
  type UntrustedSourceReason,
} from "../memory/memory-fact";
import type { MemoryDependencies } from "./memory-session";

// "Actually my area is HSR": the remembered fact is superseded, never edited. Its validity window
// closes now, and a new explicit fact opens one that names the fact it replaced.

export interface CorrectMemoryFactRequest {
  readonly ownerId: string;
  readonly key: MemoryKey;
  readonly value: string;
  readonly evidence: MemoryEvidence;
}

export type CorrectMemoryFactOutcome =
  | { readonly kind: "corrected"; readonly fact: MemoryFact; readonly previous: MemoryFact }
  /** The new value is the one already remembered (and in use). */
  | { readonly kind: "unchanged"; readonly fact: MemoryFact }
  /** Nothing is remembered for the key; remember it instead. */
  | { readonly kind: "not_found"; readonly key: MemoryKey }
  | { readonly kind: "untrusted_source"; readonly reason: UntrustedSourceReason }
  | { readonly kind: "invalid_value"; readonly reason: InvalidValueReason };

export function correctMemoryFact(deps: MemoryDependencies, request: CorrectMemoryFactRequest): Promise<CorrectMemoryFactOutcome> {
  // A correction is the person stating the value, so it is held to the explicit rule.
  const trust = trustOf(request.evidence, request.value, "explicit");
  if (trust.kind === "untrusted") return Promise.resolve({ kind: "untrusted_source", reason: trust.reason });
  const normalized = normalizedValue(request.key, request.value, (text) => deps.catalog.resolveArea(text));
  if (normalized.kind === "invalid_value") return Promise.resolve(normalized);

  return deps.memory.change<CorrectMemoryFactOutcome>(request.ownerId, (memory) => {
    const previous = currentFact(memory, request.key);
    if (previous === undefined) return { save: [], tombstones: [], result: { kind: "not_found", key: request.key } };
    if (previous.value === normalized.value && previous.status === "active") {
      return { save: [], tombstones: [], result: { kind: "unchanged", fact: previous } };
    }
    const atMs = deps.clock.now().getTime();
    const fact: MemoryFact = {
      id: deps.memory.newFactId(),
      ownerId: request.ownerId,
      key: request.key,
      value: normalized.value,
      source: "explicit",
      status: "active",
      evidence: trust.evidence,
      validFromMs: atMs,
      supersedes: previous.id,
    };
    return {
      save: [closed(previous, "superseded", atMs, fact.id), fact],
      tombstones: [],
      result: { kind: "corrected", fact, previous },
    };
  });
}
