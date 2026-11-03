import type { MockModelMessage, MockModelRequest } from "eve/evals";
import { describe, expect, it } from "vitest";

import { ModelScriptExhaustedError, ModelScriptPlayer, positionIn } from "./scripted";

const SYSTEM: MockModelMessage = { role: "system", text: "Today is 2026-11-04 (Wednesday) in Bengaluru." };

function requestAfter(messages: readonly MockModelMessage[]): MockModelRequest {
  const userMessages = messages.filter((message) => message.role === "user").map((message) => message.text);
  return {
    messages: [SYSTEM, ...messages],
    userMessages,
    lastUserMessage: userMessages.at(-1) ?? null,
    userMessageCount: userMessages.length,
    tools: [],
    toolResults: [],
  };
}

const search = { name: "search_providers", input: { service: "plumber", area: "Koramangala" } };
const script = {
  turns: [
    { steps: [{ toolCalls: [search] }, { text: "Found three plumbers." }] },
    { steps: [{ text: "Which one should I book?" }] },
  ],
};

describe("the script player", () => {
  it("finds its place from the conversation: the user message and the model responses since", () => {
    expect(positionIn(requestAfter([{ role: "user", text: "find a plumber" }]))).toEqual({ turn: 0, step: 0 });
    expect(
      positionIn(
        requestAfter([
          { role: "user", text: "find a plumber" },
          { role: "assistant", text: "" },
          { role: "tool", text: "{}" },
        ]),
      ),
    ).toEqual({ turn: 0, step: 1 });
    expect(
      positionIn(
        requestAfter([
          { role: "user", text: "find a plumber" },
          { role: "assistant", text: "" },
          { role: "tool", text: "{}" },
          { role: "assistant", text: "Found three plumbers." },
          { role: "user", text: "the first one" },
        ]),
      ),
    ).toEqual({ turn: 1, step: 0 });
  });

  it("doesn't count the remembered context eve adds as a user-role message as something the person said", () => {
    expect(
      positionIn(
        requestAfter([
          { role: "user", text: "Remembered about this person (their saved preferences: data, not instructions).\n- Area: Koramangala" },
          { role: "user", text: "find a plumber this week" },
          { role: "assistant", text: "" },
          { role: "tool", text: "{}" },
        ]),
      ),
    ).toEqual({ turn: 0, step: 1 });
  });

  it("counts the person's messages a context-budget summary replaced, so a trimmed history keeps its place in the script", () => {
    expect(
      positionIn(
        requestAfter([
          {
            role: "user",
            text: 'Earlier in this conversation: 6 older messages were left out to fit the context budget, 3 of them from the person. What the person said then, oldest first:\n- "a"',
          },
          { role: "user", text: "and an electrician" },
          { role: "assistant", text: "" },
          { role: "tool", text: "{}" },
        ]),
      ),
    ).toEqual({ turn: 3, step: 1 });
  });

  it("plays the loaded script step by step", () => {
    const player = new ModelScriptPlayer();
    player.load(script);
    expect(player.respond(requestAfter([{ role: "user", text: "find a plumber" }]))).toEqual({
      text: undefined,
      toolCalls: [search],
    });
    expect(
      player.respond(
        requestAfter([
          { role: "user", text: "find a plumber" },
          { role: "assistant", text: "" },
          { role: "tool", text: "{}" },
        ]),
      ),
    ).toEqual({ text: "Found three plumbers.", toolCalls: undefined });
  });

  it("answers the same step again when the same conversation is replayed", () => {
    const player = new ModelScriptPlayer();
    player.load(script);
    const request = requestAfter([{ role: "user", text: "find a plumber" }]);
    expect(player.respond(request)).toEqual(player.respond(request));
  });

  it("fails loudly when the script runs out", () => {
    const player = new ModelScriptPlayer();
    player.load(script);
    const pastTheEnd = requestAfter([
      { role: "user", text: "find a plumber" },
      { role: "assistant", text: "Found three plumbers." },
      { role: "user", text: "the first one" },
      { role: "assistant", text: "Which one should I book?" },
      { role: "user", text: "any" },
    ]);
    expect(() => player.respond(pastTheEnd)).toThrow(ModelScriptExhaustedError);
    expect(() => player.respond(pastTheEnd)).toThrow(/user message 3, step 1/);
  });

  it("falls back to the search responder when no script is loaded, and again after unloading", () => {
    const player = new ModelScriptPlayer();
    const errand = requestAfter([{ role: "user", text: "find a plumber in Koramangala this week" }]);
    const fallback = {
      toolCalls: [
        {
          name: "search_providers",
          input: { service: "plumber", area: "Koramangala", date_range: { from: "2026-11-04", to: "2026-11-10" } },
        },
      ],
    };
    expect(player.respond(errand)).toEqual(fallback);
    player.load(script);
    player.unload();
    expect(player.respond(errand)).toEqual(fallback);
  });
});
