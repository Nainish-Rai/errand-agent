import { NOT_IMPLEMENTED_ERROR_CODE } from "@errand/contracts";
import { equals } from "eve/evals/expect";

import { defineScenario } from "../../scenario";

// The scripted user clicks Approve through the same endpoint the approval card's button calls.
// Until ticket 05 the endpoint validates the body and answers 501; ticket 05 replaces the stub
// proposal with a real one and expects a grant here.

const CLICK = { proposalId: "prp_ticket02_stub", fingerprint: "fp_ticket02_stub" };

export default defineScenario({
  id: "scenarios/approval/approve-click-reaches-the-api",
  description: "The scripted user's Approve click reaches the app API's approve endpoint, which is a stub until ticket 05.",
  world: { scenario: "happy_path", seed: 42 },
  user: [
    { say: "find a plumber in Koramangala this week" },
    { say: "Book the first one, tomorrow morning." },
    { approve: CLICK },
  ],
  goal:
    "You want a plumber in Koramangala this week. Look at the options the assistant finds; " +
    "once you have seen them you are done.",
  maxSimulatedMessages: 1,
  model: {
    turns: [
      {
        steps: [
          {
            toolCalls: [
              {
                name: "search_providers",
                input: { service: "plumber", area: "Koramangala", date_range: { from: "2026-11-04", to: "2026-11-10" } },
              },
            ],
          },
          { text: "Here are the plumbers in Koramangala with free slots this week." },
        ],
      },
      { steps: [{ text: "Here is the booking to approve. Tap Approve on the card to book it." }] },
    ],
  },
  expected: `the Approve click reaches POST /api/v1/proposals/:id/approve with the card's fingerprint and gets 501 ${NOT_IMPLEMENTED_ERROR_CODE}; a click without a fingerprint gets 400`,
  async expect(t, run) {
    t.succeeded();
    await t.require(run.clicks.length, equals(1));
    const [click] = run.clicks;
    t.check(click?.status, equals(501));
    t.check(click?.code, equals(NOT_IMPLEMENTED_ERROR_CODE));

    // The endpoint holds clients to the contract even as a stub.
    const malformed = await t.target.fetch(`/api/v1/proposals/${CLICK.proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    t.check(malformed.status, equals(400));
  },
});
