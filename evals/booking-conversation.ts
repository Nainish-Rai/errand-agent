import type { ModelScriptTurn } from "@errand/contracts";

import { THIS_WEEK } from "./errand-checks";

// The scripted model's side of choosing and booking a plumber, shared by the approval scenarios.
// The world is `happy_path`, seed 42, on the evals' pinned clock (Wednesday 2026-11-04, 09:00 IST):
// the cheapest plumber in Koramangala is Shiva Sanitary Solutions at ₹399, first free on Thursday
// at 08:00. A fresh world numbers its ids in order, so the hold is hold_0001 and the booking bkg_0002.

export const CHEAPEST_PLUMBER = {
  providerId: "prv_plumber_koramangala_5",
  slot: { start: "2026-11-05T08:00:00+05:30", end: "2026-11-05T09:00:00+05:30" },
  priceInr: 399,
} as const;

export const FIRST_BOOKING_ID = "bkg_0002";

export const ASK_FOR_PLUMBER = "Find a plumber in Koramangala this week";
export const CHOOSE_CHEAPEST = "The cheapest one, please.";

export const SEARCH_TURN: ModelScriptTurn = {
  steps: [
    { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } }] },
    { text: "Here are the best match, the cheapest and the earliest plumber in Koramangala this week. Which one should I book?" },
  ],
};

/** The person picked the cheapest: hold its slot, then show the approval card. */
export const HOLD_AND_PROPOSE_TURN: ModelScriptTurn = {
  steps: [
    { toolCalls: [{ name: "hold_slot", input: { provider_id: CHEAPEST_PLUMBER.providerId, slot: CHEAPEST_PLUMBER.slot } }] },
    { toolCalls: [{ name: "propose_action", input: { action: "book" } }] },
    { text: "I've held the slot. Check the card and tap Approve ₹399 if it's right." },
  ],
};

/** HOLD_AND_PROPOSE_TURN with its own closing line, for worlds where the held price isn't ₹399. */
export function holdAndProposeTurn(reply: string): ModelScriptTurn {
  return { steps: [...HOLD_AND_PROPOSE_TURN.steps.slice(0, -1), { text: reply }] };
}

/** The person said to go ahead (tapped, or typed): execute, then relay what core said. */
export function executeTurn(reply: string): ModelScriptTurn {
  return { steps: [{ toolCalls: [{ name: "execute_proposal", input: {} }] }, { text: reply }] };
}
