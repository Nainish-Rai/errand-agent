import type { EveEvalContext } from "eve/evals";
import { equals } from "eve/evals/expect";

import { approvalDeadlineOf } from "../../approval-checks";
import { ASK_FOR_PLUMBER, CHOOSE_CHEAPEST, executeTurn, HOLD_AND_PROPOSE_TURN, SEARCH_TURN } from "../../booking-conversation";
import { defineScenario } from "../../scenario";

// The scripted user taps Approve through the same endpoint the approval card's button calls, and
// gets a real grant for the card's fingerprint. Then the endpoint's contract: a repeated click
// gets the same grant, a fingerprint the card didn't show is refused, a malformed body is a 400,
// and a proposal that isn't the person's (or doesn't exist) is a 404.

async function approve(t: EveEvalContext, proposalId: string, body: unknown) {
  const response = await t.target.fetch(`/api/v1/proposals/${proposalId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined };
}

export default defineScenario({
  id: "scenarios/approval/approve-click-reaches-the-api",
  description: "A tap on Approve reaches POST /api/v1/proposals/:id/approve with the card's fingerprint and mints one grant.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { card: "approve" }],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. " +
    "When the approval card appears, tap Approve on it. Once the assistant has replied to that, you are done.",
  maxSimulatedMessages: 4,
  model: {
    turns: [SEARCH_TURN, HOLD_AND_PROPOSE_TURN, executeTurn("Booked: Shiva Sanitary Solutions, ₹399. Booking ID bkg_0002.")],
  },
  expected:
    "the Approve tap gets 200 and a grant for the card's fingerprint; a repeated click returns the same grant; a wrong fingerprint gets 409, a malformed body 400 and an unknown proposal 404",
  async expect(t, run) {
    t.succeeded();
    await t.require(run.taps.map((tap) => `${tap.tap} ${tap.status} ${tap.code}`), equals(["approve 200 approved"]));
    const proposalId = run.taps[0]?.proposalId ?? "";
    const proposal = await run.api.getProposal(proposalId);
    await t.require(proposal.grant !== null, equals(true));
    t.check(proposal.grant?.fingerprint, equals(proposal.fingerprint)).label("the grant is for the card's fingerprint");
    t.check(Date.parse(proposal.grant?.expiresAt ?? "") <= Date.parse(approvalDeadlineOf(proposal)), equals(true)).label(
      "the grant expires no later than the hold",
    );

    const again = await approve(t, proposalId, { fingerprint: proposal.fingerprint });
    t.check([again.status, again.body?.grantId], equals([200, proposal.grant?.grantId])).label("a repeated click gets the same grant");

    const forged = await approve(t, proposalId, { fingerprint: `fp_${"0".repeat(64)}` });
    t.check([forged.status, (forged.body?.error as { code?: string } | undefined)?.code], equals([409, "fingerprint_mismatch"]));

    t.check((await approve(t, proposalId, {})).status, equals(400)).label("a click without a fingerprint");
    t.check((await approve(t, "prp_missing", { fingerprint: proposal.fingerprint })).status, equals(404));
  },
});
