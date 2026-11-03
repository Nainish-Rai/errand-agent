import type { AlertFeed, ProviderAlert } from "../../core/ports/alert-feed";

/**
 * The alert feed before anything raises provider alerts: always empty. Ticket 14 (proactive
 * provider cancellation) replaces it with a feed the world's cancellation events write to.
 */
export class EmptyAlertFeed implements AlertFeed {
  async listAlerts(): Promise<readonly ProviderAlert[]> {
    return [];
  }
}
