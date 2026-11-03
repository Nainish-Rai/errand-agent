import type { ErrandHandoff } from "../errand/errand-handoff";
import type { Clock } from "../ports/clock";
import { checkCard, type CardDependencies, type CardRefusal } from "./start-new-errand";

// "Not now" on a New errand card: the card goes away for good and the chat carries on as it was.
// A card that was already moved stays moved.

export type DismissNewErrandOutcome =
  | { readonly kind: "dismissed"; readonly handoff: ErrandHandoff }
  | { readonly kind: "already_settled"; readonly handoff: ErrandHandoff }
  | CardRefusal;

export async function dismissNewErrand(
  deps: CardDependencies & { readonly clock: Clock },
  request: { readonly fromSessionId: string; readonly toolCallId: string },
): Promise<DismissNewErrandOutcome> {
  // Only a card the session really showed can be dismissed.
  const card = await checkCard(deps.toolCalls, request);
  if (card.kind !== "card") return card;
  const handoff = await deps.handoffs.settle({ kind: "dismissed", ...request, settledAtMs: deps.clock.now().getTime() });
  return handoff.kind === "dismissed" ? { kind: "dismissed", handoff } : { kind: "already_settled", handoff };
}
