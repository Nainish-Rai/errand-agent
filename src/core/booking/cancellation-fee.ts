import type { CancellationPolicy, Slot } from "../ports/provider-world";

// What cancelling a booking costs right now, by the provider's own rule. It is worked out in code
// from the rule as data, never by the model from the rule's wording, and it goes on the card and
// into the fingerprint: if the free window closes between the card and the cancellation, the fee
// changes and the approval no longer covers it.

const HOUR_MS = 60 * 60 * 1_000;

/** Whether cancelling at `nowMs` is still inside the provider's free window. */
export function isFreeToCancel(policy: CancellationPolicy, slot: Slot, nowMs: number): boolean {
  return Date.parse(slot.start) - nowMs >= policy.freeUntilHoursBefore * HOUR_MS;
}

/** The fee in whole rupees for cancelling a booking of `priceInr` at `nowMs`. */
export function cancellationFeeOf(policy: CancellationPolicy, booking: { readonly slot: Slot; readonly priceInr: number }, nowMs: number): number {
  if (isFreeToCancel(policy, booking.slot, nowMs)) return 0;
  const { lateFee } = policy;
  switch (lateFee.kind) {
    case "flat":
      return lateFee.amountInr;
    case "percent_of_price":
      return Math.round((booking.priceInr * lateFee.percent) / 100);
  }
}
