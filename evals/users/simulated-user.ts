import type { ChatTurn } from "@errand/client";
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";

import { ModelScriptPlayer } from "../../src/adapters/models/scripted";
import { createModel, parseModelSelection } from "../../src/adapters/models/select-model";
import { PriceTable } from "../../src/adapters/tracing/price-table";
import type { ApproveClick, User, UserStep } from "./user";

// The live-mode user: a model (the user_simulator role, Claude Code CLI by default) plays a person
// with the scenario's goal. It only chats. The scenario's approval clicks still happen, after the
// conversation, until ticket 05 gives the simulator pending proposals to see and click itself.

export const DEFAULT_SIMULATED_MESSAGES = 3;

const SimulatorReplySchema = z.object({
  done: z.boolean().describe("true when the goal is met or the assistant can't help further; then message is empty"),
  message: z.string().describe("Your next chat message as the user, one or two short sentences"),
});

function instructionsFor(goal: string): string {
  return [
    "You are role-playing a user of a home-services errand assistant in Bengaluru, India.",
    `Your goal: ${goal}`,
    "Write only what this user would type in the chat: short, plain and in the first person.",
    "Never play the assistant, never invent the assistant's replies, never mention you are simulated.",
    "Answer the assistant's questions from your goal. Set done to true once the goal is met or the assistant can't help.",
  ].join("\n");
}

function transcriptOf(turns: readonly ChatTurn[], said: readonly string[]): string {
  if (turns.length === 0) return "The chat is empty. Write your opening message.";
  const lines = turns.flatMap((turn, index) => [`User: ${said[index] ?? ""}`, `Assistant: ${turn.reply}`]);
  return `The chat so far:\n${lines.join("\n")}\n\nWrite your next message, or set done to true.`;
}

export interface SimulatedUserOptions {
  readonly goal: string;
  /** Approval clicks the scenario makes once the conversation ends. */
  readonly clicks: readonly ApproveClick[];
  /** Cap on the messages the simulator sends, so a chatty simulator can't run up a bill. */
  readonly maxMessages?: number;
}

export class SimulatedUser implements User {
  readonly #options: SimulatedUserOptions;
  readonly #model: LanguageModel;
  readonly #pricing = new PriceTable();
  readonly #said: string[] = [];
  readonly #clicks: ApproveClick[];
  #conversing = true;
  #costUsd = 0;

  constructor(options: SimulatedUserOptions) {
    this.#options = options;
    this.#clicks = [...options.clicks];
    const role = parseModelSelection(process.env.ERRAND_MODELS).user_simulator;
    this.#model = createModel(role, { minimaxApiKey: process.env.MINIMAX_API_KEY, scriptPlayer: new ModelScriptPlayer() });
  }

  get costUsd(): number {
    return this.#costUsd;
  }

  async nextStep(turns: readonly ChatTurn[]): Promise<UserStep | undefined> {
    if (this.#conversing) {
      const message = this.#said.length < (this.#options.maxMessages ?? DEFAULT_SIMULATED_MESSAGES)
        ? await this.#nextMessage(turns)
        : undefined;
      if (message !== undefined) {
        this.#said.push(message);
        return { say: message };
      }
      this.#conversing = false;
    }
    const click = this.#clicks.shift();
    return click === undefined ? undefined : { approve: click };
  }

  async #nextMessage(turns: readonly ChatTurn[]): Promise<string | undefined> {
    const result = await generateText({
      model: this.#model,
      system: instructionsFor(this.#options.goal),
      prompt: transcriptOf(turns, this.#said),
      output: Output.object({ schema: SimulatorReplySchema }),
    });
    const cost = this.#pricing.costOf({
      modelId: result.response.modelId,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.inputTokenDetails?.cacheReadTokens,
        cacheWriteTokens: result.usage.inputTokenDetails?.cacheWriteTokens,
      },
      providerMetadata: result.providerMetadata,
    });
    this.#costUsd += cost?.usd ?? 0;
    const reply = SimulatorReplySchema.parse(result.output);
    const message = reply.message.trim();
    return reply.done || message === "" ? undefined : message;
  }
}
