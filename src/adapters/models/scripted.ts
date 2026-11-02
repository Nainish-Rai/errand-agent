import type { ModelScript } from "@errand/contracts";
import type { LanguageModel } from "ai";
import { mockModel, type MockModelRequest, type MockModelResponse } from "eve/evals";

import { AREAS, resolveArea, resolveService, SERVICES } from "../world/seed/catalog";

// The offline stand-in for the main model. Like the real model it learns today's date from the
// instructions and decides from the conversation; it never reads the world directly.

const DAY_MS = 24 * 60 * 60 * 1_000;

function todayFrom(request: MockModelRequest): string | undefined {
  const system = request.messages.filter((message) => message.role === "system").map((message) => message.text);
  return system.join("\n").match(/Today is (\d{4}-\d{2}-\d{2})/)?.[1];
}

function weekFrom(today: string): { from: string; to: string } {
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + 6 * DAY_MS).toISOString().slice(0, 10);
  return { from: today, to: end };
}

function serviceIn(text: string): string | undefined {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  // Two-word phrases first, so "ac repair" wins over a bare "ac".
  const phrases = words.flatMap((word, index) => [`${word} ${words[index + 1] ?? ""}`.trim(), word]);
  return phrases.map(resolveService).find((service) => service !== undefined);
}

function areaIn(text: string): string | undefined {
  const lowered = text.toLowerCase();
  return AREAS.find((area) => lowered.includes(area.toLowerCase())) ?? resolveArea(lowered);
}

interface SearchOutput {
  readonly kind: string;
  readonly providers?: readonly { readonly name: string; readonly priceInr: number; readonly rating: number }[];
}

function summarize(output: SearchOutput): string {
  if (output.kind !== "found" || output.providers === undefined) {
    return "I couldn't search for that. Which service and which area do you need?";
  }
  const lines = output.providers
    .slice(0, 3)
    .map((provider) => `- ${provider.name}: ₹${provider.priceInr}, rated ${provider.rating}`);
  return [`I found ${output.providers.length} providers. The top options:`, ...lines].join("\n");
}

function respondToSearchErrand(request: MockModelRequest): MockModelResponse | string {
  const searched = request.toolResults.findLast((result) => result.name === "search_providers");
  if (searched !== undefined) return summarize(searched.output as SearchOutput);

  const text = request.lastUserMessage ?? "";
  const service = serviceIn(text);
  const area = areaIn(text);
  const today = todayFrom(request);
  if (service === undefined || area === undefined || today === undefined) {
    return `Which service do you need (${SERVICES.join(", ")}) and in which area?`;
  }
  return { toolCalls: [{ name: "search_providers", input: { service, area, date_range: weekFrom(today) } }] };
}

export class ModelScriptExhaustedError extends Error {
  constructor(where: string) {
    super(`The loaded model script has no step for ${where}. Add the step to the scenario's model turns.`);
    this.name = "ModelScriptExhaustedError";
  }
}

/** Where the conversation stands: the user message being answered and the model's responses since. */
export interface ScriptPosition {
  /** 0-based index of the latest user message. */
  readonly turn: number;
  /** How many model responses already answer that message. */
  readonly step: number;
}

/**
 * Read from the conversation itself, not a counter, so a retried or replayed model call gets the
 * same step and two sessions can't push each other's script forward.
 */
export function positionIn(request: Pick<MockModelRequest, "messages" | "userMessageCount">): ScriptPosition {
  const lastUser = request.messages.findLastIndex((message) => message.role === "user");
  const step = request.messages.slice(lastUser + 1).filter((message) => message.role === "assistant").length;
  return { turn: Math.max(0, request.userMessageCount - 1), step };
}

/**
 * The offline main model. With a scenario's script loaded it plays the script step by step and
 * fails loudly when the script runs out; with none it falls back to the ticket 01 search responder.
 */
export class ModelScriptPlayer {
  #script: ModelScript | undefined;

  get loadedTurns(): number {
    return this.#script?.turns.length ?? 0;
  }

  load(script: ModelScript): void {
    this.#script = script;
  }

  unload(): void {
    this.#script = undefined;
  }

  respond(request: MockModelRequest): MockModelResponse | string {
    if (this.#script === undefined) return respondToSearchErrand(request);
    const { turn, step } = positionIn(request);
    const scripted = this.#script.turns[turn]?.steps[step];
    if (scripted === undefined) throw new ModelScriptExhaustedError(`user message ${turn + 1}, step ${step + 1}`);
    return { text: scripted.text, toolCalls: scripted.toolCalls };
  }
}

export function createScriptedModel(player: ModelScriptPlayer): LanguageModel {
  return mockModel({ modelId: "errand-script", provider: "errand-scripted", respond: (request) => player.respond(request) });
}
