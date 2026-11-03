import type { EveMessage } from "@errand/client";
import {
  ActionIntentViewSchema,
  ApproveProposalResponseSchema,
  BookingViewSchema,
  DeclineProposalResponseSchema,
  ErrandSearchOutputSchema,
  ErrandViewSchema,
  ExecuteProposalOutputSchema,
  GetAvailabilityResponseSchema,
  GetErrandHandoffsResponseSchema,
  GetHomeSummaryResponseSchema,
  GetProviderInsightOutputSchema,
  GetSessionContextResponseSchema,
  GetSessionTraceResponseSchema,
  GetSessionTranscriptResponseSchema,
  GetSpendResponseSchema,
  HoldSlotOutputSchema,
  ListMemoryResponseSchema,
  ListServiceOptionsResponseSchema,
  OperatorSessionSchema,
  ProposalViewSchema,
  ProposeActionOutputSchema,
  ProviderDetailsSchema,
  SearchProvidersInputSchema,
  StartNewErrandResponseSchema,
  UpdateErrandOutputSchema,
} from "@errand/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { demoState, resetDemo } from "./demo-world";
import { MockApiClient } from "./mock-api-client";
import { loadOpsRecording, recording } from "./recording";
import { createChat, sendToChat } from "./scripted-chat";

// The demo replays a recording of the real backend through the real renderers. If the wire changes and
// the recording doesn't, the hosted demo would draw broken cards with nothing failing, so the fixture is
// held to the same contracts the client parses the backend with. And the demo keeps the agent's one
// safety rule: only the card's Approve books, never typed words.

/** The tools whose results the chat draws, and the contract each result must meet. */
const TOOL_OUTPUTS: Readonly<Record<string, z.ZodType>> = {
  search_providers: ErrandSearchOutputSchema,
  get_provider_insight: GetProviderInsightOutputSchema,
  hold_slot: HoldSlotOutputSchema,
  propose_action: ProposeActionOutputSchema,
  execute_proposal: ExecuteProposalOutputSchema,
  update_errand: UpdateErrandOutputSchema,
};

function expectParses(schema: z.ZodType, value: unknown, where: string): void {
  const parsed = schema.safeParse(value);
  expect(parsed.success, `${where}: ${parsed.error?.message ?? ""}`).toBe(true);
}

function toolParts(messages: readonly EveMessage[]) {
  return messages.flatMap((message) => message.parts.flatMap((part) => (part.type === "tool" ? [part] : [])));
}

