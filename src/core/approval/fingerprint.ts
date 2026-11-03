import type { Hasher } from "../ports/hasher";
import type { Slot } from "../ports/provider-world";

// The fingerprint names exactly what an approval covers: the action, the provider, the slot, the
// price and the hold (for a booking) or the booking (for a cancellation or a reschedule). Change
// any one of them and the fingerprint changes, so a grant minted for one set of terms can never
// authorise another.

export type ProposedAction = "book" | "cancel" | "reschedule";

/** A change to a booking that already exists. */
export type BookingChangeAction = Exclude<ProposedAction, "book">;

interface CommonTerms {
  readonly providerId: string;
  /** The visit the action is about: the held slot, the booking's slot (cancel) or the new slot (reschedule). */
  readonly slot: Slot;
  /** The money the approval commits to: the visit's price, or a cancellation's fee. */
  readonly priceInr: number;
}

export type FingerprintedTerms =
  | (CommonTerms & { readonly action: "book"; readonly holdId: string })
  | (CommonTerms & { readonly action: "cancel"; readonly bookingId: string })
  | (CommonTerms & { readonly action: "reschedule"; readonly bookingId: string });

/** The hold a booking would use, or the booking a change is for. */
function subjectOf(terms: FingerprintedTerms): string {
  return terms.action === "book" ? terms.holdId : terms.bookingId;
}

/**
 * The exact text that is hashed. A JSON array keeps the order fixed and every field delimited, so
 * no two different sets of terms can produce the same text. Clients that re-derive a fingerprint
 * (the evals do, independently) must build this same text.
 */
export function fingerprintText(terms: FingerprintedTerms): string {
  return JSON.stringify([terms.action, terms.providerId, terms.slot.start, terms.slot.end, terms.priceInr, subjectOf(terms)]);
}

export function fingerprintOf(terms: FingerprintedTerms, hasher: Hasher): string {
  return `fp_${hasher.sha256Hex(fingerprintText(terms))}`;
}

export function matchesFingerprint(terms: FingerprintedTerms, fingerprint: string, hasher: Hasher): boolean {
  return fingerprintOf(terms, hasher) === fingerprint;
}
