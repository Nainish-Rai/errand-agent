import { createAnthropic } from "@ai-sdk/anthropic";
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from "ai";

// Confirmed 2026-11-03 against https://platform.minimax.io/docs/api-reference/text-anthropic-api
// (model list, tool support) and https://platform.minimax.io/docs/guides/pricing (prices).
// MiniMax-M3 over MiniMax-M3.1-Flash: M3 has thinking off by default, so multi-turn tool calls
// don't depend on round-tripping thinking blocks, and it is the larger model.
export const MINIMAX_MODEL_ID = "MiniMax-M3";
export const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
export const MINIMAX_CONTEXT_WINDOW_TOKENS = 1_000_000;
// The AI SDK caps output at 4,096 tokens for a model id it doesn't know, which cuts long replies.
const MAX_OUTPUT_TOKENS = 16_384;

export class MissingMinimaxKeyError extends Error {
  constructor() {
    super(
      "MINIMAX_API_KEY is not set. Start the backend with " +
        '`MINIMAX_API_KEY="$(security find-generic-password -s errand-agent-minimax -w)" pnpm dev`, ' +
        "or pick another model with ERRAND_MODELS=main=scripted.",
    );
    this.name = "MissingMinimaxKeyError";
  }
}

/** MiniMax through its Anthropic-compatible API, called directly (no AI Gateway). */
export function createMinimaxModel(apiKey: string | undefined): LanguageModel {
  if (apiKey === undefined || apiKey.trim() === "") throw new MissingMinimaxKeyError();
  return wrapLanguageModel({
    model: createAnthropic({ baseURL: MINIMAX_BASE_URL, apiKey })(MINIMAX_MODEL_ID),
    middleware: defaultSettingsMiddleware({ settings: { maxOutputTokens: MAX_OUTPUT_TOKENS } }),
  });
}