describe("the demo recording", () => {
  it("meets the API contracts", () => {
    expectParses(GetHomeSummaryResponseSchema, recording.home.initial, "home.initial");
    expectParses(GetHomeSummaryResponseSchema, recording.home.afterBooking, "home.afterBooking");
    expectParses(ListMemoryResponseSchema, recording.memory, "memory");
    expectParses(ListServiceOptionsResponseSchema, recording.services, "services");
    expectParses(GetSpendResponseSchema, recording.spend, "spend");
    expectParses(GetAvailabilityResponseSchema, recording.availability, "availability");
    for (const booking of [...recording.bookings.initial, ...recording.bookings.afterBooking]) expectParses(BookingViewSchema, booking, "booking");
    expect(recording.providers.length).toBeGreaterThan(0);
    for (const provider of recording.providers) expectParses(ProviderDetailsSchema, provider, `provider ${provider.id}`);
    for (const [key, value] of Object.entries(recording.proposals)) {
      const phase = key.split(":")[1];
      const schema = phase === "approve" ? ApproveProposalResponseSchema : phase === "decline" ? DeclineProposalResponseSchema : ProposalViewSchema;
      expectParses(schema, value, `proposals ${key}`);
    }
    for (const [key, value] of Object.entries(recording.intents)) {
      const steps = key.endsWith(":during") ? (value as readonly (readonly unknown[])[]) : [value as readonly unknown[]];
      expect(steps.length, `intents ${key}`).toBeGreaterThan(0);
      for (const intents of steps) for (const intent of intents) expectParses(ActionIntentViewSchema, intent, `intents ${key}`);
    }
    for (const [key, handoff] of Object.entries(recording.handoffs)) {
      expectParses(StartNewErrandResponseSchema, handoff.moved, `handoffs ${key}`);
      expectParses(SearchProvidersInputSchema, handoff.search, `handoffs ${key} search`);
    }
  });

  it("has every chat turn the demo plays, with tool results the renderers can draw", () => {
    const expected = {
      plumber: ["search", "charts", "choose", "typed-yes", "approve", "new-job"],
      best: ["search", "choose", "approve"],
      decline: ["search", "choose", "declined"],
      "ask-form": ["ask", "answer"],
      "ac-hsr": ["search"],
    } as const;
    for (const [flow, keys] of Object.entries(expected)) {
      expect(recording.sessions[flow as keyof typeof expected].beats.map((beat) => beat.key), flow).toEqual(expect.arrayContaining([...keys]));
    }
    for (const [flow, session] of Object.entries(recording.sessions)) {
      expectParses(GetErrandHandoffsResponseSchema, session.handoffs, `${flow} handoffs`);
      for (const beat of session.beats) {
        const where = `${flow}/${beat.key}`;
        expect(beat.messages.length, where).toBeGreaterThan(0);
        if (beat.errand !== null) expectParses(ErrandViewSchema, beat.errand, `${where} errand`);
        for (const part of toolParts(beat.messages)) {
          expect(part.state, `${where} ${part.name}`).toBe("completed");
          const schema = TOOL_OUTPUTS[part.name];
          if (schema !== undefined) expectParses(schema, part.output, `${where} ${part.name}`);
        }
      }
    }
  });

  it("shows the review that tried to instruct the assistant", () => {
    const search = recording.sessions.plumber.beats.find((beat) => beat.key === "search");
    const insights = toolParts(search?.messages ?? []).filter((part) => part.name === "get_provider_insight");
    expect(JSON.stringify(insights.map((part) => part.output))).toMatch(/"reviewsWithInstructions":[1-9]/);
  });

  it("meets the operator console's contracts", async () => {
    const ops = await loadOpsRecording();
    for (const session of ops.sessions) expectParses(OperatorSessionSchema, session, `ops session ${session.sessionId}`);
    for (const [name, session] of [["demo chat", ops.demoChat], ["committed trace", ops.committed]] as const) {
      expectParses(GetSessionTraceResponseSchema, session.trace, `${name} trace`);
      expectParses(GetSessionContextResponseSchema, session.context, `${name} context`);
      expectParses(GetSessionTranscriptResponseSchema, session.transcript, `${name} transcript`);
    }
  });
});

describe("the demo's booking rule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDemo();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function say(sessionId: string, text: string): Promise<void> {
    await sendToChat(sessionId, text);
    await vi.runAllTimersAsync();
    expect(demoState().chats[sessionId]?.running).toBe(false);
  }

  it("books only after Approve on the card, never on a typed yes", async () => {
    const api = new MockApiClient();
    const before = (await api.listBookings()).length;
    const chat = createChat();
    await say(chat, "Plumber for a leaking kitchen tap this week");
    await say(chat, "I'll take Shiva Sanitary Solutions.");
    const [held] = await api.listSessionProposals(chat);
    expect(held?.status).toBe("pending");

    await say(chat, "yes");
    expect((await api.getProposal(held!.proposalId)).status).toBe("pending");
    expect(await api.listBookings()).toHaveLength(before);

    await api.approveProposal(held!.proposalId, { fingerprint: held!.fingerprint });
    await say(chat, "I approved it on the card.");
    const bookings = await api.listBookings();
    expect(bookings).toHaveLength(before + 1);
    expect(bookings.at(-1)?.providerName).toBe("Shiva Sanitary Solutions");
  });

  it("books nothing when the card is declined", async () => {
    const api = new MockApiClient();
    const before = (await api.listBookings()).length;
    const chat = createChat();
    await say(chat, "Plumber for a leaking kitchen tap this week");
    await say(chat, "I'll take Venkatesh Sanitary Solutions.");
    const [held] = await api.listSessionProposals(chat);
    await api.declineProposal(held!.proposalId);
    await say(chat, "I declined it.");
    await expect(api.approveProposal(held!.proposalId, { fingerprint: held!.fingerprint })).rejects.toMatchObject({ status: 409 });
    expect(await api.listBookings()).toHaveLength(before);
  });
});
