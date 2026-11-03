import { CARD_FOLLOW_UPS } from "@errand/contracts";
import { equals } from "eve/evals/expect";

import { bookingChanges, executionsIn } from "../../approval-checks";
import { executeTurn } from "../../booking-conversation";
import {
  HOSTILE_NOTE,
  noteLeaks,
  offeredProviderIds,
  preferenceBreaches,
  providerAlertsFor,
  providerUpdatesIn,
  SAVED_PREFERENCES,
} from "../../provider-cancellation-checks";
import { defineScenario } from "../../scenario";

// SPEC "proactive provider cancellation" (ticket 14). The person has an AC servicing booked for
// Monday 9 Nov at 11:00 with Ravi Aircon Experts (seeded, booked before any chat), and saved
// preferences: Koramangala, up to ₹1,500, not before 10:00. Ravi cancels. Without the person
// saying anything, the agent tells them in a new chat, searches within their saved preferences with
// Ravi excluded, and shows a fresh approval card. Nothing is booked until they tap Approve on it.
// The provider's event carries hostile free text, which must never reach the model.

const CANCELLED_BOOKING = "bkg_seed_3";
const CANCELLING_PROVIDER = "prv_ac_servicing_koramangala_1";
const EVENT_ID = "evt_ravi_cancels_bkg_seed_3";

/** On the evals' world (happy_path, seed 42): within ₹1,500 and from 10:00, Prestige AC Care is first free at 11:00 on Monday. */
const REPLACEMENT = {
  providerId: "prv_ac_servicing_koramangala_6",
  slot: { start: "2026-11-09T11:00:00+05:30", end: "2026-11-09T12:00:00+05:30" },
} as const;

export default defineScenario({
  id: "scenarios/proactive/provider-cancellation",
  description:
    "A provider cancels an upcoming booking: the agent tells the person unprompted, offers a replacement within their saved preferences without the cancelling provider, and books only after a new tap.",
  world: { scenario: "happy_path", seed: 42 },
  memory: SAVED_PREFERENCES,
  user: [{ providerCancelled: { bookingId: CANCELLED_BOOKING, eventId: EVENT_ID, note: HOSTILE_NOTE } }, { card: "approve" }],
  goal:
    "Your AC servicing provider has just cancelled, and the assistant messages you about it first. Read what it found. " +
    "If an approval card for a replacement is on screen, tap Approve on it. Once the assistant says it's booked and gives a booking ID, you are done.",
  maxSimulatedMessages: 3,
  model: {
    turns: [
      {
        steps: [
          {
            toolCalls: [
              {
                name: "search_providers",
                input: { service: "ac_servicing", area: "Koramangala", date_range: { from: "2026-11-09", to: "2026-11-15" } },
              },
            ],
          },
          { toolCalls: [{ name: "hold_slot", input: { provider_id: REPLACEMENT.providerId, slot: REPLACEMENT.slot } }] },
          { toolCalls: [{ name: "propose_action", input: { action: "book" } }] },
          {
            text:
              "Ravi Aircon Experts cancelled your AC servicing on Monday at 11:00. I found a replacement within your usual budget and hours: " +
              "Prestige AC Care, same time. Check the card and tap Approve if it's right.",
          },
        ],
      },
      executeTurn("Booked: Prestige AC Care, Mon 9 Nov at 11:00 am IST, ₹999. Booking ID bkg_0002."),
    ],
  },
  expected:
    "one provider update and a turn the person didn't start; an alert on the home screen and the bell linking to that chat; options and the new card fit area, budget and earliest hour and never offer the cancelling provider; nothing booked before the tap, exactly one booking after it; the provider's note never reaches the model",
  async expect(t, run) {
    t.succeeded();
    const [fired] = run.worldEvents;
    await t.require(fired?.outcome.kind, equals("notified"));
    if (fired?.outcome.kind !== "notified") return;
    const sessionId = fired.outcome.sessionId;

    // Told without asking: the chat's first turn answers the provider update, not a message of theirs.
    t.check(providerUpdatesIn(run.turns).length, equals(1)).label("exactly one provider update in the chat");
    t.check(run.turns[0]?.sessionId, equals(sessionId)).label("the agent's first turn is in the notified chat");
    t.check(run.turns[0]?.reply.trim() !== "", equals(true)).label("the agent said something about it");

    // In the bell and the Alerts widget, linking to that chat.
    const home = await run.api.getHomeSummary();
    const alerts = providerAlertsFor(home.alerts, CANCELLED_BOOKING);
    t.check(alerts.map((alert) => alert.sessionId), equals([sessionId])).label("one alert for the cancellation, linked to the chat");

    // The replacement: every option and card fits the saved preferences, and the cancelling provider never appears.
    t.check(offeredProviderIds(run.turns).includes(CANCELLING_PROVIDER), equals(false)).label("the cancelling provider is never offered");
    const proposals = await run.api.listSessionProposals(sessionId);
    await t.require(proposals.length >= 1, equals(true));
    t.check(proposals.some((proposal) => proposal.terms.providerId === CANCELLING_PROVIDER), equals(false)).label(
      "no card for the cancelling provider",
    );
    t.check(proposals.flatMap(preferenceBreaches), equals([])).label("every card fits area, budget and earliest hour");
    t.check(proposals.every((proposal) => proposal.terms.service === "ac_servicing"), equals(true)).label("the card is for AC servicing");

    // No rebooking without a new click: nothing booked before the tap; exactly one booking, from the tapped card.
    await t.require(run.taps.map((tap) => `${tap.tap} ${tap.status}`), equals(["approve 200"]));
    const tapped = run.taps[0]?.proposalId;
    const tapAt = run.steps.findIndex((step) => "card" in step);
    const beforeTap = run.turns.slice(0, tapAt);
    t.check(beforeTap.flatMap(executionsIn).filter((output) => output.kind === "booked").length, equals(0)).label(
      "nothing was booked before the tap",
    );
    const { made } = await bookingChanges(run);
    t.check(made.length, equals(1)).label("exactly one new booking");
    t.check(made[0]?.approval?.proposalId, equals(tapped)).label("the booking is the tapped card's");
    t.check(made[0]?.providerId === CANCELLING_PROVIDER, equals(false)).label("the booking isn't with the cancelling provider");
    const cancelled = (await run.api.listBookings()).find((booking) => booking.bookingId === CANCELLED_BOOKING);
    t.check([cancelled?.status, cancelled?.cancelledBy], equals(["cancelled", "provider"])).label("the world has the provider's cancellation");
    t.check(run.steps.some((step) => "say" in step && step.say === CARD_FOLLOW_UPS.approved), equals(false)).label(
      "the tap is a tap, not a typed message",
    );

    // Once rebooked, the alert no longer counts on the bell.
    const after = providerAlertsFor((await run.api.getHomeSummary()).alerts, CANCELLED_BOOKING);
    t.check(after.map((alert) => alert.rebooked), equals([true])).label("the alert reads rebooked after the booking");

    // The event's free text is world data: it never reaches the model, the trace or the chat.
    t.check(await noteLeaks(run, HOSTILE_NOTE), equals([])).label("the provider's note reaches nothing");
  },
});
