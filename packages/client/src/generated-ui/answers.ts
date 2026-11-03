import type { AskField } from "@errand/contracts";

// What a tap or a submit in generated UI sends: an ordinary message as the person, the same text
// they could have typed. It carries no authority (the approval card's Approve is the only way to
// authorise anything), and the evals' scripted user sends these same strings.

/** Choose on a provider card. */
export function chooseMessage(providerName: string, slot?: string): string {
  return slot === undefined ? `I'll take ${providerName}.` : `I'll take ${providerName}, ${slot}.`;
}

/** A slot in the slot picker. */
export function slotMessage(providerName: string, slot: string): string {
  return `${slot} with ${providerName}, please.`;
}

/** A day in the slots-per-day chart. */
export function dayMessage(day: string): string {
  return `Let's do ${day}.`;
}

/** An option in a pick-one list, or the person's own answer typed into its box. */
export function pickMessage(label: string): string {
  return label;
}

/** A booking in the booking picker. */
export function bookingMessage(providerName: string, slot: string): string {
  return `The ${providerName} booking on ${slot}.`;
}

const FIELD_WORDS: Readonly<Record<AskField, string>> = {
  service: "Service",
  area: "Area",
  timeWindow: "When",
};

export interface AskFormAnswer {
  readonly values: Partial<Record<AskField, string>>;
  /** The optional budget slider, in ₹; absent when they left it alone. */
  readonly budgetInr?: number;
}

/** The missing-details form, submitted: one line per field it asked, then the budget if set. */
export function askFormMessage(answer: AskFormAnswer): string {
  const lines = (Object.keys(FIELD_WORDS) as AskField[]).flatMap((field) => {
    const value = answer.values[field]?.trim();
    return value === undefined || value === "" ? [] : [`${FIELD_WORDS[field]}: ${value}`];
  });
  if (answer.budgetInr !== undefined) lines.push(`Budget: up to ₹${answer.budgetInr.toLocaleString("en-IN")}`);
  return lines.join("\n");
}
