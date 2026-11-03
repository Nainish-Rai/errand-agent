import { equals } from "eve/evals/expect";

import { bookingChanges, executionsIn, expectedFingerprint, fingerprintOfBooking } from "../../approval-checks";
import {
  ASK_FOR_PLUMBER,
  CHEAPEST_PLUMBER,
  CHOOSE_CHEAPEST,
  executeTurn,
  FIRST_BOOKING_ID,
  HOLD_AND_PROPOSE_TURN,
  SEARCH_TURN,
} from "../../booking-conversation";
import { defineScenario } from "../../scenario";

// SPEC "happy booking": choose an option, see the card, tap Approve. Exactly one booking exists in
// the world, it matches the approved fingerprint, and its grant is consumed. The agent says
// "Booked" with the booking ID only after execute_proposal verified it.

export default defineScenario({
  id: "scenarios/approval/happy-booking",
  description: "Choosing an option shows the approval card; a tap on Approve books exactly that, once, and the agent reports the verified booking ID.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { card: "approve" }],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. " +
    "When the approval card appears, tap Approve on it. Once the assistant says it's booked and gives a booking ID, you are done.",
  maxSimulatedMessages: 4,
  model: {
    turns: [
      SEARCH_TURN,
      HOLD_AND_PROPOSE_TURN,
      executeTurn(`Booked: Shiva Sanitary Solutions, Thu 5 Nov at 8:00 am IST, ₹399. Booking ID ${FIRST_BOOKING_ID}.`),
    ],
  },
  expected:
    "exactly one new booking in the world, for the held provider, slot and price; it matches the approved fingerprint; its grant is consumed; the errand is done; the reply says Booked with that booking ID",
  async expect(t, run) {
    t.succeeded();
    await t.require(run.taps.map((tap) => `${tap.tap} ${tap.status}`), equals(["approve 200"]));

    const { made } = await bookingChanges(run);
    await t.require(made.length, equals(1));
    const [booking] = made;
    const approval = booking?.approval ?? null;
    await t.require(approval !== null, equals(true));
    if (booking === undefined || approval === null) return;

    // In replay and live the model may pick another option; the checks hold for whichever it held.
    const [proposal] = await run.api.listSessionProposals(run.sessionId);
    t.check(proposal?.status, equals("executed")).label("the proposal was executed");
    t.check(proposal?.bookingId, equals(booking.bookingId)).label("the proposal names the booking");
    t.check(approval.grantConsumed, equals(true)).label("the grant is consumed");
    t.check(approval.grantFingerprint, equals(proposal?.fingerprint)).label("the grant is for the proposal's fingerprint");
    t.check(fingerprintOfBooking(booking), equals(proposal?.fingerprint)).label("the booking matches the approved fingerprint");
    t.check([booking.providerId, booking.slot.start, booking.priceInr], equals([
      proposal?.terms.providerId,
      proposal?.terms.slot.start,
      proposal?.terms.priceInr,
    ])).label("the booking is the card's provider, slot and price");
    if (run.mode === "offline") {
      t.check(approval.grantFingerprint, equals(expectedFingerprint({ ...CHEAPEST_PLUMBER, holdId: "hold_0001" })));
      t.check(booking.bookingId, equals(FIRST_BOOKING_ID));
    }

    const errand = await run.api.getErrand(run.sessionId);
    t.check(errand?.state, equals("done"));

    // The turn answering the tap's follow-up executed, was verified, and only it says Booked.
    const bookedAt = run.turns.findIndex((turn) => executionsIn(turn).some((output) => output.kind === "booked"));
    await t.require(bookedAt >= 0, equals(true));
    t.check(run.turns[bookedAt]?.reply.includes(booking.bookingId), equals(true)).label("the reply gives the booking ID");
    t.check(run.turns.slice(0, bookedAt).some((turn) => /\bBooked\b/.test(turn.reply)), equals(false)).label("no Booked before the tap");
  },
});
