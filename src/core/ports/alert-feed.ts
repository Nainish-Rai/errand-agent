import type { ServiceKind, Slot } from "./provider-world";

// Alerts the provider world raises about a person's bookings: a provider cancelling a booking is
// the first (ticket 14 fills this feed). The home screen reads it; until something writes to it,
// the feed is empty and the Alerts widget shows only what the system recovered from or failed at.

export interface ProviderCancellation {
  readonly kind: "provider_cancelled";
  readonly alertId: string;
  readonly bookingId: string;
  readonly providerName: string;
  readonly service: ServiceKind;
  readonly slot: Slot;
  readonly raisedAtMs: number;
  /** Replacement options already found for the person, waiting for their approval. */
  readonly replacementsReady: number;
  /** The chat that handles it, once the agent has started on it. */
  readonly sessionId?: string;
}

export type ProviderAlert = ProviderCancellation;

export interface AlertFeed {
  /** The person's alerts that still need them, newest first. */
  listAlerts(userId: string): Promise<readonly ProviderAlert[]>;
}
