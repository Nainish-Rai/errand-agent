// What generated UI may contain: the rule table behind "generated UI may ask and show; only fixed
// UI may commit". The component schemas live in packages/contracts (ui/generated-ui.ts); a unit
// test keeps this table and that list naming the same components.
//
// There is no approve, confirm or pay component. A component's buttons do what its code says
// (Choose sends the choice as the person's message), never what the model wrote.

export type ComponentRole =
  /** The program's root, a list of items. */
  | "root"
  /** Shows something: cards, charts, details, next-step chips. */
  | "show"
  /** Asks the person something; their answer comes back as an ordinary message. */
  | "ask"
  /** Only inside another component (a card inside a row of cards). */
  | "part";

export interface ComponentRule {
  readonly role: ComponentRole;
  /** Set while the data it binds to isn't served yet: the model isn't offered it and it is refused. */
  readonly pendingOn?: string;
  /** Props holding provider ids, which must name providers the world has. */
  readonly providerIdProps: readonly string[];
  /** Props holding booking ids, which must name bookings of this person. */
  readonly bookingIdProps: readonly string[];
  /** Props whose text the person taps to send: never an approval or commit phrase. */
  readonly tappableTextProps: readonly string[];
}

function rule(role: ComponentRole, details: Partial<Omit<ComponentRule, "role">> = {}): ComponentRule {
  return { role, providerIdProps: [], bookingIdProps: [], tappableTextProps: [], ...details };
}

export const COMPONENT_RULES: Readonly<Record<string, ComponentRule>> = {
  Stack: rule("root"),
  ProviderChoices: rule("show"),
  ProviderChoice: rule("part", { providerIdProps: ["providerId"] }),
  PriceChart: rule("show", { providerIdProps: ["providerIds"] }),
  SlotsPerDayChart: rule("show", { providerIdProps: ["providerIds"] }),
  SpendChart: rule("show"),
  ProviderDetails: rule("show", { providerIdProps: ["providerId"] }),
  ReviewInsight: rule("show", { providerIdProps: ["providerId"], pendingOn: "09 (review reader)" }),
  SlotPicker: rule("ask", { providerIdProps: ["providerId"] }),
  PickOne: rule("ask"),
  PickOption: rule("part", { tappableTextProps: ["label"] }),
  BookingPicker: rule("ask", { bookingIdProps: ["bookingIds"] }),
  PreferenceCard: rule("ask", { pendingOn: "11 (memory)" }),
  AskForm: rule("ask"),
  FollowUps: rule("show", { tappableTextProps: ["suggestions"] }),
};

/** The components the model is offered: every one whose data is served. */
export function offeredComponents(): string[] {
  return Object.entries(COMPONENT_RULES)
    .filter(([, details]) => details.pendingOn === undefined)
    .map(([name]) => name);
}

/** The components still waiting on another ticket's data, with that ticket. */
export function pendingComponents(): { readonly component: string; readonly pendingOn: string }[] {
  return Object.entries(COMPONENT_RULES).flatMap(([component, details]) =>
    details.pendingOn === undefined ? [] : [{ component, pendingOn: details.pendingOn }],
  );
}

// Words that would make a tappable chip look like the approval card's button. Approval happens
// only on the fixed card, so generated UI may not offer it even as text to send.
const COMMIT_PHRASE = /\b(approve[sd]?|approval|confirm(s|ed)?|authori[sz]e[sd]?|pay|payment|checkout|book (it|now|this)|go ahead)\b/i;

export function isCommitPhrase(text: string): boolean {
  return COMMIT_PHRASE.test(text);
}
