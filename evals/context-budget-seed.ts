import type { ModelScriptTurn, SeedFact } from "@errand/contracts";

import { THIS_WEEK } from "./errand-checks";

// The "context budget" world: 53 remembered facts and a long prior conversation. The browser suite
// verification/suites/context-budget.json seeds the same facts (a test keeps the two equal).
//
// A key holds at most one current fact, so most of the 53 are history: corrections that
// superseded each other, a technician forgotten many times over (the tombstone stands), and a
// standing preference the agent guessed and nobody confirmed. Three are current: the usual area,
// budget and earliest start. By the last turn the person has named an area for this errand, so the
// remembered area is irrelevant to it (overridden by the errand) and only the budget and the
// earliest start are worth sending.

function history(key: SeedFact["key"], values: readonly string[], status: "superseded" | "forgotten", source: SeedFact["source"] = "explicit"): SeedFact[] {
  // Oldest first: each one a day younger than the one before it.
  return values.map((value, position) => ({ key, value, source, status, ageDays: 400 - position * 7 }));
}

export const CONTEXT_BUDGET_MEMORY: readonly SeedFact[] = [
  ...history("area", [
    "Koramangala",
    "Indiranagar",
    "Whitefield",
    "Jayanagar",
    "BTM Layout",
    "Malleshwaram",
    "Electronic City",
    "Koramangala",
    "Indiranagar",
    "Whitefield",
    "Jayanagar",
    "BTM Layout",
    "Malleshwaram",
    "Electronic City",
  ], "superseded"),
  { key: "area", value: "HSR Layout", source: "explicit", status: "active", ageDays: 10 },
  ...history("budget", ["500", "600", "700", "800", "900", "1000", "1100", "1200", "1300", "1400"], "superseded"),
  { key: "budget", value: "1500", source: "explicit", status: "active", ageDays: 9 },
  ...history("earliest_hour", ["7", "8", "11", "12", "13", "14", "15", "16"], "superseded"),
  { key: "earliest_hour", value: "9", source: "explicit", status: "active", ageDays: 8 },
  ...history("favourite_technician", ["Ravi", "Suresh", "Anil", "Manjunath", "Prakash", "Vinod", "Kiran", "Naveen", "Raju"], "forgotten"),
  ...history("preferences", ["no pets", "cash only", "parts included", "female technician", "no weekends", "call first", "bring a ladder", "Kannada speaking"], "superseded"),
  { key: "preferences", value: "weekend visits only", source: "inferred", status: "pending_confirmation", ageDays: 2 },
];

/** The memory a call may carry by the last turn: the current, relevant preferences. */
export const RELEVANT_AT_THE_END = ["budget", "earliest_hour"] as const;

const PRIOR_SEARCHES: readonly { readonly say: string; readonly service: string; readonly area: string }[] = [
  { say: "Find a plumber in Koramangala this week", service: "plumber", area: "Koramangala" },
  { say: "What about an electrician in Indiranagar this week?", service: "electrician", area: "Indiranagar" },
  { say: "Show me AC servicing in Whitefield this week", service: "ac_servicing", area: "Whitefield" },
  { say: "Any carpenters in Jayanagar this week?", service: "carpenter", area: "Jayanagar" },
  { say: "I also need a cleaner in BTM Layout this week", service: "cleaner", area: "BTM Layout" },
  { say: "Back to plumbers: what is there in Malleshwaram this week?", service: "plumber", area: "Malleshwaram" },
  { say: "And electricians in Electronic City this week?", service: "electrician", area: "Electronic City" },
  { say: "Check AC servicing in Koramangala this week too", service: "ac_servicing", area: "Koramangala" },
  { say: "Carpenters in Indiranagar this week?", service: "carpenter", area: "Indiranagar" },
  { say: "Cleaners in Whitefield this week please", service: "cleaner", area: "Whitefield" },
  { say: "How about plumbers in Electronic City this week?", service: "plumber", area: "Electronic City" },
  { say: "Electricians in BTM Layout this week?", service: "electrician", area: "BTM Layout" },
  { say: "AC servicing in Malleshwaram this week, what do you have?", service: "ac_servicing", area: "Malleshwaram" },
  { say: "Last one: carpenters in Koramangala this week", service: "carpenter", area: "Koramangala" },
];

/** The question the long conversation ends on. */
export const LAST_REQUEST = {
  say: "OK, I'll go with an electrician in Jayanagar this week, within my usual budget and not before my usual time.",
  service: "electrician",
  area: "Jayanagar",
} as const;

export const CONVERSATION = [...PRIOR_SEARCHES, LAST_REQUEST];

/** Each message: search what the person asked for, then answer in a few lines. */
export const CONVERSATION_SCRIPT: readonly ModelScriptTurn[] = CONVERSATION.map(({ service, area }) => ({
  steps: [
    { toolCalls: [{ name: "search_providers", input: { service, area, date_range: THIS_WEEK } }] },
    { text: `Here are the best ${service.replace("_", " ")} options in ${area} this week, with prices and the earliest free slots.` },
  ],
}));
