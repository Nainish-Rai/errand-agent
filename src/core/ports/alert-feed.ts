import type { ServiceKind, Slot } from "./provider-world";

// Alerts the provider world raises about a person's bookings: a provider cancelling a booking is
// the first (ticket 14 fills this feed from the provider events it notified the person about). The
// home screen reads it, alongside what the system recovered from or failed at.

export interface ProviderCancellation {
  readonly kind: "provider_cancelled";
  readonly alertId: string;
  readonly bookingId: string;
  readonly providerName: string;
  readonly service: ServiceKind;
  readonly slot: Slot;
  readonly raisedAtMs: number;
  /** The chat that handles it, once the agent has started on it. */
  readonly sessionId?: string;
}

export type ProviderAlert = ProviderCancellation;

export interface AlertFeed {
  /** The person's provider alerts, newest first. */
  listAlerts(userId: string): Promise<readonly ProviderAlert[]>;
}
