import type { ErrandDetails } from "../errand/errand";
import { MEMORY_KEYS, type MemoryFact, type MemoryKey } from "./memory-fact";

// Context selection: which remembered facts the model sees this turn, and why each other fact
// doesn't. Filter first, then rank: a fact that fails the filter (superseded, forgotten, unconfirmed,
// outside its validity window) is excluded before ranking runs, so no ranking can bring it back.
// Ticket 12 packs the ranked facts into a token budget; this function stays pure for it.

export type InclusionReason =
  /** The errand doesn't have this detail yet, so the fact can fill it. */
  | "fills_missing_detail"
  /** A preference with no errand field (a favourite technician): always worth knowing. */
  | "standing_preference"
  /** The errand already says the same thing. */
  | "matches_errand";

export type ExclusionReason =
  | "superseded"
  | "forgotten"
  /** Inferred and not confirmed by the person: never used. */
  | "unconfirmed"
  /** Its validity window doesn't contain now. */
  | "outside_validity"
  /** The person said something else for this errand, which wins over the remembered value. */
  | "overridden_by_errand";

export interface IncludedFact {
  readonly fact: MemoryFact;
  readonly reason: InclusionReason;
}

export interface ExcludedFact {
  readonly fact: MemoryFact;
  readonly reason: ExclusionReason;
}

export interface ContextSelection {
  /** Most useful first. */
  readonly included: readonly IncludedFact[];
  readonly excluded: readonly ExcludedFact[];
}

const RANK_OF_REASON: Readonly<Record<InclusionReason, number>> = {
  fills_missing_detail: 0,
  standing_preference: 1,
  matches_errand: 2,
};

/** The errand's own value for the detail a key remembers, as text; undefined when it is empty. */
function errandValueFor(key: MemoryKey, details: ErrandDetails): string | undefined | null {
  switch (key) {
    case "area":
      return details.area;
    case "budget":
      return details.budget === undefined ? undefined : String(details.budget.maxInr);
    case "earliest_hour":
      return details.timeWindow?.hours === undefined ? undefined : String(details.timeWindow.hours.from);
    case "preferences":
      return details.preferences.length === 0 ? undefined : details.preferences.join(", ");
    case "favourite_technician":
      // No errand field holds it.
      return null;
  }
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The filter: only active facts whose validity window contains now get past it. */
function filterReason(fact: MemoryFact, nowMs: number): ExclusionReason | undefined {
  switch (fact.status) {
    case "superseded":
      return "superseded";
    case "forgotten":
      return "forgotten";
    case "pending_confirmation":
      return "unconfirmed";
    case "active":
      if (fact.validFromMs > nowMs || (fact.validToMs !== undefined && fact.validToMs <= nowMs)) return "outside_validity";
      return undefined;
  }
}

function relevanceTo(fact: MemoryFact, details: ErrandDetails | undefined): InclusionReason | "overridden_by_errand" {
  if (details === undefined) return errandValueFor(fact.key, { preferences: [] }) === null ? "standing_preference" : "fills_missing_detail";
  const inErrand = errandValueFor(fact.key, details);
  if (inErrand === null) return "standing_preference";
  if (inErrand === undefined) return "fills_missing_detail";
  return sameText(inErrand, fact.value) ? "matches_errand" : "overridden_by_errand";
}

/**
 * Selects the facts for the model's context. `details` is the session's errand, or undefined before
 * the person has asked for anything.
 */
export function selectContext(facts: readonly MemoryFact[], details: ErrandDetails | undefined, nowMs: number): ContextSelection {
  const included: IncludedFact[] = [];
  const excluded: ExcludedFact[] = [];
  for (const fact of facts) {
    const filtered = filterReason(fact, nowMs);
    if (filtered !== undefined) {
      excluded.push({ fact, reason: filtered });
      continue;
    }
    const relevance = relevanceTo(fact, details);
    if (relevance === "overridden_by_errand") excluded.push({ fact, reason: relevance });
    else included.push({ fact, reason: relevance });
  }
  included.sort(
    (a, b) =>
      RANK_OF_REASON[a.reason] - RANK_OF_REASON[b.reason] ||
      MEMORY_KEYS.indexOf(a.fact.key) - MEMORY_KEYS.indexOf(b.fact.key) ||
      b.fact.validFromMs - a.fact.validFromMs,
  );
  return { included, excluded };
}
