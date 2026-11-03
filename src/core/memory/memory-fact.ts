// Memory facts: what the agent remembers about a person across sessions, stored Zep-style. A fact
// is never edited in place. A correction closes the old fact's validity window and opens a new one
// that names the fact it supersedes; forgetting closes every fact of the key and writes a tombstone
// that blocks the key from being guessed again. Only a person's own words or clicks can write one.

/** The stable preferences the agent may remember. Each key holds at most one current fact. */
export type MemoryKey = "area" | "budget" | "earliest_hour" | "favourite_technician" | "preferences";

export const MEMORY_KEYS: readonly MemoryKey[] = ["area", "budget", "earliest_hour", "favourite_technician", "preferences"];

/** `explicit`: the person said it as a preference. `inferred`: the agent noticed it and must ask. */
export type FactSource = "explicit" | "inferred";

export type FactStatus = "active" | "pending_confirmation" | "superseded" | "forgotten";

/**
 * Where a fact came from. Only `user_message` and `user_action` are trusted. The other two exist so
 * that a write the model attempts from tool output (a review, a provider's text) or from words it
 * can't point to is a typed value core refuses, not a string someone has to grep for.
 */
export type MemoryEvidence =
  | {
      readonly kind: "user_message";
      readonly sessionId: string;
      /** The person's words, as they appear in their message. */
      readonly quote: string;
      /** `latest`: the message this turn answers. `earlier`: a message from before it in the session. */
      readonly position: "latest" | "earlier";
    }
  /** A click in the app (the Memory panel), through the app API. */
  | { readonly kind: "user_action"; readonly action: UserAction }
  /** The quoted words appear only in a tool's result. Never trusted. */
  | { readonly kind: "tool_output"; readonly sessionId: string; readonly quote: string; readonly toolName: string }
  /** The quoted words appear nowhere in the conversation. Never trusted. */
  | { readonly kind: "unverified"; readonly sessionId: string; readonly quote: string };

export type UserAction = "correct" | "forget" | "confirm" | "seed";

export type TrustedEvidence = Extract<MemoryEvidence, { readonly kind: "user_message" | "user_action" }>;

export interface MemoryFact {
  readonly id: string;
  /** The person the fact is about, from the channel's auth context. */
  readonly ownerId: string;
  readonly key: MemoryKey;
  readonly value: string;
  readonly source: FactSource;
  readonly status: FactStatus;
  readonly evidence: TrustedEvidence;
  /** When the fact became true for the agent (recorded). */
  readonly validFromMs: number;
  /** When it stopped being true (superseded or forgotten); absent while it is current. */
  readonly validToMs?: number;
  /** The fact this one replaced, for a correction. */
  readonly supersedes?: string;
  /** The fact that replaced this one. */
  readonly supersededBy?: string;
  /** When the person confirmed an inferred fact, and how. */
  readonly confirmation?: { readonly atMs: number; readonly evidence: TrustedEvidence };
}

/** Written when a key is forgotten. While it stands, the key can't be inferred again. */
export interface Tombstone {
  readonly ownerId: string;
  readonly key: MemoryKey;
  readonly forgottenAtMs: number;
  readonly evidence: TrustedEvidence;
}

/** Everything stored about one person. */
export interface OwnerMemory {
  readonly facts: readonly MemoryFact[];
  readonly tombstones: readonly Tombstone[];
}

/** Why a value can't be stored for its key. */
export type InvalidValueReason = "empty" | "too_long" | "unknown_area" | "not_a_positive_amount" | "not_an_hour";

/** Why a write was refused because of where it came from. */
export type UntrustedSourceReason = "tool_output" | "unverified" | "explicit_needs_latest_message" | "value_not_in_evidence";

export function isMemoryKey(value: string): value is MemoryKey {
  return (MEMORY_KEYS as readonly string[]).includes(value);
}

/** A fact the agent may use: active means explicit, or inferred and confirmed. */
export function isUsable(fact: MemoryFact): boolean {
  return fact.status === "active";
}

/** The fact that currently holds the key (active or waiting for confirmation), if any. */
export function currentFact(memory: OwnerMemory, key: MemoryKey): MemoryFact | undefined {
  return memory.facts.find((fact) => fact.key === key && (fact.status === "active" || fact.status === "pending_confirmation"));
}

