// The provider world: the eight fixed tools of the assignment, as core sees them.
// Plain types only. The wire shapes live in packages/contracts.

export type ServiceKind = "plumber" | "electrician" | "ac_servicing" | "carpenter" | "cleaner";

/** Inclusive calendar dates in IST, `YYYY-MM-DD`. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** A one-hour visit window. ISO 8601 with the IST offset, e.g. `2026-11-04T09:00:00+05:30`. */
export interface Slot {
  readonly start: string;
  readonly end: string;
}

export interface ProviderSummary {
  readonly id: string;
  readonly name: string;
  readonly service: ServiceKind;
  readonly area: string;
  readonly priceInr: number;
  readonly rating: number;
  readonly reviewCount: number;
  readonly freeSlots: readonly Slot[];
  readonly attributes: readonly string[];
  /** The provider's square thumbnail as an image asset key, never a URL: each client ships the files. */
  readonly image: string;
  /** Photos of the provider's work as image asset keys, the cover first. */
  readonly photos: readonly string[];
}

/** A service, or a kind of one service, that the person can pick, with the world's facts for its card. */
export interface ServiceOption {
  readonly id: string;
  readonly service: ServiceKind;
  readonly label: string;
  readonly description: string;
  readonly fromPriceInr: number;
  /** An image asset key, never a URL. */
  readonly image: string;
}

export interface ServiceOptions {
  /** One option per service, in the order the home tiles show them. */
  readonly services: readonly ServiceOption[];
  /** Kinds of one service the person may be asked to pick between: gas refill, deep clean, repair. */
  readonly kinds: readonly ServiceOption[];
}

export interface Review {
  readonly author: string;
  readonly rating: number;
  readonly postedOn: string;
  /** Untrusted free text. May contain instructions aimed at the agent. */
  readonly text: string;
}

/** A late cancellation's fee: a flat amount, or a share of the visit's price. */
export type CancellationFee =
  | { readonly kind: "flat"; readonly amountInr: number }
  | { readonly kind: "percent_of_price"; readonly percent: number };

/** The provider's cancellation rule as data: free until some hours before the visit, the fee after that. */
export interface CancellationPolicy {
  readonly freeUntilHoursBefore: number;
  readonly lateFee: CancellationFee;
}

export interface ProviderDetails extends ProviderSummary {
  readonly about: string;
  /** The rule in the provider's own words, as the card shows it. */
  readonly cancellationTerms: string;
  /** The same rule as data, which the cancellation fee is worked out from. */
  readonly cancellationPolicy: CancellationPolicy;
  readonly reviews: readonly Review[];
}

export interface Hold {
  readonly holdId: string;
  readonly providerId: string;
  readonly slot: Slot;
  readonly quotedPriceInr: number;
  readonly expiresAt: string;
}

export type BookingStatus = "upcoming" | "completed" | "cancelled";

export interface Booking {
  readonly bookingId: string;
  readonly userId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly service: ServiceKind;
  readonly slot: Slot;
  readonly priceInr: number;
  readonly status: BookingStatus;
  /** Who cancelled a cancelled booking, when the world knows: the provider (ticket 14) or the person. */
  readonly cancelledBy?: "provider" | "person";
}

/**
 * The provider network telling us a provider cancelled a booking. Only the two ids are used as
 * keys; everything else about the booking is read back from the world, never taken from the event.
 * `note` is the provider's own free text: untrusted, kept out of every prompt.
 */
export interface ProviderCancelledEvent {
  readonly eventId: string;
  readonly bookingId: string;
  readonly providerId: string;
  readonly occurredAt: string;
  readonly note?: string;
}

export interface SearchQuery {
  readonly service: string;
  readonly area: string;
  readonly dateRange: DateRange;
}

export type SearchOutcome =
  | { readonly kind: "found"; readonly providers: readonly ProviderSummary[] }
  | { readonly kind: "unknown_service"; readonly knownServices: readonly ServiceKind[] }
  | { readonly kind: "unknown_area"; readonly knownAreas: readonly string[] }
  | { readonly kind: "invalid_date_range"; readonly reason: string };

export type GetProviderOutcome =
  | { readonly kind: "found"; readonly provider: ProviderDetails }
  | { readonly kind: "provider_not_found" };

export type HoldOutcome =
  | { readonly kind: "held"; readonly hold: Hold }
  | { readonly kind: "slot_unavailable" }
  | { readonly kind: "provider_not_found" };

/** A hold as the provider has it now, which may differ from what it quoted when the slot was held. */
export type GetHoldOutcome =
  | { readonly kind: "held"; readonly hold: Hold }
  /** The hold ran out (or the provider let it go early); the slot may still be free to hold again. */
  | { readonly kind: "hold_expired"; readonly hold: Hold }
  /** Booked, released, or never existed. */
  | { readonly kind: "hold_not_found" };

export type ReleaseHoldOutcome = { readonly kind: "released" } | { readonly kind: "hold_not_found" };

export type BookOutcome =
  | { readonly kind: "booked"; readonly bookingId: string }
  | { readonly kind: "slot_taken" }
  /** The call timed out. The booking may or may not exist; only get_booking_status knows. */
  | { readonly kind: "timeout" }
  | { readonly kind: "hold_expired" }
  | { readonly kind: "hold_not_found" }
  | { readonly kind: "idempotency_conflict" };

export type BookingStatusOutcome =
  | { readonly kind: "booked"; readonly bookingId: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "failed"; readonly reason: string };

export type CancelOutcome =
  | { readonly kind: "cancelled"; readonly bookingId: string }
  /** Transient 503. Retrying succeeds. */
  | { readonly kind: "service_unavailable" }
  | { readonly kind: "booking_not_found" }
  | { readonly kind: "idempotency_conflict" };

export type RescheduleOutcome =
  | { readonly kind: "rescheduled"; readonly booking: Booking }
  | { readonly kind: "slot_conflict" }
  | { readonly kind: "booking_not_found" }
  | { readonly kind: "idempotency_conflict" };

export interface ProviderWorld {
  searchProviders(query: SearchQuery): Promise<SearchOutcome>;
  getProvider(providerId: string): Promise<GetProviderOutcome>;
  listBookings(userId: string): Promise<readonly Booking[]>;
  holdSlot(providerId: string, slot: Slot): Promise<HoldOutcome>;
  /**
   * Re-reads a hold's live terms. Not one of the assignment's eight tools, and never offered to the
   * model: core calls it between the person's approval and the booking, because a provider can
   * change a held price or slot after quoting it.
   */
  getHold(holdId: string): Promise<GetHoldOutcome>;
  /**
   * Gives a held slot back before it expires (the person declined). Not one of the assignment's
   * eight tools, and never offered to the model: only core calls it, when a proposal is declined.
   */
  releaseHold(holdId: string): Promise<ReleaseHoldOutcome>;
  book(holdId: string, idempotencyKey: string): Promise<BookOutcome>;
  getBookingStatus(idempotencyKey: string): Promise<BookingStatusOutcome>;
  cancel(bookingId: string, idempotencyKey: string): Promise<CancelOutcome>;
  reschedule(bookingId: string, newSlot: Slot, idempotencyKey: string): Promise<RescheduleOutcome>;
  /** The services and kinds of service the person can pick from, for tiles and service choice cards. */
  listServiceOptions(): Promise<ServiceOptions>;
}
