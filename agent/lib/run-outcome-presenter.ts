import type { RunOutcome } from "../../src/core/budget/outcome";
import type { BudgetLimit } from "../../src/core/budget/run-budget";

// The one place a run's outcome becomes words for the person. Every outcome has exactly one
// message. When the system stops a run (a budget runs out, a tool fails), this message is the
// reply the chat shows; when the run ends on its own, the model's reply says the specifics and
// this message is the outcome's line in the run trace.

const LIMIT_WORDS: Readonly<Record<BudgetLimit, string>> = {
  model_turns: "the most steps one request may take",
  tool_calls: "the most actions one request may take",
  wall_clock: "the time one request may take",
};

function seconds(ms: number): string {
  return `${Math.round(ms / 1_000)} seconds`;
}

function usedWords(outcome: Extract<RunOutcome, { readonly kind: "budget_exhausted" }>): string {
  if (outcome.limit === "wall_clock") return `(${seconds(outcome.cap)})`;
  return `(${outcome.cap})`;
}

export function presentRunOutcome(outcome: RunOutcome): string {
  switch (outcome.kind) {
    case "completed":
      return "Done.";
    case "needs_user":
      return "Over to you: I need your answer before I go on.";
    case "verifying":
      return "I'm checking with the provider whether it went through, and I'll update you here as soon as I know.";
    case "budget_exhausted":
      return (
        `I stopped working on this because it reached ${LIMIT_WORDS[outcome.limit]} ${usedWords(outcome)}. ` +
        "I didn't take any further action. Send a message to pick it up again."
      );
    case "failed":
      return (
        "Something went wrong on my side, so I stopped here without taking any further action. " +
        "Please try again in a moment."
      );
  }
}
