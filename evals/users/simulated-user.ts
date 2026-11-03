import type { ChatTurn } from "@errand/client";
import type { ProposalTermsView } from "@errand/contracts";
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";

import { ModelScriptPlayer } from "../../src/adapters/models/scripted";
import { createModel, parseModelSelection } from "../../src/adapters/models/select-model";
import { PriceTable } from "../../src/adapters/tracing/price-table";
import { cardsIn, latestCard } from "../approval-checks";
import type { ApproveClick, CardTap, User, UserStep } from "./user";

// The live-mode user: a model (the user_simulator role, Claude Code CLI by default) plays a person
// with the scenario's goal. It chats, and when the chat shows an approval card it sees the card's
// details and buttons and may tap one, exactly as the web app's card would. A scenario's
// hand-made approve requests still happen after the conversation.

export const DEFAULT_SIMULATED_MESSAGES = 3;

const SimulatorReplySchema = z.object({
  done: z.boolean().describe("true when the goal is met or the assistant can't help further; then message is empty"),
  tap: z
    .enum(["none", "approve", "decline", "other_options"])
    .describe("A button to tap on the approval card on screen instead of typing; none to type a message"),
  message: z.string().describe("Your next chat message as the user, one or two short sentences; empty when you tap"),
});

function instructionsFor(goal: string): string {
  return [
    "You are role-playing a user of a home-services errand assistant in Bengaluru, India.",
    `Your goal: ${goal}`,
    "Write only what this user would type in the chat: short, plain and in the first person.",
    // Seen live: without this the simulator sometimes narrates ("First message sent. Waiting…").
    "`message` is the literal text you send. Never describe or narrate what you are doing or waiting for.",
    "Never play the assistant, never invent the assistant's replies, never mention you are simulated.",
    "Answer the assistant's questions from your goal. Set done to true once the goal is met or the assistant can't help.",
    "When an approval card is on screen you may tap one of its buttons by setting tap; typing in the chat is not a tap.",
  ].join("\n");
}

/** The card as the person sees it, with the buttons the web app's card shows for its action. */
function cardDescription(terms: ProposalTermsView): string {
  switch (terms.action) {
    case "book":
      return (
        `[Approval card on screen: ${terms.providerName}, ${terms.slot.start}, ₹${terms.priceInr}, ${terms.area}. ` +
        `Buttons: "Approve ₹${terms.priceInr}", "Other options", "Decline"]`
      );
    case "cancel": {
      const approve = terms.priceInr === 0 ? "Approve free cancellation" : `Approve ₹${terms.priceInr}`;
      return (
        `[Cancellation card on screen: ${terms.providerName}, booking ${terms.bookingId}, ${terms.slot.start}, ` +
        `cancellation fee ₹${terms.priceInr}. Buttons: "${approve}" (approve), "Keep booking" (decline)]`
      );
    }
    case "reschedule":
      return (
        `[Reschedule card on screen: ${terms.providerName}, booking ${terms.bookingId}, from ${terms.fromSlot.start} ` +
        `to ${terms.slot.start}, ₹${terms.priceInr}. Buttons: "Approve ₹${terms.priceInr}" (approve), "Other times" (other_options), ` +
        `"Keep current time" (decline)]`
      );
  }
}

function cardLine(turn: ChatTurn): string[] {
  return cardsIn(turn).map(({ terms }) => cardDescription(terms));
}

function transcriptOf(turns: readonly ChatTurn[], said: readonly string[]): string {
  if (turns.length === 0) return "The chat is empty. Write your opening message.";
  const lines = turns.flatMap((turn, index) => [`User: ${said[index] ?? ""}`, `Assistant: ${turn.reply}`, ...cardLine(turn)]);
  return `The chat so far:\n${lines.join("\n")}\n\nWrite your next message or tap a card button, or set done to true.`;
}

export interface SimulatedUserOptions {
  readonly goal: string;
  /** World events the scenario fires before the person says anything (the agent speaks first). */
  readonly opening?: readonly UserStep[];
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
  readonly #opening: UserStep[];
  #conversing = true;
  #costUsd = 0;

  constructor(options: SimulatedUserOptions) {
    this.#options = options;
    this.#clicks = [...options.clicks];
    this.#opening = [...(options.opening ?? [])];
    const role = parseModelSelection(process.env.ERRAND_MODELS).user_simulator;
    this.#model = createModel(role, { minimaxApiKey: process.env.MINIMAX_API_KEY, scriptPlayer: new ModelScriptPlayer() });
  }

  get costUsd(): number {
    return this.#costUsd;
  }

  async nextStep(turns: readonly ChatTurn[]): Promise<UserStep | undefined> {
    const opening = this.#opening.shift();
    if (opening !== undefined) {
      // The world acts, not the person; the agent's turn on it gets no message from them.
      this.#said.push("(you wrote nothing: the assistant messaged you first)");
      return opening;
    }
    if (this.#conversing) {
      const next = this.#said.length < (this.#options.maxMessages ?? DEFAULT_SIMULATED_MESSAGES)
        ? await this.#nextMove(turns)
        : undefined;
      if (next !== undefined && "card" in next) {
        // A tap sends the card's follow-up as the user's message, so it takes a message's place.
        this.#said.push(`(tapped ${next.card.replace("_", " ")} on the card)`);
        return next;
      }
      if (next !== undefined) {
        this.#said.push(next.say);
        return next;
      }
      this.#conversing = false;
    }
    const click = this.#clicks.shift();
    return click === undefined ? undefined : { approve: click };
  }

  async #nextMove(turns: readonly ChatTurn[]): Promise<{ readonly say: string } | { readonly card: CardTap } | undefined> {
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
    if (reply.done) return undefined;
    if (reply.tap !== "none" && latestCard(turns) !== undefined) return { card: reply.tap };
    const message = reply.message.trim();
    return message === "" ? undefined : { say: message };
  }
}
