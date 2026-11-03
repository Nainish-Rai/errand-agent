import { equals } from "eve/evals/expect";

import { ASK_FOR_PLUMBER, SEARCH_TURN } from "../../booking-conversation";
import { providerAlertsFor, providerUpdatesIn } from "../../provider-cancellation-checks";
import { defineScenario } from "../../scenario";

// Ticket 14: notify only when it matters. While the person is chatting about a plumber, the network
// sends a provider-cancelled event for their electrician visit of three weeks ago (seeded,
// completed). The visit is past, so nobody is told: no provider update, no new chat, no alert, no
// card, and the world's record of the visit is unchanged.

const PAST_BOOKING = "bkg_seed_1";

export default defineScenario({
  id: "scenarios/proactive/past-booking-no-notice",
  description: "A provider-cancelled event for a past booking produces no notification, no alert and no proposal.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { providerCancelled: { bookingId: PAST_BOOKING, eventId: "evt_stale_electrician" } }],
  model: { turns: [SEARCH_TURN] },
  expected: "the event is skipped as past_booking; no provider update, no new chat or turn, no alert or bell count, no card; the past booking stays completed",
  async expect(t, run) {
    t.succeeded();
    const [fired] = run.worldEvents;
    t.check(fired?.outcome, equals({ kind: "skipped", reason: "past_booking" })).label("the event is skipped: the visit is past");
    t.check(providerUpdatesIn(run.turns).length, equals(0)).label("no provider update in any chat");
    t.check([run.sessionIds.length, run.turns.length], equals([1, 1])).label("no new chat and no extra turn");

    const home = await run.api.getHomeSummary();
    t.check(providerAlertsFor(home.alerts, PAST_BOOKING).length, equals(0)).label("no alert");
    t.check(home.counts.alerts, equals(0)).label("the bell counts nothing");
    t.check((await run.api.listProposals()).length, equals(0)).label("no card");
    const past = (await run.api.listBookings()).find((booking) => booking.bookingId === PAST_BOOKING);
    t.check([past?.status, past?.cancelledBy ?? null], equals(["completed", null])).label("the past visit is unchanged");
  },
});
