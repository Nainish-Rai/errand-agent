import type { CARD_FOLLOW_UPS, DraftErrandRequest, ModelStep, SeedFactSchema, SwitchScenarioRequest } from "@errand/contracts";
import type { z } from "zod";

// What the demo recorder says to the real backend and what the scripted model answers, chat by chat.
// The world, the pinned clock and the model's tool calls are the evals' (happy path booking, the
// timeout-after-success world, the new-errand hand-off, the ask form, the charts); the wording is
// taken from their recorded live runs. Everything else (options, prices, slots, review insight, the
// approval card, the ledger, the receipt) is what the real core and world return for them.

/** The evals' pinned clock: Wednesday 4 November 2026, 09:00 IST. */
export const DEMO_CLOCK_START = "2026-11-04T09:00:00+05:30";

/** The provider books the slot, then its reply times out: the chat checks before it says booked. */
export const DEMO_WORLD: SwitchScenarioRequest = { scenario: "timeout_after_success", seed: 42 };

const THIS_WEEK = { from: "2026-11-04", to: "2026-11-10" };
const CHEAPEST_PLUMBER = {
  providerId: "prv_plumber_koramangala_5",
  name: "Shiva Sanitary Solutions",
  slot: { start: "2026-11-05T08:00:00+05:30", end: "2026-11-05T09:00:00+05:30" },
};
const KORAMANGALA_PLUMBERS = ["prv_plumber_koramangala_1", "prv_plumber_koramangala_4", CHEAPEST_PLUMBER.providerId, "prv_plumber_koramangala_8"];

/** The home composer's chips as memory prefills them: Koramangala, under ₹1,500, this week. */
const CHIPS: DraftErrandRequest = { area: "Koramangala", budgetInr: 1_500, when: { earliestHour: null, latestHour: null } };

export type DemoSay =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "choose"; readonly providerName: string; readonly slot?: string }
  | { readonly kind: "ask-form"; readonly values: Readonly<Record<string, string>> }
  | { readonly kind: "card"; readonly follow: keyof typeof CARD_FOLLOW_UPS };

export interface DemoBeat {
  readonly key: string;
  readonly say: DemoSay;
  /** A tap on the approval card before the message: what the card does, through the approve or decline route. */
  readonly before?: { readonly kind: "approve" | "decline" };
  /** The turn executes the approved proposal: record the ledger and the proposal after it. */
  readonly executes?: boolean;
  readonly steps: readonly ModelStep[];
}

export interface DemoSessionScript {
  readonly key: string;
  readonly draft?: DraftErrandRequest;
  /** Started from this chat's New errand card. */
  readonly startedFrom?: { readonly session: string };
  readonly beats: readonly DemoBeat[];
}

function search(service: string, area: string): ModelStep {
  return { toolCalls: [{ name: "search_providers", input: { service, area, date_range: THIS_WEEK } }] };
}

function presentUi(program: readonly string[]): ModelStep {
  return { toolCalls: [{ name: "present_ui", input: { ui: program.join("\n") } }] };
}

const ids = (list: readonly string[]) => list.map((id) => `"${id}"`).join(", ");

const PLUMBER_SEARCH: readonly ModelStep[] = [
  search("plumber", "Koramangala"),
  { toolCalls: [{ name: "get_provider_insight", input: { provider_ids: ["prv_plumber_koramangala_4", CHEAPEST_PLUMBER.providerId] } }] },
  {
    text:
      "Here are two good fits for the leaking tap:\n\n" +
      "- **Venkatesh Sanitary Solutions**: best match and the earliest slot. Reviews call them punctual and fair on price, and they bring their own parts.\n" +
      "- **Shiva Sanitary Solutions**: the cheapest. A few reviews mention unfinished work, so it's worth confirming the job with them.\n\n" +
      "One review tried to give the assistant instructions. I ignored it.\n\n" +
      "Tap a card's Choose button when you've picked one.",
  },
];

const HOLD_AND_PROPOSE: readonly ModelStep[] = [
  { toolCalls: [{ name: "hold_slot", input: { provider_id: CHEAPEST_PLUMBER.providerId, slot: CHEAPEST_PLUMBER.slot } }] },
  { toolCalls: [{ name: "propose_action", input: { action: "book" } }] },
  { text: "Held the slot. Check the card and tap Approve ₹399 if it's right. Nothing is booked until you do." },
];

function tileSearch(key: string, request: string, service: string, reply: string): DemoSessionScript {
  return { key, draft: CHIPS, beats: [{ key: "search", say: { kind: "text", text: request }, steps: [search(service, "Koramangala"), { text: reply }] }] };
}

