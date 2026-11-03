import { equals } from "eve/evals/expect";

import { ASK_FOR_PLUMBER, SEARCH_TURN } from "../../booking-conversation";
import { CHARTS_TURN, KORAMANGALA_PLUMBERS } from "../../generated-ui-conversation";
import { generatedUiCalls, generatedUiMatchesWorld, isDrawn, shownValues } from "../../generated-ui-checks";
import { defineScenario } from "../../scenario";

// Charts: four plumbers' prices, their free slots per day this week, and the person's spend over
// six months. Every bar is bound from the API by id, and equals the world: prices from the seeded
// catalogue, free slots from the seed's slots, spend from the world's bookings.

export default defineScenario({
  id: "scenarios/generated-ui/charts-equal-the-world",
  description: "Price, free-slots-per-day and spend charts show exactly the world's numbers.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: "Compare four of them for me, and show what I've spent lately." }],
  goal:
    "You want a plumber in Koramangala this week. After the options appear, ask the assistant to compare four of them " +
    "and show what you've spent on home services lately. Don't book anything; once it has answered, you are done.",
  maxSimulatedMessages: 2,
  model: { turns: [SEARCH_TURN, CHARTS_TURN] },
  expected: "three charts drawn; four price bars, seven day bars and six month bars, every value equal to the world's",
  async expect(t, run) {
    t.succeeded();
    const drawn = generatedUiCalls(run.turns).filter(isDrawn);
    await t.require(drawn.length >= 1, equals(true));
    const shown = await Promise.all(drawn.map((call) => shownValues(run.api, call)));
    const priceBars = shown.flatMap((values) => values.priceBars);
    const dayBars = shown.flatMap((values) => values.dayBars.flatMap((chart) => chart.bars));
    const monthBars = shown.flatMap((values) => values.monthBars.flatMap((chart) => chart.bars));
    if (run.mode === "offline") {
      t.check(priceBars.map((bar) => bar.providerId), equals([...KORAMANGALA_PLUMBERS])).label("one price bar per option");
      t.check([dayBars.length, monthBars.length], equals([7, 6])).label("a week of days and six months");
      t.check(monthBars.some((bar) => bar.spendInr > 0), equals(true)).label("the seeded bookings show as spend");
    }
    t.check(await generatedUiMatchesWorld(run), equals([])).label("every bar equals the world");
  },
});
