import { equals } from "eve/evals/expect";

import { ASK_FOR_PLUMBER, CHEAPEST_PLUMBER, SEARCH_TURN } from "../../booking-conversation";
import { presentUi } from "../../generated-ui-conversation";
import { generatedUiCalls, generatedUiMatchesWorld, isDrawn, shownValues } from "../../generated-ui-checks";
import { defineScenario } from "../../scenario";

// The model writes a wrong price into a provider card's highlight and reason ("₹99"). A card has no
// price prop, so the price it shows is the world's (₹399, bound by id), and the model's words that
// state a number are not shown at all. Live, the model writes its own cards: whatever it draws
// must show the world's values, and its words with a number in them are hidden the same way.

export default defineScenario({
  id: "scenarios/generated-ui/wrong-price-shows-the-world-price",
  description: "A provider card whose model text claims a wrong price still shows the world's price, and hides the claim.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: "Which one would you pick?" }],
  goal:
    "You want a plumber in Koramangala this week. After the options appear, ask which one the assistant would pick. " +
    "Don't book anything; once it has answered, you are done.",
  maxSimulatedMessages: 2,
  model: {
    turns: [
      SEARCH_TURN,
      {
        steps: [
          presentUi([
            "root = Stack([cards])",
            'cards = ProviderChoices([pick], "My pick")',
            `pick = ProviderChoice("${CHEAPEST_PLUMBER.providerId}", "Only ₹99", "Just ₹99 and rated 5.0 by everyone")`,
          ]),
          { text: "I'd go with this one." },
        ],
      },
    ],
  },
  expected:
    "the card is drawn with Shiva Sanitary Solutions at the world's ₹399 and rating 4.5; the model's ₹99 highlight and reason are not shown (live: every drawn card shows the world's values)",
  async expect(t, run) {
    t.succeeded();
    t.check(await generatedUiMatchesWorld(run), equals([])).label("every drawn card shows the world's values");
    if (run.mode !== "offline") return;
    const drawn = generatedUiCalls(run.turns).filter(isDrawn);
    await t.require(drawn.length, equals(1));
    const [call] = drawn;
    if (call === undefined) return;
    const shown = await shownValues(run.api, call);
    t.check(
      shown.choices.map((choice) => [choice.providerId, choice.name, choice.priceInr, choice.rating]),
      equals([[CHEAPEST_PLUMBER.providerId, "Shiva Sanitary Solutions", CHEAPEST_PLUMBER.priceInr, 4.5]]),
    ).label("the card shows the world's price and rating");
    t.check(shown.choices.map((choice) => [choice.highlight, choice.reason]), equals([[undefined, undefined]])).label(
      "the model's price claim is not shown",
    );
  },
});
