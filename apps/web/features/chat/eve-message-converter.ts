import type { ThreadMessageLike } from "@assistant-ui/react";
import type { EveMessage, EveMessagePart } from "@errand/client";

// eve projects its event stream into EveMessage[]; assistant-ui renders ThreadMessageLike[].
// This is the whole mapping between the two: one eve part becomes at most one assistant-ui part.

type ThreadPart = Exclude<ThreadMessageLike["content"], string>[number];

type JsonObject = { readonly [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function convertPart(part: EveMessagePart): ThreadPart | undefined {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "reasoning":
      return { type: "reasoning", text: part.text };
    case "tool":
      return {
        type: "tool-call",
        toolCallId: part.callId,
        toolName: part.name,
        args: isJsonObject(part.input) ? part.input : {},
        argsText: part.state === "streaming" ? part.inputText : JSON.stringify(part.input ?? {}),
        result: part.output,
        isError: part.state === "failed",
      };
    // Files and interactions (sign-in, approvals, questions) get their own components in later tickets.
    case "file":
    case "interaction":
      return undefined;
  }
}

function statusOf(message: EveMessage): ThreadMessageLike["status"] {
  if (message.role !== "assistant") return undefined;
  switch (message.metadata?.status) {
    case "streaming":
      return { type: "running" };
    case "failed":
      return { type: "incomplete", reason: "error" };
    default:
      return { type: "complete", reason: "stop" };
  }
}

export function convertEveMessage(message: EveMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    content: message.parts.flatMap((part) => {
      const converted = convertPart(part);
      return converted === undefined ? [] : [converted];
    }),
    status: statusOf(message),
    metadata: { isOptimistic: message.metadata?.optimistic === true },
  };
}
