import {
  currentFact,
  normalizedValue,
  tombstoneFor,
  trustOf,
  type FactSource,
  type InvalidValueReason,
  type MemoryEvidence,
  type MemoryFact,
  type MemoryKey,
  type UntrustedSourceReason,
} from "../memory/memory-fact";
import type { MemoryDependencies } from "./memory-session";

// Stores a new preference. An explicit one is used at once; an inferred one waits for the person to
// confirm it. Words from tool output are refused here, in core, whatever the model was told.

export interface RememberFactRequest {
  readonly ownerId: string;
  readonly key: MemoryKey;
  readonly value: string;
  readonly source: FactSource;
  readonly evidence: MemoryEvidence;
}

export type RememberFactOutcome =
  /** Stored: active when explicit, pending_confirmation when inferred. */
  | { readonly kind: "remembered"; readonly fact: MemoryFact }
  /** The same value is already remembered; nothing changed. */
  | { readonly kind: "already_remembered"; readonly fact: MemoryFact }
  /** Another value is remembered for the key; a change of value is a correction. */
  | { readonly kind: "conflicts_with_current"; readonly fact: MemoryFact }
  /** The person forgot this key; it can't be guessed again, only said again. */
  | { readonly kind: "forgotten_key"; readonly key: MemoryKey }
  | { readonly kind: "untrusted_source"; readonly reason: UntrustedSourceReason }
  | { readonly kind: "invalid_value"; readonly reason: InvalidValueReason };

export function rememberFact(deps: MemoryDependencies, request: RememberFactRequest): Promise<RememberFactOutcome> {
  const trust = trustOf(request.evidence, request.value, request.source);
  if (trust.kind === "untrusted") return Promise.resolve({ kind: "untrusted_source", reason: trust.reason });
  const normalized = normalizedValue(request.key, request.value, (text) => deps.catalog.resolveArea(text));
  if (normalized.kind === "invalid_value") return Promise.resolve(normalized);

  return deps.memory.change<RememberFactOutcome>(request.ownerId, (memory) => {
    if (request.source === "inferred" && tombstoneFor(memory, request.key) !== undefined) {
      return { save: [], tombstones: [], result: { kind: "forgotten_key", key: request.key } };
    }
    const current = currentFact(memory, request.key);
    if (current !== undefined) {
      const kind = current.value === normalized.value ? "already_remembered" : "conflicts_with_current";
      return { save: [], tombstones: [], result: { kind, fact: current } };
    }
    const fact: MemoryFact = {
      id: deps.memory.newFactId(),
      ownerId: request.ownerId,
      key: request.key,
      value: normalized.value,
      source: request.source,
      status: request.source === "explicit" ? "active" : "pending_confirmation",
      evidence: trust.evidence,
      validFromMs: deps.clock.now().getTime(),
    };
    return { save: [fact], tombstones: [], result: { kind: "remembered", fact } };
  });
}
