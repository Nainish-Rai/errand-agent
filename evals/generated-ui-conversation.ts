import type { ModelScriptTurn, ModelStep } from "@errand/contracts";

import { CHEAPEST_PLUMBER } from "./booking-conversation";

// The scripted model's generated UI, shared by the generated-ui scenarios. Same world as the
// booking scenarios (happy_path, seed 42, Koramangala plumbers on the pinned clock).

export const KORAMANGALA_PLUMBERS = [
  "prv_plumber_koramangala_1",
  "prv_plumber_koramangala_4",
  CHEAPEST_PLUMBER.providerId,
  "prv_plumber_koramangala_8",
] as const;

export function presentUi(program: readonly string[]): ModelStep {
  return { toolCalls: [{ name: "present_ui", input: { ui: program.join("\n") } }] };
}

export function askUi(program: readonly string[]): ModelStep {
  return { toolCalls: [{ name: "ask_ui", input: { ui: program.join("\n") } }] };
}

/** Four plumbers compared: a price chart, free slots per day, and the person's spend. */
export const CHARTS_TURN: ModelScriptTurn = {
  steps: [
    presentUi([
      "root = Stack([prices, days, spend])",
      `prices = PriceChart([${KORAMANGALA_PLUMBERS.map((id) => `"${id}"`).join(", ")}], "Prices compared")`,
      `days = SlotsPerDayChart([${KORAMANGALA_PLUMBERS.map((id) => `"${id}"`).join(", ")}], "Free slots this week")`,
      'spend = SpendChart(6, "What you spent")',
    ]),
    { text: "Here are their prices and free slots side by side, and what you've spent lately." },
  ],
};
