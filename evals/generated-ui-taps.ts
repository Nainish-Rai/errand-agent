import { askFormMessage, chooseMessage, pickMessage, slotLabel, type ApiClient, type ChatTurn } from "@errand/client";
import { ErrandSearchOutputSchema, type AskField, type AskFormProps, type PickOptionProps, type ProviderChoiceProps, type Slot } from "@errand/contracts";

import { generatedUiCalls, isDrawn } from "./generated-ui-checks";
import type { AskAnswer } from "./users/user";

// What the scripted user's taps on generated UI send, worked out the way the chat's components work
// them out: the same message builders (packages/client generated-ui/answers.ts), from what is on
// screen. Each returns the message to send, or undefined when nothing on screen takes that tap.

function drawnProps<T>(turns: readonly ChatTurn[], component: string): T[] {
  return generatedUiCalls(turns)
    .filter(isDrawn)
    .flatMap((call) => call.parsed.elements.filter((element) => element.component === component).map((element) => element.props as T));
}

/** The earliest slot a card shows for this provider: the search option's, or the provider's first free one. */
function cardSlot(turns: readonly ChatTurn[], providerId: string): { readonly onScreen: boolean; readonly earliest?: Slot } {
  for (const turn of [...turns].reverse()) {
    for (const call of [...turn.toolCalls].reverse()) {
      if (call.name !== "search_providers") continue;
      const output = ErrandSearchOutputSchema.safeParse(call.output);
      if (!output.success || output.data.kind !== "found") continue;
      const option = output.data.options.find((candidate) => candidate.providerId === providerId);
      if (option !== undefined) return { onScreen: true, earliest: option.earliestSlot };
      const provider = output.data.providers.find((candidate) => candidate.id === providerId);
      if (provider !== undefined) return { onScreen: true, ...(provider.freeSlots[0] === undefined ? {} : { earliest: provider.freeSlots[0] }) };
    }
  }
  return { onScreen: drawnProps<ProviderChoiceProps>(turns, "ProviderChoice").some((choice) => choice.providerId === providerId) };
}

/** Choose on a provider card: "I'll take <name>, <earliest slot>." */
export async function chooseTap(api: ApiClient, turns: readonly ChatTurn[], providerId: string): Promise<string | undefined> {
  const card = cardSlot(turns, providerId);
  if (!card.onScreen) return undefined;
  const provider = await api.getProvider(providerId);
  const earliest = card.earliest ?? provider.freeSlots[0];
  return chooseMessage(provider.name, earliest === undefined ? undefined : slotLabel(earliest));
}

/** The missing-details form, filled and sent: only the fields it shows that the errand still misses. */
export async function askFormTap(
  api: ApiClient,
  sessionId: string | undefined,
  turns: readonly ChatTurn[],
  answer: AskAnswer,
): Promise<string | undefined> {
  const form = drawnProps<AskFormProps>(turns, "AskForm").at(-1);
  if (form === undefined || sessionId === undefined) return undefined;
  const missing = new Set<AskField>((await api.getErrand(sessionId))?.missing ?? []);
  const values = Object.fromEntries(
    form.fields.filter((field) => missing.has(field) && answer[field] !== undefined).map((field) => [field, answer[field]]),
  );
  const message = askFormMessage({ values, ...(answer.budgetInr === undefined ? {} : { budgetInr: answer.budgetInr }) });
  return message === "" ? undefined : message;
}

/** An option in the latest pick-one list (its options are PickOption calls in the same program). */
export function pickTap(turns: readonly ChatTurn[], label: string): string | undefined {
  const call = generatedUiCalls(turns)
    .filter(isDrawn)
    .findLast((candidate) => candidate.parsed.elements.some((element) => element.component === "PickOne"));
  const options = call?.parsed.elements.filter((element) => element.component === "PickOption").map((element) => element.props as PickOptionProps) ?? [];
  return options.some((option) => option.label === label) ? pickMessage(label) : undefined;
}
