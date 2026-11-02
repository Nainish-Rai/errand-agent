import type { LanguageModel } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";

export const CLAUDE_CODE_MODEL_ID = "haiku";

/**
 * Claude through the local `claude` CLI login. The provider has no AI SDK tool calling, so it
 * serves only roles without tools (review reader, user simulator, judge).
 */
export function createClaudeCodeModel(modelId: string = CLAUDE_CODE_MODEL_ID): LanguageModel {
  return claudeCode(modelId);
}
