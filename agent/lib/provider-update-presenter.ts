import { PROVIDER_UPDATE_PREFIX, type ProviderEventOutcomeView } from "@errand/contracts";

import type { Errand } from "../../src/core/errand/errand";
import type { ServiceKind } from "../../src/core/ports/provider-world";
import type { CancelledVisit } from "../../src/core/provider-events/provider-cancellation";
import type { HandleProviderCancelledOutcome } from "../../src/core/use-cases/handle-provider-cancelled";
import { when } from "./approval-presenter";

// A provider's cancellation in words: the update the chat shows (the backend writes it, not the
// person), the instructions a rebooking turn gets, and the dev route's answer. Every value comes
// from the world's booking and the errand core built; the event's own text never reaches the model.

const SERVICE_WORDS: Readonly<Record<ServiceKind, string>> = {
  plumber: "plumber visit",
  electrician: "electrician visit",
  ac_servicing: "AC servicing",
  carpenter: "carpenter visit",
  cleaner: "cleaning",
};

/** The provider update put in the chat; the chat shows it as an update, not as the person speaking. */
export function presentProviderUpdate(visit: CancelledVisit): string {
  return `${PROVIDER_UPDATE_PREFIX} ${visit.providerName} cancelled your ${SERVICE_WORDS[visit.service]} on ${when(visit.slot.start)} (booking ${visit.bookingId}).`;
}

/** True for a provider update the backend wrote into the chat. */
export function isProviderUpdate(text: string): boolean {
  return text.trimStart().startsWith(PROVIDER_UPDATE_PREFIX);
}

/**
 * What a turn in a rebooking chat is told. While the replacement errand is still gathering, the
 * search to run, built from the errand core prefilled with the person's saved preferences; after
 * that, only who is excluded and that nothing is rebooked without a tap.
 */
export function presentRebookingInstructions(errand: Errand): string | undefined {
  const { replacing, details } = errand;
  if (replacing === undefined) return undefined;
  const lines = [
    `This chat is replacing booking ${replacing.bookingId}: ${replacing.providerName} cancelled it. ` +
      `${replacing.providerName} is excluded in code; never offer it. A new booking needs the person's tap on a new approval card; never say it's rebooked before execute_proposal says booked.`,
  ];
  const window = details.timeWindow;
  if (errand.state === "gathering" && details.service !== undefined && details.area !== undefined && window !== undefined) {
    const saved = [
      details.budget === undefined ? undefined : `budget up to ₹${details.budget.maxInr}`,
      window.hours === undefined ? undefined : `not before ${window.hours.from}:00`,
    ].filter((part): part is string => part !== undefined);
    lines.push(
      "The provider update above came from the system, not the person. In this turn: tell them in one short sentence " +
        `that ${replacing.providerName} cancelled and you're finding a replacement. Then call search_providers with ` +
        `service "${details.service}", area "${details.area}" and date_range {"from": "${window.dates.from}", "to": "${window.dates.to}"}` +
        (saved.length === 0 ? "." : ` (the errand already applies their saved ${saved.join(" and ")}).`) +
        " Then hold the best_match option's earliest slot with hold_slot and call propose_action with action book, and ask them to check the card.",
    );
  }
  return lines.join("\n");
}

export function presentProviderEventOutcome(outcome: HandleProviderCancelledOutcome): ProviderEventOutcomeView {
  switch (outcome.kind) {
    case "notified":
      return { kind: "notified", sessionId: outcome.sessionId, deliveryId: outcome.deliveryId, resumed: outcome.resumed };
    case "skipped":
      return { kind: "skipped", reason: outcome.reason };
    case "duplicate":
      return { kind: "duplicate", decision: outcome.decision, skipReason: outcome.skipReason ?? null, sessionId: outcome.sessionId ?? null };
  }
}
