"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { MemoryToolOutputSchema } from "@errand/contracts";
import { Info } from "lucide-react";
import { useState } from "react";

import { Presence, Reveal } from "@/components/layout-motion";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { MemorySheet } from "./memory-sheet";

// v3's memory line in chat: when the agent saves, corrects, confirms or forgets a fact, one quiet line says
// "Memory updated · View", and View opens the memory sheet. There is no Undo: memory changes are undone by
// correcting or forgetting in the sheet. A call that changed nothing (already remembered, refused) shows
// no line; the agent says why in its reply. The line arrives with v3's 4px rise; a replayed chat shows
// it settled.

const CHANGED = new Set(["remembered", "corrected", "forgotten", "confirmed"]);

function changedMemory(result: unknown): boolean {
  const parsed = MemoryToolOutputSchema.safeParse(result);
  return parsed.success && CHANGED.has(parsed.data.kind);
}

/** "Memory updated · View": the View button opens the memory sheet. */
export function MemoryUpdatedLine() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="my-1 flex flex-wrap items-center gap-2 text-sm text-fg-2">
        <Info aria-hidden className="size-4 text-fg-3" />
        <span>Memory updated</span>
        <span aria-hidden>·</span>
        <Button size="sm" variant="link" className="h-auto px-0 text-sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          View
        </Button>
      </p>
      <MemorySheet open={open} onOpenChange={setOpen} />
    </>
  );
}

/** The chat part for remember_fact, correct_fact, confirm_fact and forget_fact. */
export const MemoryUpdatedPart: ToolCallMessagePartComponent = ({ status, result, isError }) => {
  const running = status.type === "running";
  const changed = !running && isError !== true && changedMemory(result);
  return (
    <Presence wait>
      {running && (
        <Reveal key="running" as="p" role="status" className="my-1 flex items-center gap-2 text-xs text-fg-3">
          <Spinner aria-hidden role="presentation" /> Updating your memory…
        </Reveal>
      )}
      {changed && (
        <Reveal key="changed">
          <MemoryUpdatedLine />
        </Reveal>
      )}
    </Presence>
  );
};
