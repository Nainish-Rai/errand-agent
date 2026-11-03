import type { Hasher } from "../ports/hasher";
import type { Slot } from "../ports/provider-world";

// The fingerprint names exactly what an approval covers: the action, the provider, the slot, the
// price and the hold. Change any one of them and the fingerprint changes, so a grant minted for
// one set of terms can never authorise another.

export type ProposedAction = "book";

export interface FingerprintedTerms {
  readonly action: ProposedAction;
  readonly providerId: string;
  readonly slot: Slot;
  readonly priceInr: number;
  readonly holdId: string;
}

/**
 * The exact text that is hashed. A JSON array keeps the order fixed and every field delimited, so
 * no two different sets of terms can produce the same text. Clients that re-derive a fingerprint
 * (the evals do, independently) must build this same text.
 */
export function fingerprintText(terms: FingerprintedTerms): string {
  return JSON.stringify([terms.action, terms.providerId, terms.slot.start, terms.slot.end, terms.priceInr, terms.holdId]);
}

export function fingerprintOf(terms: FingerprintedTerms, hasher: Hasher): string {
  return `fp_${hasher.sha256Hex(fingerprintText(terms))}`;
}

export function matchesFingerprint(terms: FingerprintedTerms, fingerprint: string, hasher: Hasher): boolean {
  return fingerprintOf(terms, hasher) === fingerprint;
}
