import type { ErrandSearchOutput } from "@errand/contracts";
import { equals } from "eve/evals/expect";

import { searchesIn, THIS_WEEK } from "../../errand-checks";
import { defineScenario } from "../../scenario";

// SPEC "options outside my budget or time window left out": the world has plumbers over ₹800 and
// slots outside the morning, and none of them reaches the person. Prices are checked against the
// world's own values, not the tool's.

const MAX_INR = 800;
const MORNING = { from: 8, to: 12 };
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000;

function insideWindow(slot: { readonly start: string; readonly end: string }): boolean {
  const start = new Date(Date.parse(slot.start) + IST_OFFSET_MS);
  const end = new Date(Date.parse(slot.end) + IST_OFFSET_MS);
  const day = start.toISOString().slice(0, 10);
  const endHour = end.getUTCHours() + end.getUTCMinutes() / 60 || 24;
  return day >= THIS_WEEK.from && day <= THIS_WEEK.to && start.getUTCHours() >= MORNING.from && endHour <= MORNING.to;
}

type Found = Extract<ErrandSearchOutput, { kind: "found" }>;

export default defineScenario({
  id: "scenarios/compare/options-respect-budget-and-window",
  description: "With a budget and mornings only, every provider and option shown is within budget and inside the window, tagged.",
  world: { scenario: "default", seed: 42 },
  user: [{ say: "Plumber in Koramangala this week, mornings only, under ₹800" }],
  goal:
    "You need a plumber in Koramangala this week, mornings only, and you won't pay more than ₹800. Your first " +
    "message asks for exactly that, in your own words, e.g. 'Need a plumber in Koramangala this week, mornings " +
    "only, under ₹800'. Don't book anything; once you have seen the options you are done.",
  maxSimulatedMessages: 1,
  model: {
    turns: [
      {
        steps: [
          {
            toolCalls: [
              {
                name: "update_errand",
                input: {
                  service: "plumber",
                  area: "Koramangala",
                  time_window: { ...THIS_WEEK, earliest_hour: MORNING.from, latest_hour: MORNING.to },
                  budget_inr: MAX_INR,
                },
              },
            ],
          },
          {
            toolCalls: [
              { name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } },
            ],
          },
          { text: "Here are the best match, the cheapest and the earliest plumber for a morning this week under ₹800." },
        ],
      },
    ],
  },
  expected:
    "2–3 options tagged best match, cheapest and earliest; every provider and option shown costs at most ₹800 (by the world's price) and every slot shown is a morning this week; the over-budget ones are counted as left out",
  async expect(t, run) {
    t.succeeded();
    const searches = searchesIn(run.turns.at(-1));
    const found = searches.findLast((search): search is Found => search.kind === "found");
    await t.require(found !== undefined, equals(true));
    if (found === undefined) return;

    t.check(found.options.length >= 2 && found.options.length <= 3, equals(true)).label("two or three options");
    const tags = new Set(found.options.flatMap((option) => option.tags));
    t.check(["best_match", "cheapest", "earliest"].every((tag) => tags.has(tag as never)), equals(true)).label("all three tags");
    t.check(found.excluded.overBudget > 0, equals(true)).label("the world had plumbers over budget, and they were left out");

    // The world's own prices, not the tool's, for every provider shown.
    const shownIds = [...new Set([...found.providers.map((p) => p.id), ...found.options.map((o) => o.providerId)])];
    const truth = await run.api.getProviders(shownIds);
    t.check(truth.length, equals(shownIds.length));
    t.check(truth.every((provider) => provider.priceInr <= MAX_INR), equals(true)).label("nothing shown is over budget");
    t.check(found.providers.every((provider) => provider.freeSlots.length > 0 && provider.freeSlots.every(insideWindow)), equals(true)).label(
      "every slot shown is a morning this week",
    );
    t.check(found.options.every((option) => insideWindow(option.earliestSlot)), equals(true)).label("every option's slot is inside the window");
  },
});
