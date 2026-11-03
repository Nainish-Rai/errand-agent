import type { ExecuteProposalOutput } from "@errand/contracts";
import { equals } from "eve/evals/expect";

import { bookingChanges, executionsIn } from "../../approval-checks";
import { AC_BOOKING, acBookingNow, FIND_SATURDAY_STEPS, proposeMoveTurn, SATURDAY, SATURDAY_SLOTS } from "../../booking-change-conversation";
import { executeTurn } from "../../booking-conversation";
import { bookingTrace, sessionIntents } from "../../ledger-checks";
import { defineScenario } from "../../scenario";

// Ticket 10, "reschedule slot conflict". The provider refuses the approved new time. Nothing moves,
// the person hears it with the provider's other free times that day, and the closest one is a
// fresh card that needs its own tap: a typed "yes" moves nothing. Tapping the fresh card moves it.

export default defineScenario({
  id: "scenarios/booking-changes/reschedule-slot-conflict",
  description: "The provider refuses the new time: nothing moves, other times are offered, and the fresh card needs its own approval.",
  world: { scenario: "reschedule_conflict", seed: 42 },
  user: [{ say: "Move my AC servicing to Saturday morning" }, { card: "approve" }, { say: "OK, yes, that one." }, { card: "approve" }],
  goal:
    "You have an AC servicing visit booked and want to move it to Saturday morning. Your first message says exactly " +
    "that. When a card appears, tap Approve on it. If the provider can't do that time and a new card appears, first " +
    "say yes in the chat (don't tap), then, once the assistant answers, tap Approve on the new card. Once the " +
    "assistant tells you the outcome of that tap, you are done.",
  maxSimulatedMessages: 5,
  model: {
    turns: [
      {
        steps: [
          ...FIND_SATURDAY_STEPS,
          ...proposeMoveTurn(
            SATURDAY_SLOTS.at8,
            "On Saturday morning they're free at 8 am. Check the card: Mon 9 Nov 11:00 am → Sat 7 Nov 8:00 am. Tap Approve if that's right.",
          ).steps,
        ],
      },
      executeTurn("Ravi Aircon Experts can't do 8 am after all, so nothing moved. They're free at 2 pm, 3 pm or 6 pm; the card for 2 pm needs your tap."),
      executeTurn("Nothing has moved yet: only a tap on Approve on the new card can move it."),
      executeTurn(`Moved: Ravi Aircon Experts, now Sat 7 Nov at 2:00 pm IST. Booking ID ${AC_BOOKING.bookingId}.`),
    ],
  },
  expected:
    "execute_proposal → reschedule_conflict with other Saturday slots (the refused one not among them) and a fresh pending card with no grant; the booking still on Mon 9 Nov 11:00; a typed yes → not_approved; the tap on the fresh card → rescheduled to its slot",
  actual(run) {
    const outputs = run.toolCalls.filter((call) => call.name === "execute_proposal").map((call) => (call.output as { kind?: string } | undefined)?.kind);
    return `execute_proposal → ${outputs.join(", ") || "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    const executions: ExecuteProposalOutput[] = run.turns.flatMap((turn) => executionsIn(turn));
    const conflictAt = executions.findIndex((output) => output.kind === "reschedule_conflict");
    await t.require(conflictAt >= 0, equals(true));
    const conflict = executions[conflictAt];
    const refused = conflict?.proposal?.terms.slot.start;
    const alternatives = conflict?.alternativeSlots ?? [];
    t.check(alternatives.length > 0, equals(true)).label("other times are offered");
    t.check(
      alternatives.some((slot) => slot.start === refused),
      equals(false),
    ).label("the refused time is not offered again");
    t.check(
      alternatives.every((slot) => slot.start.slice(0, 10) === SATURDAY.from),
      equals(true),
    ).label("the other times are that day");
    t.check(/nothing (was )?moved/i.test(conflict?.message ?? ""), equals(true)).label("the person hears that nothing moved");

    const fresh = conflict?.freshProposal;
    await t.require(fresh?.terms.action, equals("reschedule"));
    t.check(fresh?.terms.slot.start, equals(alternatives[0]?.start)).label("the fresh card is for the closest other time");
    t.check(fresh?.proposalId !== conflict?.proposal?.proposalId, equals(true)).label("the fresh card is a new proposal");

    // Between the conflict and the tap on the fresh card nothing moved: a typed yes approves nothing.
    const between = executions.slice(conflictAt + 1);
    t.check(between[0]?.kind, equals("not_approved")).label("a typed yes moves nothing");
    t.check(between.at(-1)?.kind, equals("rescheduled")).label("the tap on the fresh card moves it");

    const trace = await bookingTrace(run.api, run.sessionId);
    t.check(
      trace.worldCalls.filter((call) => call.startsWith("reschedule")),
      equals(["reschedule slot_conflict", "reschedule rescheduled"]),
    );
    const intents = await sessionIntents(run.api, run.sessionId);
    t.check(
      intents.map((intent) => [intent.action, intent.state, intent.failureReason]),
      equals([
        ["reschedule", "failed", "slot_conflict"],
        ["reschedule", "confirmed", null],
      ]),
    ).label("the refused move failed in the ledger; the fresh one has its own grant");

    const { made, altered } = await bookingChanges(run);
    t.check(made.length, equals(0)).label("nothing new is booked");
    t.check(
      altered.map((booking) => booking.bookingId),
      equals([AC_BOOKING.bookingId]),
    );
    const booking = await acBookingNow(run.api);
    t.check(booking?.slot.start, equals(fresh?.terms.slot.start)).label("the booking is at the fresh card's slot, not the refused one");
    t.check(
      booking?.changes.map((change) => [change.status, change.grantConsumed]),
      equals([
        ["failed", true],
        ["executed", true],
      ]),
    ).label("each move had its own consumed grant");
    if (run.mode === "offline") t.check([refused, fresh?.terms.slot.start], equals([SATURDAY_SLOTS.at8.start, SATURDAY_SLOTS.at14.start]));
  },
});
