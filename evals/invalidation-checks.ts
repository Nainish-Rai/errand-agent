import type { ExecuteProposalOutput, ProposalView } from "@errand/contracts";
import type { EveEvalContext } from "eve/evals";
import { equals } from "eve/evals/expect";

import { bookingChanges, cardsIn, executionsIn, fingerprintOfBooking } from "./approval-checks";
import type { ScenarioRun } from "./scenario-run";

// The shared end state of the ticket 06 scenarios: the first tap's approval stopped being good
// before the booking (the provider changed the terms, or the hold ran out), so it booked nothing
// and a fresh card took its place; the booking happened only after the second tap, on the fresh
// card, exactly once. Graded on state: proposals, grants and the world's bookings.

export interface Reapproved {
  /** execute_proposal's answer to the first tap. */
  readonly refusal: ExecuteProposalOutput;
  /** What the agent said in that turn. */
  readonly refusalReply: string;
  /** The first proposal, as the API has it now (voided or expired). */
  readonly first: ProposalView;
  /** The fresh proposal that replaced it, as the API has it now. */
  readonly fresh: ProposalView;
}

export async function expectBookedOnlyAfterFreshApproval(
  t: EveEvalContext,
  run: ScenarioRun,
  refusalKind: "approval_invalidated" | "hold_reproposed",
): Promise<Reapproved | undefined> {
  t.succeeded();
  await t.require(run.taps.map((tap) => `${tap.tap} ${tap.status}`), equals(["approve 200", "approve 200"]));

  // The first tap's turn: execute refused, booked nothing, and put the fresh card on screen.
  const refusedAt = run.turns.findIndex((turn) => executionsIn(turn).some((output) => output.kind === refusalKind));
  await t.require(refusedAt >= 0, equals(true));
  const refusal = executionsIn(run.turns[refusedAt]).find((output) => output.kind === refusalKind);
  if (refusal === undefined || refusal.freshProposal === null || refusal.proposal === null) return undefined;
  t.check(refusal.bookingId, equals(null)).label("the first tap's execution booked nothing");
  t.check(cardsIn(run.turns[refusedAt]).at(-1)?.proposalId, equals(refusal.freshProposal.proposalId)).label("a fresh card is the last one on screen");
  t.check(run.taps.map((tap) => tap.proposalId), equals([refusal.proposal.proposalId, refusal.freshProposal.proposalId])).label(
    "the second tap was on the fresh card",
  );

  const proposals = await run.api.listSessionProposals(run.sessionId);
  await t.require(proposals.length, equals(2));
  const [fresh, first] = proposals;
  if (fresh === undefined || first === undefined) return undefined;
  t.check(first.proposalId, equals(refusal.proposal.proposalId));
  t.check(first.invalidation?.replacedBy, equals(fresh.proposalId)).label("the first proposal names its replacement");
  t.check(fresh.status, equals("executed")).label("the fresh proposal was executed");
  t.check(fresh.fingerprint === first.fingerprint, equals(false)).label("the fresh proposal has its own fingerprint");

  // Exactly one booking, made by the fresh proposal's own consumed grant, matching its terms.
  const { made } = await bookingChanges(run);
  await t.require(made.length, equals(1));
  const [booking] = made;
  t.check(booking?.approval?.proposalId, equals(fresh.proposalId)).label("the booking is the fresh proposal's");
  t.check(booking?.approval?.grantId, equals(fresh.grant?.grantId)).label("the booking used the fresh grant");
  t.check(booking?.approval?.grantId === first.grant?.grantId, equals(false)).label("no booking against the old grant");
  t.check(booking === undefined ? undefined : fingerprintOfBooking(booking), equals(fresh.fingerprint)).label(
    "the booking matches the fresh card's fingerprint",
  );
  t.check([booking?.providerId, booking?.slot.start, booking?.priceInr], equals([fresh.terms.providerId, fresh.terms.slot.start, fresh.terms.priceInr]));
  t.check((await run.api.getErrand(run.sessionId))?.state, equals("done"));

  // Only the turn after the second tap says Booked.
  const bookedAt = run.turns.findIndex((turn) => executionsIn(turn).some((output) => output.kind === "booked"));
  t.check(bookedAt > refusedAt, equals(true)).label("booked only after the second tap");
  t.check(run.turns.slice(0, bookedAt).some((turn) => /\bBooked\b/.test(turn.reply)), equals(false)).label("no Booked before the second tap");
  return { refusal, refusalReply: run.turns[refusedAt]?.reply ?? "", first, fresh };
}
