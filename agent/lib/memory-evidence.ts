import type { MemoryEvidence } from "../../src/core/memory/memory-fact";
import { MEMORY_CONTEXT_HEADING } from "../../src/core/use-cases/build-model-context";

// Where the words a memory tool quotes come from. The model says what the person said; this checks
// it against the conversation the model was actually given: the person's latest message, an earlier
// message of theirs, or a tool's result. Core decides what to trust; this only reports what it found.
// The remembered context eve adds as a user-role message is not the person speaking, so it never counts.

export interface MessageLike {
  readonly role: string;
  readonly content: unknown;
}

interface ToolResultText {
  readonly toolName: string;
  readonly text: string;
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[\s ]+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function partsOf(content: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(content)) return [];
  return content.filter((part): part is Record<string, unknown> => typeof part === "object" && part !== null);
}

function userTextOf(message: MessageLike): string {
  if (typeof message.content === "string") return message.content;
  return partsOf(message.content)
    .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
}

function toolResultsOf(message: MessageLike): ToolResultText[] {
  return partsOf(message.content).flatMap((part) => {
    if (part.type !== "tool-result") return [];
    const output = part.output as { readonly value?: unknown } | undefined;
    return [{ toolName: typeof part.toolName === "string" ? part.toolName : "unknown", text: textOf(output?.value ?? output) }];
  });
}

/** What the person typed, oldest first, without the remembered context eve places among them. */
export function personsMessages(messages: readonly MessageLike[]): string[] {
  return messages
    .filter((message) => message.role === "user")
    .map(userTextOf)
    .filter((text) => text.trim() !== "" && !text.includes(MEMORY_CONTEXT_HEADING));
}

export function evidenceFor(quote: string, messages: readonly MessageLike[], sessionId: string): MemoryEvidence {
  const wanted = normalized(quote);
  const said = personsMessages(messages).map(normalized);
  const latest = said.at(-1);
  if (wanted !== "" && latest?.includes(wanted)) return { kind: "user_message", sessionId, quote, position: "latest" };
  if (wanted !== "" && said.slice(0, -1).some((text) => text.includes(wanted))) {
    return { kind: "user_message", sessionId, quote, position: "earlier" };
  }
  const fromTool = messages.flatMap(toolResultsOf).find((result) => normalized(result.text).includes(wanted));
  if (wanted !== "" && fromTool !== undefined) return { kind: "tool_output", sessionId, quote, toolName: fromTool.toolName };
  return { kind: "unverified", sessionId, quote };
}
