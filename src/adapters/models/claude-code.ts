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

/**
 * Claude Code as the review reader: the quarantined model that reads untrusted reviews. Every
 * built-in tool, MCP server and filesystem setting is off, so whatever a review says, the CLI has
 * nothing to act with; and nothing is saved to ~/.claude.
 */
export function createClaudeCodeReaderModel(modelId: string = CLAUDE_CODE_MODEL_ID): LanguageModel {
  return claudeCode(modelId, {
    tools: [],
    allowedTools: [],
    mcpServers: {},
    settingSources: [],
    persistSession: false,
  });
}
