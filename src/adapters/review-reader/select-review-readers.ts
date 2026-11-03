import type { ModelPricing } from "../../core/ports/model-pricing";
import type { ReviewReader } from "../../core/ports/review-reader";
import { CLAUDE_CODE_MODEL_ID, createClaudeCodeReaderModel } from "../models/claude-code";
import { createMinimaxModel, MINIMAX_MODEL_ID } from "../models/minimax";
import type { ModelProviderName } from "../models/select-model";
import { ModelReviewReader } from "./model-review-reader";
import { ScriptedReviewReader } from "./scripted-review-reader";

// The review readers in fallback order for the `review_reader` role. Claude Code first (another
// vendor than the main agent, so one model's blind spot is not the other's), then MiniMax when its
// key is set. Offline it is the scripted reader alone, so no run touches the network. When every
// reader fails the insight is "not available"; no reader ever passes raw text on.

export interface ReviewReaderEnvironment {
  readonly minimaxApiKey: string | undefined;
  readonly pricing: ModelPricing;
}

function hasKey(key: string | undefined): key is string {
  return key !== undefined && key.trim() !== "";
}

function minimaxReader(environment: ReviewReaderEnvironment & { readonly minimaxApiKey: string }): ReviewReader {
  return new ModelReviewReader({
    name: "minimax",
    model: () => createMinimaxModel(environment.minimaxApiKey),
    modelId: MINIMAX_MODEL_ID,
    pricing: environment.pricing,
  });
}

export function reviewReadersFor(provider: ModelProviderName, environment: ReviewReaderEnvironment): ReviewReader[] {
  const { minimaxApiKey } = environment;
  const fallback = hasKey(minimaxApiKey) ? [minimaxReader({ ...environment, minimaxApiKey })] : [];
  switch (provider) {
    case "scripted":
      return [new ScriptedReviewReader()];
    case "minimax":
      return fallback;
    case "claude-code":
      return [
        new ModelReviewReader({
          name: "claude-code",
          model: () => createClaudeCodeReaderModel(),
          modelId: CLAUDE_CODE_MODEL_ID,
          pricing: environment.pricing,
        }),
        ...fallback,
      ];
  }
}
