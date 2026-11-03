"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

import { Spinner } from "@/components/ui/spinner";

// What the person sees for a tool that has no card of its own: a human status line while it runs
// ("Checking your errand…"), nothing once it is done, and a plain line if it failed. Raw tool names
// ("get errand") never reach the chat.

const RUNNING: Readonly<Record<string, string>> = {
  get_errand: "Checking your errand…",
  update_errand: "Noting your errand…",
  hold_slot: "Holding the slot…",
};

const FAILED: Readonly<Record<string, string>> = {
  get_errand: "I couldn't read your errand just now.",
  update_errand: "I couldn't save that detail just now.",
  hold_slot: "I couldn't hold that slot.",
};

export const ToolStatus: ToolCallMessagePartComponent = ({ toolName, status, isError }) => {
  if (isError === true) return <p className="my-1 text-label text-fg-meta">{FAILED[toolName] ?? "One step didn't work."}</p>;
  if (status.type !== "running") return null;
  return (
    <p className="my-1 flex items-center gap-2 text-label text-fg-meta" role="status">
      <Spinner /> {RUNNING[toolName] ?? "Working on it…"}
    </p>
  );
};
