import { equals } from "eve/evals/expect";

import { bookingChanges, cardsIn, executionsIn, expectedChangeFingerprint } from "../../approval-checks";
import { AC_BOOKING, acBookingNow, FIND_SATURDAY_STEPS, moveOf, proposeMoveTurn, SATURDAY, SATURDAY_SLOTS } from "../../booking-change-conversation";
import { executeTurn } from "../../booking-conversation";
import { bookingTrace, sessionIntents } from "../../ledger-checks";
import { defineScenario } from "../../scenario";

// Ticket 10, "reschedule happy path". "Move my AC servicing to Saturday": the agent finds the
// booking with list_bookings, offers Saturday's free times, and puts the move on a card with the
// old and the new time. One tap on Approve moves it, once, to exactly the card's slot.

export default defineScenario({
  id: "scenarios/booking-changes/reschedule-happy-path",
  description: "Moving the AC service to Saturday shows a card with the old and new times; one tap moves it exactly once.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: "Move my AC servicing to Saturday" }, { say: "2 pm works." }, { card: "approve" }],
  goal:
    "You have an AC servicing visit booked and want to move it to Saturday. Your first message says exactly that, " +
    "e.g. 'Move my AC servicing to Saturday'. When you are offered times, pick 2 pm (or the first afternoon time). " +
    "When the card appears, tap Approve on it. Once the assistant tells you it moved, you are done.",
  maxSimulatedMessages: 4,
  model: {
    turns: [
      {
        steps: [
          ...FIND_SATURDAY_STEPS,
          {
            text: "Your AC service with Ravi Aircon Experts is on Mon 9 Nov at 11:00 am. On Saturday they're free at 8 am, 2 pm, 3 pm and 6 pm. Which works?",
          },
        ],
      },
      proposeMoveTurn(SATURDAY_SLOTS.at14, "Check the card: it moves the visit from Mon 9 Nov 11:00 am to Sat 7 Nov 2:00 pm. Tap Approve if that's right."),
      executeTurn(`Moved: Ravi Aircon Experts, now Sat 7 Nov at 2:00 pm IST. Booking ID ${AC_BOOKING.bookingId}.`),
    ],
  },
  expected:
    "list_bookings finds bkg_seed_3; the card shows the old time (Mon 9 Nov 11:00) and a new Saturday time; one tap → rescheduled; exactly one reschedule call, the booking now at the card's slot, its grant consumed; nothing new booked",
  actual(run) {
    const outputs = run.toolCalls.filter((call) => call.name === "execute_proposal").map((call) => (call.output as { kind?: string } | undefined)?.kind);
    return `execute_proposal → ${outputs.join(", ") || "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    t.check(
      run.toolCalls.some((call) => call.name === "list_bookings"),
      equals(true),
    ).label("the agent looked the booking up");
    await t.require(
      run.taps.map((tap) => `${tap.tap} ${tap.status}`),
      equals(["approve 200"]),
    );

    const cards = run.turns.flatMap((turn) => cardsIn(turn));
    await t.require(cards.length >= 1, equals(true));
    const card = cards.at(-1);
    const move = moveOf(card);
    t.check(move?.from, equals(AC_BOOKING.slot.start)).label("the card shows the old time");
    t.check(move?.to.slice(0, 10), equals(SATURDAY.from)).label("the card's new time is on Saturday");

    const { made, altered } = await bookingChanges(run);
    t.check(made.length, equals(0)).label("nothing new is booked");
    t.check(
      altered.map((booking) => booking.bookingId),
      equals([AC_BOOKING.bookingId]),
    ).label("only the AC booking changed");
    const booking = await acBookingNow(run.api);
    t.check([booking?.status, booking?.slot.start], equals(["upcoming", move?.to])).label("the booking is at the card's new slot");

    const change = booking?.changes.at(-1);
    t.check([change?.action, change?.status, change?.grantConsumed], equals(["reschedule", "executed", true])).label("its grant is consumed");
    const proposal = (await run.api.listSessionProposals(run.sessionId)).find((listed) => listed.proposalId === card?.proposalId);
    if (proposal !== undefined && proposal.terms.action === "reschedule") {
      const fingerprint = expectedChangeFingerprint({
        ...proposal.terms,
        bookingId: AC_BOOKING.bookingId,
      });
      t.check([change?.grantFingerprint, proposal.fingerprint], equals([fingerprint, fingerprint])).label("the grant is for the card's fingerprint");
    }

    const trace = await bookingTrace(run.api, run.sessionId);
    t.check(
      trace.worldCalls.filter((call) => call.startsWith("reschedule")),
      equals(["reschedule rescheduled"]),
    ).label("exactly one reschedule");
    const [intent] = await sessionIntents(run.api, run.sessionId);
    t.check([intent?.action, intent?.state, intent?.attempts], equals(["reschedule", "confirmed", 1]));
    t.check(trace.changeKeys, equals([intent?.idempotencyKey])).label("reschedule used the grant's key");

    const movedAt = run.turns.findIndex((turn) => executionsIn(turn).some((output) => output.kind === "rescheduled"));
    await t.require(movedAt >= 0, equals(true));
    t.check(
      run.turns.slice(0, movedAt).some((turn) => /\bMoved\b/.test(turn.reply)),
      equals(false),
    ).label("no Moved before the tap");
    if (run.mode === "offline") t.check(move?.to, equals(SATURDAY_SLOTS.at14.start));
  },
});
