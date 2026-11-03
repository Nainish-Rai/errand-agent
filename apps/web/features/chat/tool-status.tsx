"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { ToolCall } from "@/components/tool-call";

// What the person sees for a tool that has no card of its own: a quiet ToolCall row, present tense
// while it runs ("Checking your errand"), past tense once done, and a plain line if it failed. Never
// "Thinking", and raw tool names ("get errand") never reach the chat.

const RUNNING: Readonly<Record<string, string>> = {
  get_errand: "Checking your errand",
  update_errand: "Noting your errand",
  hold_slot: "Holding the slot",
};

const DONE: Readonly<Record<string, string>> = {
  get_errand: "Checked your errand",
  update_errand: "Noted your errand",
  hold_slot: "Held the slot",
};

const FAILED: Readonly<Record<string, string>> = {
  get_errand: "I couldn't read your errand just now.",
  update_errand: "I couldn't save that detail just now.",
  hold_slot: "I couldn't hold that slot.",
};

export const ToolStatus: ToolCallMessagePartComponent = ({ toolName, status, isError }) => {
  if (isError === true) return <ToolCall className="my-1" state="failed" label={FAILED[toolName] ?? "One step didn't work."} />;
  if (status.type === "running") return <ToolCall className="my-1" state="running" label={RUNNING[toolName] ?? "Working on it"} />;
  // A step with no words of its own leaves no row once it is done.
  const done = DONE[toolName];
  return done === undefined ? null : <ToolCall className="my-1" state="done" label={done} />;
};
