import { ApiRequestError, ChatClient } from "@errand/client";
import { SearchProvidersInputSchema } from "@errand/contracts";
import { equals } from "eve/evals/expect";

import { bookingChanges } from "../../approval-checks";
import { ASK_FOR_PLUMBER, CHOOSE_CHEAPEST, executeTurn, FIRST_BOOKING_ID, HOLD_AND_PROPOSE_TURN, SEARCH_TURN } from "../../booking-conversation";
import { THIS_WEEK } from "../../errand-checks";
import { defineScenario } from "../../scenario";

// Ticket 24: once the chat's errand is booked, a different job ("she needs her AC repaired in HSR")
// can't change it. The agent searches the new job so the chat shows the New errand card, says one
// short line about the card, and never tells the person to ask again in a new message. Nothing is
// booked or held for the new job. The card's "Start in a new chat" is then driven through the API,
// as the web card does: the new chat's errand starts from the search, and both chats link.

const NEW_JOB = "She needs her AC repaired too, at my mom's place in HSR Layout.";

/** Telling the person to type the request again, in any of the ways a reply has done it. */
const RETYPE_REQUEST = /\b(re-?type|repeat|ask (me )?again|send (it|that|this|the request|your request)? ?again|new (message|request|conversation)|start a new request)\b/i;

export default defineScenario({
  id: "scenarios/booking/new-job-after-booking",
  description: "In a booked chat, a different job shows the New errand card: no retype paragraph, nothing booked or held, and the card's move starts the new chat's errand.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { card: "approve" }, { say: NEW_JOB }],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. When the " +
    "approval card appears, tap Approve on it. Once the assistant says it's booked, ask for something different in " +
    "one message: your mom needs her AC repaired at her place in HSR Layout. When the assistant answers that, you are done.",
  maxSimulatedMessages: 4,
  model: {
    turns: [
      SEARCH_TURN,
      HOLD_AND_PROPOSE_TURN,
      executeTurn(`Booked: Shiva Sanitary Solutions, Thu 5 Nov at 8:00 am IST, ₹399. Booking ID ${FIRST_BOOKING_ID}.`),
      {
        steps: [
          { toolCalls: [{ name: "search_providers", input: { service: "ac_servicing", area: "HSR Layout", date_range: THIS_WEEK } }] },
          { text: "That's a new errand. Tap Start in a new chat and I'll pick it up there." },
        ],
      },
    ],
  },
  expected:
    "the last turn searches AC servicing in HSR Layout and is refused not_editable (the New errand card), its reply asks nobody to retype; one booking (the plumber), no new hold; the card's move drafts AC servicing in HSR Layout in a new chat linked both ways, and the plumber errand stays done",
  async expect(t, run) {
    t.succeeded();
    const last = run.turns.at(-1);
    const refused = (last?.toolCalls ?? []).find(
      (call) => call.name === "search_providers" && (call.output as { kind?: string } | undefined)?.kind === "not_editable",
    );
    await t.require(refused !== undefined, equals(true));
    const search = SearchProvidersInputSchema.parse(refused?.input);
    t.check([/^ac\b|^ac_|air.?con/i.test(search.service), /hsr/i.test(search.area)], equals([true, true])).label("the card is for AC servicing in HSR");
    t.check(RETYPE_REQUEST.test(last?.reply ?? ""), equals(false)).label("the reply doesn't ask to retype the request");
    t.check((last?.toolCalls ?? []).some((call) => call.name === "hold_slot" || call.name === "propose_action"), equals(false)).label(
      "nothing held or proposed for the new job",
    );

    const { made, altered } = await bookingChanges(run);
    t.check(made.map((booking) => booking.service), equals(["plumber"])).label("only the plumber is booked");
    t.check(altered, equals([])).label("no booking changed");
    const proposals = await run.api.listSessionProposals(run.sessionId);
    t.check(proposals.map((proposal) => proposal.status), equals(["executed"])).label("no new hold or card");

    // "Start in a new chat", as the web card does it: a new session, then the hand-off.
    const session = await new ChatClient({ baseUrl: t.target.url }).startSession();
    const card = { toolCallId: refused?.callId ?? "", toSessionId: session.id, search };
    const forged = await run.api.startNewErrand(run.sessionId, { ...card, toolCallId: "forged-card" }).then(
      () => "moved",
      (error: unknown) => (error instanceof ApiRequestError ? error.code : String(error)),
    );
    t.check(forged, equals("unknown_card")).label("a card id the chat never made is refused");
    const moved = await run.api.startNewErrand(run.sessionId, card);
    t.check([moved.errand?.service, moved.errand?.area, moved.errand?.state], equals(["ac_servicing", "HSR Layout", "gathering"])).label(
      "the new chat's errand starts from the card",
    );
    const fromOld = await run.api.getErrandHandoffs(run.sessionId);
    const fromNew = await run.api.getErrandHandoffs(session.id);
    t.check(fromOld.settled.map((handoff) => handoff.kind === "moved" && handoff.toSessionId), equals([session.id])).label("the old chat says moved");
    t.check([fromNew.startedFrom?.sessionId, fromNew.startedFrom?.service, fromNew.startedFrom?.area], equals([run.sessionId, "plumber", "Koramangala"])).label(
      "the new chat names the chat it came from",
    );
    const old = await run.api.getErrand(run.sessionId);
    t.check([old?.state, old?.service, old?.area], equals(["done", "plumber", "Koramangala"])).label("the booked errand is unchanged");
    t.check((await run.api.listBookings()).length, equals(run.bookingsBefore.length + 1)).label("the move booked nothing");
  },
});
