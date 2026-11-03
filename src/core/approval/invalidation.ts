import type { Slot } from "../ports/provider-world";
import type { FingerprintedTerms } from "./fingerprint";

// Why an approved proposal can no longer be carried out: the provider changed the terms the person
// approved (price, slot or provider), or the hold ran out. Either way the grant is spent or voided,
// nothing is booked, and a fresh proposal on the live terms replaces this one.

export type TermChange =
  | { readonly field: "price"; readonly from: number; readonly to: number }
  | { readonly field: "slot"; readonly from: Slot; readonly to: Slot }
  | {
      readonly field: "provider";
      readonly from: { readonly providerId: string; readonly providerName: string };
      readonly to: { readonly providerId: string; readonly providerName: string };
    };

export interface ProposalInvalidation {
  /** What differs between the approved terms and the live ones; empty when only the hold ran out. */
  readonly changes: readonly TermChange[];
  /** The fresh proposal on the live terms, which needs its own approval. */
  readonly replacedBy: string;
  readonly atMs: number;
}

function isSameSlot(a: Slot, b: Slot): boolean {
  return Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end);
}

type NamedTerms = FingerprintedTerms & { readonly providerName: string };

/** Every material difference between two sets of booking terms, provider first, then slot, then price. */
export function termChangesBetween(approved: NamedTerms, live: NamedTerms): TermChange[] {
  const changes: TermChange[] = [];
  if (approved.providerId !== live.providerId) {
    changes.push({
      field: "provider",
      from: { providerId: approved.providerId, providerName: approved.providerName },
      to: { providerId: live.providerId, providerName: live.providerName },
    });
  }
  if (!isSameSlot(approved.slot, live.slot)) changes.push({ field: "slot", from: approved.slot, to: live.slot });
  if (approved.priceInr !== live.priceInr) changes.push({ field: "price", from: approved.priceInr, to: live.priceInr });
  return changes;
}
