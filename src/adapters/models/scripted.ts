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

export function createScriptedModel(): LanguageModel {
  return mockModel({ modelId: "errand-script", provider: "errand-scripted", respond: respondToSearchErrand });
}
