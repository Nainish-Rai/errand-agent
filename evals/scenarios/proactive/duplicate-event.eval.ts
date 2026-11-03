import { equals } from "eve/evals/expect";

import { bookingChanges, executionsIn } from "../../approval-checks";
import {
  ASK_FOR_PLUMBER,
  CHEAPEST_PLUMBER,
  CHOOSE_CHEAPEST,
  executeTurn,
  FIRST_BOOKING_ID,
  HOLD_AND_PROPOSE_TURN,
  SEARCH_TURN,
} from "../../booking-conversation";
import { offeredProviderIds, providerAlertsFor, providerUpdatesIn } from "../../provider-cancellation-checks";
import { defineScenario } from "../../scenario";

// Ticket 14: each provider event is handled once. The person books the cheapest plumber in a chat;
// the provider cancels; the network delivers the same event twice, then sends a second event about
// the same cancellation. The person hears about it once, in the chat that booked it, with one fresh
// card. The agent also tries to execute before any tap: the old, used grant can't rebook anything.

const EVENT_ID = "evt_shiva_cancels";
const SECOND_EVENT_ID = "evt_shiva_cancels_again";

/** Within the remembered area, the replacement plumber: Venkatesh Sanitary Solutions, ₹499, Thursday 09:00. */
const REPLACEMENT = {
  providerId: "prv_plumber_koramangala_4",
  slot: { start: "2026-11-05T09:00:00+05:30", end: "2026-11-05T10:00:00+05:30" },
} as const;

export default defineScenario({
  id: "scenarios/proactive/duplicate-event",
  description: "A provider-cancelled event delivered twice (and a second event about the same cancellation) gives one notification and one proposal.",
  world: { scenario: "happy_path", seed: 42 },
  memory: [{ key: "area", value: "Koramangala", source: "explicit", status: "active", ageDays: 30 }],
  user: [
    { say: ASK_FOR_PLUMBER },
    { say: CHOOSE_CHEAPEST },
    { card: "approve" },
    { providerCancelled: { bookingId: "newest", eventId: EVENT_ID } },
    { providerCancelled: { bookingId: "newest", eventId: EVENT_ID } },
    { providerCancelled: { bookingId: "newest", eventId: SECOND_EVENT_ID } },
  ],
  model: {
    turns: [
      SEARCH_TURN,
      HOLD_AND_PROPOSE_TURN,
      executeTurn(`Booked: Shiva Sanitary Solutions, Thu 5 Nov at 8:00 am IST, ₹399. Booking ID ${FIRST_BOOKING_ID}.`),
      {
        steps: [
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: { from: "2026-11-05", to: "2026-11-11" } } }] },
          { toolCalls: [{ name: "hold_slot", input: { provider_id: REPLACEMENT.providerId, slot: REPLACEMENT.slot } }] },
          { toolCalls: [{ name: "propose_action", input: { action: "book" } }] },
          // A model that tries to rebook on its own: there is no grant for the new card.
          { toolCalls: [{ name: "execute_proposal", input: {} }] },
          {
            text:
              "Shiva Sanitary Solutions cancelled your plumber visit. I found Venkatesh Sanitary Solutions on Thursday at 9:00; " +
              "check the card and tap Approve if it's right.",
          },
        ],
      },
    ],
  },
  expected:
    "the first delivery notifies the chat that booked it; the duplicate and the second event change nothing; one provider update, one alert, one fresh card; Shiva is never offered again; nothing is rebooked without a tap",
  async expect(t, run) {
    t.succeeded();
    await t.require(run.worldEvents.length, equals(3));
    const [first, again, other] = run.worldEvents;
    await t.require(first?.outcome.kind, equals("notified"));
    if (first?.outcome.kind !== "notified") return;
    t.check(first.outcome.sessionId, equals(run.sessionId)).label("the notice went to the chat that booked it");
    t.check(again?.outcome, equals({ kind: "duplicate", decision: "notified", skipReason: null, sessionId: run.sessionId })).label(
      "the same event again is a duplicate",
    );
    t.check(other?.outcome, equals({ kind: "skipped", reason: "already_notified" })).label(
      "a second event about the same cancellation tells nobody",
    );

    t.check(providerUpdatesIn(run.turns).length, equals(1)).label("one provider update in the chat");
    t.check(run.turns.length, equals(4)).label("one agent turn for the cancellation");
    const cards = await run.api.listSessionProposals(run.sessionId);
    const fresh = cards.filter((card) => card.status === "pending");
    t.check(fresh.length, equals(1)).label("one fresh card");
    t.check(fresh[0]?.terms.providerId === CHEAPEST_PLUMBER.providerId, equals(false)).label("the fresh card isn't the cancelling provider");
    const rebooking = run.turns.at(-1);
    t.check(offeredProviderIds(rebooking === undefined ? [] : [rebooking]).includes(CHEAPEST_PLUMBER.providerId), equals(false)).label(
      "the cancelling provider isn't offered again",
    );

    // The agent's own attempt to execute found no grant for the new card: nothing new was booked.
    t.check(executionsIn(rebooking).map((output) => output.kind), equals(["not_approved"])).label("its own execute found no grant");
    const { made } = await bookingChanges(run);
    t.check(made.map((booking) => [booking.bookingId, booking.status, booking.cancelledBy ?? null]), equals([[FIRST_BOOKING_ID, "cancelled", "provider"]])).label(
      "the only booking made is the one the provider cancelled; nothing was rebooked",
    );

    const home = await run.api.getHomeSummary();
    const alerts = providerAlertsFor(home.alerts, FIRST_BOOKING_ID);
    t.check(alerts.map((alert) => [alert.sessionId, alert.replacementsReady, alert.proposalId]), equals([[run.sessionId, 1, fresh[0]?.proposalId ?? null]])).label(
      "one alert, linking to the chat and its fresh card",
    );
    t.check(home.counts.alerts, equals(1)).label("the bell counts it once");
  },
});
