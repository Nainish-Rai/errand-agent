import type { AttachSessionFn, ChannelFrom } from "eve/channels";

import type { PersonNotifier, ProviderNotice } from "../../src/core/ports/person-notifier";
import { appUserOf } from "./app-user";
import { presentProviderUpdate } from "./provider-update-presenter";
import { claimCallersSession } from "./session-access";

// PersonNotifier on eve's sessions: the backend's provider update arrives in the person's chat as a
// message and starts the agent's turn. eve keeps the notice's idempotency key per session, so a
// repeat of the same notice is ignored there too. The turn runs as the person (their memory and
// their approvals), but the update says it came from the provider network, and memory never counts
// its words as theirs.

type SessionAuth = Parameters<ReturnType<AttachSessionFn>["send"]>[1]["auth"];

export class EveSessionNotifier implements PersonNotifier {
  readonly #from: ChannelFrom<undefined>;
  readonly #attachSession: AttachSessionFn;
  readonly #auth: SessionAuth;

  constructor(route: { readonly from: ChannelFrom<undefined>; readonly attachSession: AttachSessionFn }, auth: SessionAuth) {
    this.#from = route.from;
    this.#attachSession = route.attachSession;
    this.#auth = auth;
  }

  async openChat(key: string): Promise<{ readonly sessionId: string }> {
    // One address per notice key: asking again returns the chat the first call made.
    const { session } = await this.#from(key).create({ auth: this.#auth, title: "Provider cancelled a booking" });
    // The backend opened this chat for the person, so it is theirs before they ever reach it.
    const userId = appUserOf(this.#auth);
    if (userId !== undefined) await claimCallersSession(session.id, userId);
    return { sessionId: session.id };
  }

  async notify(sessionId: string, notice: ProviderNotice): Promise<{ readonly deliveryId: string }> {
    const delivery = await this.#attachSession(sessionId).send(presentProviderUpdate(notice.visit), {
      auth: this.#auth,
      idempotencyKey: notice.idempotencyKey,
    });
    return { deliveryId: delivery.deliveryId };
  }
}