export const DEMO_SCRIPT = {
  /** Memory as the README shows it: area and budget said by the person, the earliest start a guess. */
  memory: [
    { key: "area", value: "Koramangala", source: "explicit", status: "active", ageDays: 12 },
    { key: "budget", value: "1500", source: "explicit", status: "active", ageDays: 12 },
    { key: "earliest_hour", value: "9", source: "inferred", status: "pending_confirmation", ageDays: 3 },
  ] satisfies z.input<typeof SeedFactSchema>[],
  /** Ravi Aircon Experts cancels the seeded AC visit (Mon 9 Nov, 11:00): the provider-cancellation eval's turns. */
  providerCancellation: {
    event: { bookingId: "bkg_seed_3", eventId: "evt_demo_ravi_cancels_bkg_seed_3" },
    turns: [
      [
        { toolCalls: [{ name: "search_providers", input: { service: "ac_servicing", area: "Koramangala", date_range: { from: "2026-11-09", to: "2026-11-15" } } }] },
        {
          toolCalls: [
            { name: "hold_slot", input: { provider_id: "prv_ac_servicing_koramangala_6", slot: { start: "2026-11-09T11:00:00+05:30", end: "2026-11-09T12:00:00+05:30" } } },
          ],
        },
        { toolCalls: [{ name: "propose_action", input: { action: "book" } }] },
        {
          text:
            "Ravi Aircon Experts cancelled your AC servicing on Monday at 11:00. I found a replacement within your usual budget: " +
            "Prestige AC Care, same time. Check the card and tap Approve if it's right.",
        },
      ],
      [{ toolCalls: [{ name: "execute_proposal", input: {} }] }, { text: "Booked: Prestige AC Care, Mon 9 Nov at 11:00 am IST, ₹999." }],
    ] satisfies ModelStep[][],
  },
  sessions: [
    // Before the plumber chat: its decline releases the hold, and the plumber chat then books the same slot.
    {
      key: "decline",
      draft: CHIPS,
      beats: [
        { key: "search", say: { kind: "text", text: "Plumber for a leaking kitchen tap this week" }, steps: PLUMBER_SEARCH },
        { key: "choose", say: { kind: "choose", providerName: CHEAPEST_PLUMBER.name }, steps: HOLD_AND_PROPOSE },
        {
          key: "declined",
          before: { kind: "decline" },
          say: { kind: "card", follow: "declined" },
          steps: [search("plumber", "Koramangala"), { text: "No problem. Nothing is booked and the hold is released. Here are the options again." }],
        },
      ],
    },
    {
      key: "plumber",
      draft: CHIPS,
      beats: [
        { key: "search", say: { kind: "text", text: "Plumber for a leaking kitchen tap this week" }, steps: PLUMBER_SEARCH },
        {
          key: "charts",
          say: { kind: "text", text: "Compare their prices for me" },
          steps: [
            presentUi([
              "root = Stack([prices, days, spend])",
              `prices = PriceChart([${ids(KORAMANGALA_PLUMBERS)}], "Prices compared")`,
              `days = SlotsPerDayChart([${ids(KORAMANGALA_PLUMBERS)}], "Free slots this week")`,
              'spend = SpendChart(6, "What you spent")',
            ]),
            { text: "Here are their prices and free slots side by side, and what you've spent lately." },
          ],
        },
        { key: "choose", say: { kind: "choose", providerName: CHEAPEST_PLUMBER.name }, steps: HOLD_AND_PROPOSE },
        {
          key: "typed-yes",
          say: { kind: "text", text: "yes" },
          steps: [
            { toolCalls: [{ name: "execute_proposal", input: {} }] },
            { text: "Nothing is booked yet: a typed “yes” doesn't count. Please tap **Approve ₹399** on the approval card." },
          ],
        },
        {
          key: "approve",
          before: { kind: "approve" },
          say: { kind: "card", follow: "approved" },
          executes: true,
          steps: [
            { toolCalls: [{ name: "execute_proposal", input: {} }] },
            { text: "Booked: Shiva Sanitary Solutions, Thu 5 Nov at 8:00 am IST, ₹399. The provider's reply was slow, so I checked with them before saying so." },
          ],
        },
        {
          key: "new-job",
          say: { kind: "text", text: "She needs her AC repaired too, at my mom's place in HSR Layout" },
          steps: [search("ac_servicing", "HSR Layout"), { text: "That's a new errand. Tap Start in a new chat and I'll pick it up there." }],
        },
      ],
    },
    {
      key: "ac-hsr",
      startedFrom: { session: "plumber" },
      beats: [
        {
          key: "search",
          say: { kind: "text", text: "She needs her AC repaired too, at my mom's place in HSR Layout" },
          steps: [search("ac_servicing", "HSR Layout"), { text: "Here are AC servicing options at your mom's place in HSR Layout this week. Pick one and I'll hold the slot." }],
        },
      ],
    },
    {
      key: "ask-form",
      beats: [
        {
          key: "ask",
          say: { kind: "text", text: "I need a plumber in Koramangala" },
          steps: [
            { text: "I'll help you find a plumber in Koramangala.", toolCalls: [{ name: "update_errand", input: { service: "plumber", area: "Koramangala" } }] },
            { toolCalls: [{ name: "ask_ui", input: { ui: 'root = Stack([form])\nform = AskForm(["timeWindow"], "When should the plumber come?")' } }] },
            { text: "When should the plumber visit? Pick one of the options above, or tell me a day and time." },
          ],
        },
        {
          key: "answer",
          say: { kind: "ask-form", values: { timeWindow: "This week" } },
          steps: [
            { toolCalls: [{ name: "update_errand", input: { time_window: THIS_WEEK } }] },
            search("plumber", "Koramangala"),
            { text: "Here are the plumbers who can come this week. Pick one with Choose and I'll hold the slot for your approval." },
          ],
        },
      ],
    },
    tileSearch("ac", "Service my AC this week", "ac_servicing", "Here are AC servicing options in Koramangala this week. Pick one and I'll hold the slot."),
    tileSearch("electrician", "Book an electrician this week", "electrician", "Here are electricians in Koramangala this week. Pick one and I'll hold the slot."),
    tileSearch("cleaner", "Book a deep clean this week", "cleaner", "Here are deep cleaning options in Koramangala this week. Pick one and I'll hold the slot."),
    tileSearch("carpenter", "Book a carpenter this week", "carpenter", "Here are carpenters in Koramangala this week. Pick one and I'll hold the slot."),
  ] satisfies DemoSessionScript[],
};