export function tombstoneFor(memory: OwnerMemory, key: MemoryKey): Tombstone | undefined {
  return memory.tombstones.findLast((tombstone) => tombstone.key === key);
}

/** Lower-cased words and numbers; "₹1,500" and "10am" read as "1500" and "10", "am". */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, "$1")
    .match(/[a-z]+|\d+/g) ?? [];
}

const FILLER = new Set(["the", "a", "an", "my", "of", "in", "at", "and", "or", "to", "is", "for", "rs", "inr"]);

/**
 * True when the quoted words carry the value: one of the value's words appears in the quote. So a
 * quote of "my area is HSR" supports "HSR Layout", and a request to find a plumber supports no area.
 */
export function isValueInEvidence(value: string, quote: string): boolean {
  const said = new Set(tokens(quote));
  return tokens(value).some((word) => !FILLER.has(word) && said.has(word));
}

/**
 * The trust rule. Tool output and words that can't be found are never trusted. An explicit fact must
 * come from the message this turn answers (so old history can't be replayed as a fresh statement),
 * and the value must be in the person's words.
 */
export function trustOf(
  evidence: MemoryEvidence,
  value: string,
  source: FactSource,
): { readonly kind: "trusted"; readonly evidence: TrustedEvidence } | { readonly kind: "untrusted"; readonly reason: UntrustedSourceReason } {
  switch (evidence.kind) {
    case "tool_output":
      return { kind: "untrusted", reason: "tool_output" };
    case "unverified":
      return { kind: "untrusted", reason: "unverified" };
    case "user_action":
      return { kind: "trusted", evidence };
    case "user_message":
      if (source === "explicit" && evidence.position !== "latest") return { kind: "untrusted", reason: "explicit_needs_latest_message" };
      if (!isValueInEvidence(value, evidence.quote)) return { kind: "untrusted", reason: "value_not_in_evidence" };
      return { kind: "trusted", evidence };
  }
}

/** True when an action word (forget, confirm) comes from the person: their latest message or a click. */
export function isPersonsOwnRequest(evidence: MemoryEvidence): evidence is TrustedEvidence {
  return evidence.kind === "user_action" || (evidence.kind === "user_message" && evidence.position === "latest");
}

const MAX_VALUE_LENGTH = 80;

/**
 * The value in the form the errand uses (the catalog's spelling of an area, a whole rupee amount,
 * an hour), or why it can't be stored. `resolveArea` is the service catalog's.
 */
export function normalizedValue(
  key: MemoryKey,
  value: string,
  resolveArea: (text: string) => string | undefined,
): { readonly kind: "valid"; readonly value: string } | { readonly kind: "invalid_value"; readonly reason: InvalidValueReason } {
  const trimmed = value.trim();
  if (trimmed === "") return { kind: "invalid_value", reason: "empty" };
  if (trimmed.length > MAX_VALUE_LENGTH) return { kind: "invalid_value", reason: "too_long" };
  switch (key) {
    case "area": {
      const area = resolveArea(trimmed);
      return area === undefined ? { kind: "invalid_value", reason: "unknown_area" } : { kind: "valid", value: area };
    }
    case "budget": {
      const amount = Number(trimmed.replace(/[₹,\s]|rs\.?|inr/gi, ""));
      return Number.isInteger(amount) && amount > 0
        ? { kind: "valid", value: String(amount) }
        : { kind: "invalid_value", reason: "not_a_positive_amount" };
    }
    case "earliest_hour": {
      const hour = Number(trimmed);
      return Number.isInteger(hour) && hour >= 0 && hour <= 23
        ? { kind: "valid", value: String(hour) }
        : { kind: "invalid_value", reason: "not_an_hour" };
    }
    case "favourite_technician":
    case "preferences":
      return { kind: "valid", value: trimmed };
  }
}

/** Closes a fact's validity window. Its value is never touched. */
export function closed(fact: MemoryFact, status: "superseded" | "forgotten", atMs: number, supersededBy?: string): MemoryFact {
  return {
    ...fact,
    status,
    validToMs: fact.validToMs ?? atMs,
    ...(supersededBy === undefined ? {} : { supersededBy }),
  };
}
