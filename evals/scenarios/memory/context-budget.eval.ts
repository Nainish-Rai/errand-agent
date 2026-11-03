import { equals } from "eve/evals/expect";

import { CONTEXT_BUDGET_MEMORY, CONVERSATION, CONVERSATION_SCRIPT, RELEVANT_AT_THE_END } from "../../context-budget-seed";
import { modelContextsOf } from "../../context-checks";
import { defineScenario } from "../../scenario";

// SPEC story 41 and the required scenario "context budget with 50+ memories and a long history":
// 53 remembered facts (most superseded or forgotten, one inferred and unconfirmed) and a
// fifteen-message conversation whose tool results outgrow the history share. Every model call's
// logged context must fit the cap and its split, the oldest exchanges must be dropped whole and
// summarised, and the memory sent must hold only current, relevant preferences.

const INCLUSION_REASONS = ["fills_missing_detail", "standing_preference", "matches_errand"];

export default defineScenario({
  id: "scenarios/memory/context-budget",
  description: "With 53 memories and a long history, every model call fits the context budget and carries only current, relevant preferences.",
  world: { scenario: "default", seed: 42 },
  memory: CONTEXT_BUDGET_MEMORY,
  user: CONVERSATION.map(({ say }) => ({ say })),
  goal:
    "You are comparing home services across Bengaluru this week. Ask, one message at a time, for plumbers in Koramangala, " +
    "electricians in Indiranagar, AC servicing in Whitefield, carpenters in Jayanagar and cleaners in BTM Layout. " +
    "Then say you'll go with an electrician in Jayanagar this week within your usual budget and not before your usual time. " +
    "Once you see options for that you are done; don't book anything.",
  maxSimulatedMessages: 6,
  model: { turns: [...CONVERSATION_SCRIPT] },
  expected:
    "every model call fits the 40k cap and its split; the oldest exchanges are dropped whole and summarised; the memory sent holds only current, relevant facts (budget and earliest start by the end), never a superseded, forgotten or unconfirmed one",
  actual(run) {
    return `${run.turns.length} turns; ${run.toolCalls.filter((call) => call.name === "search_providers").length} searches`;
  },
  async expect(t, run) {
    t.succeeded();
    const memory = await run.api.listMemory();
    t.check(memory.facts.length >= 50, equals(true)).label("50+ facts are remembered");

    const calls = await modelContextsOf(run);
    // Every turn's model calls logged their context.
    await t.require(calls.length >= run.turns.length, equals(true));
    t.check(calls.filter((call) => call.outcome !== "sent").length, equals(0)).label("no context was refused");
    const overCap = calls.filter((call) => call.tokens.total > call.capTokens);
    t.check(overCap.length, equals(0)).label("every call is within the cap");
    const overSplit = calls.filter(
      (call) =>
        call.tokens.instructions + call.tokens.tools > call.split.instructions ||
        call.tokens.memory > call.split.memory ||
        call.tokens.history > call.historyLimitTokens,
    );
    t.check(overSplit.length, equals(0)).label("every part is within its share");

    const trimmed = calls.filter((call) => call.history.dropped.length > 0);
    t.check(trimmed.length > 0, equals(true)).label("the long history was trimmed");
    t.check(
      trimmed.every((call) => call.history.summary !== null && call.history.dropped.every((message) => message.index < (call.history.kept[0]?.index ?? 0))),
      equals(true),
    ).label("only the oldest messages were dropped, and a summary replaced them");
    const lastCall = calls.at(-1);
    t.check(lastCall?.history.kept.some((message) => message.preview.startsWith("OK, I'll go with an electrician")), equals(true)).label(
      "the last call still had the person's last message",
    );

    const included = calls.flatMap((call) => call.memory.included);
    t.check(
      included.filter((fact) => fact.status !== "active" || !INCLUSION_REASONS.includes(fact.reason)).map((fact) => `${fact.key}=${fact.value}`),
      equals([]),
    ).label("every fact sent was current and relevant");
    t.check(lastCall?.memory.included.map((fact) => fact.key).sort(), equals([...RELEVANT_AT_THE_END].sort())).label(
      "by the last turn only the budget and the earliest start are sent",
    );
    const reasons = new Set(lastCall?.memory.excluded.map((fact) => fact.reason));
    t.check(
      ["superseded", "forgotten", "unconfirmed", "overridden_by_errand"].filter((reason) => !reasons.has(reason)),
      equals([]),
    ).label("the rest were excluded as superseded, forgotten, unconfirmed or overridden by the errand");
    t.check((lastCall?.memory.included.length ?? 0) + (lastCall?.memory.excluded.length ?? 0), equals(memory.facts.length)).label(
      "every remembered fact is accounted for",
    );
  },
});
