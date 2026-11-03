import type { ProviderSummary, Slot } from "@errand/contracts";
import { equals } from "eve/evals/expect";

import { cardsIn } from "../../approval-checks";
import { LAST_ELECTRICIAN } from "../../booking-change-conversation";
import { searchesIn, THIS_WEEK } from "../../errand-checks";
import { defineScenario } from "../../scenario";

// Ticket 10, "same electrician as last time". The agent finds the last electrician in the booking
// history, sets the time window to start at 10:00, and proposes that provider. No slot before
// 10:00 IST reaches the person, in any search result or on the card.

const EARLIEST_HOUR = 10;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000;

function istHourOf(slot: Slot): number {
  return new Date(Date.parse(slot.start) + IST_OFFSET_MS).getUTCHours();
}

export default defineScenario({
  id: "scenarios/booking-changes/same-electrician-as-last-time",
  description: "The last electrician is found in the booking history and proposed, with no slot before 10:00 offered.",
  world: { scenario: "happy_path", seed: 42 },
  user: [
    {
      say: "Book the same electrician as last time, this week, but not before 10 a.m.",
    },
  ],
  goal:
    "You want the same electrician you booked last time, some day this week, but not before 10 a.m. Your first " +
    "message says exactly that. If asked, say any day this week is fine. Once an approval card appears, you are done; don't tap it.",
  maxSimulatedMessages: 2,
  model: {
    turns: [
      {
        steps: [
          { toolCalls: [{ name: "list_bookings", input: {} }] },
          {
            toolCalls: [
              {
                name: "update_errand",
                input: {
                  service: "electrician",
                  area: "Koramangala",
                  time_window: { ...THIS_WEEK, earliest_hour: EARLIEST_HOUR },
                },
              },
            ],
          },
          {
            toolCalls: [
              {
                name: "search_providers",
                input: {
                  service: "electrician",
                  area: "Koramangala",
                  date_range: THIS_WEEK,
                },
              },
            ],
          },
          {
            toolCalls: [
              {
                name: "hold_slot",
                input: {
                  provider_id: LAST_ELECTRICIAN.providerId,
                  slot: {
                    start: "2026-11-04T11:00:00+05:30",
                    end: "2026-11-04T12:00:00+05:30",
                  },
                },
              },
            ],
          },
          {
            toolCalls: [{ name: "propose_action", input: { action: "book" } }],
          },
          {
            text: "Lakshmi Wiring Services did your last electrical job. Their first time from 10 am is today at 11:00 am. Tap Approve ₹999 on the card if that's right.",
          },
        ],
      },
    ],
  },
  expected:
    "list_bookings finds the last electrician (prv_electrician_koramangala_1); the card proposes that provider; no slot before 10:00 IST in any search result or on the card; nothing is booked without a tap",
  actual(run) {
    const card = run.turns.flatMap((turn) => cardsIn(turn)).at(-1);
    return card === undefined ? "no card" : `card: ${card.terms.providerId} at ${card.terms.slot.start}`;
  },
  async expect(t, run) {
    t.succeeded();
    t.check(
      run.toolCalls.some((call) => call.name === "list_bookings"),
      equals(true),
    ).label("the agent read the booking history");

    const card = run.turns.flatMap((turn) => cardsIn(turn)).at(-1);
    await t.require(card?.terms.action, equals("book"));
    t.check(card?.terms.providerId, equals(LAST_ELECTRICIAN.providerId)).label("the card proposes the last electrician");
    t.check(card !== undefined && istHourOf(card.terms.slot) >= EARLIEST_HOUR, equals(true)).label("the card's slot is from 10:00");

    // Every slot the person could have seen: each search's providers and options.
    const shown: Slot[] = run.turns.flatMap((turn) =>
      searchesIn(turn).flatMap((search) =>
        search.kind === "found"
          ? [...search.providers.flatMap((provider: ProviderSummary) => provider.freeSlots), ...search.options.map((option) => option.earliestSlot)]
          : [],
      ),
    );
    t.check(shown.length > 0, equals(true)).label("slots were offered");
    t.check(
      shown.filter((slot) => istHourOf(slot) < EARLIEST_HOUR).map((slot) => slot.start),
      equals([]),
    ).label("no slot before 10:00 is offered");

    const bookings = await run.api.listBookings();
    t.check(bookings.length, equals(run.bookingsBefore.length)).label("nothing is booked without a tap");
  },
});
