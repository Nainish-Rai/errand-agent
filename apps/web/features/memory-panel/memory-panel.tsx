"use client";

import { ApiClient } from "@errand/client";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { useMemo, useRef } from "react";

import { useLimeTiming, useWideScreen } from "@/components/layout-motion";
import { Button } from "@/components/ui/button";

import { MemoryFacts } from "./memory-facts";

// What the agent remembers about the person, beside the chat: the same list as the memory sheet. On a wide
// screen it is a collapsing panel, so its width opens over --dur-base and the chat reflows instead of
// jumping; below the lg breakpoint it covers the chat and rises in like a sheet. It refetches whenever
// the chat sees new activity, so a fact changed in chat shows up here too.

export function MemoryPanel({
  backendUrl,
  activity,
  onClose,
}: {
  readonly backendUrl: string;
  /** Changes whenever the chat sees new session events. */
  readonly activity: number;
  readonly onClose: () => void;
}) {
  const api = useMemo(() => new ApiClient({ baseUrl: backendUrl }), [backendUrl]);
  const timing = useLimeTiming();
  const wide = useWideScreen();
  const close = useRef<HTMLButtonElement>(null);

  return (
    <motion.aside
      aria-label="Memory"
      className="fixed inset-0 z-30 h-dvh overflow-hidden border-l border-line bg-page lg:static lg:z-auto lg:shrink-0"
      initial={wide ? { width: 0 } : { y: "100%" }}
      animate={wide ? { width: "var(--sheet)", transition: timing.arrive } : { y: 0, transition: timing.open }}
      exit={wide ? { width: 0, transition: timing.leave } : { y: "100%", transition: timing.close }}
    >
      {/* The content keeps its width while the panel opens, so nothing inside rewraps. */}
      <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-4 lg:w-(--sheet)">
        <header className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="m-0 text-lg font-semibold text-fg">Memory</h2>
            <p className="m-0 text-sm text-fg-2">What Errand keeps about you. Guesses are dashed and never used until you confirm them.</p>
          </div>
          <Button ref={close} aria-label="Close memory" size="icon-sm" variant="secondary" onClick={onClose}>
            <X />
          </Button>
        </header>
        <MemoryFacts api={api} activity={activity} returnFocus={() => close.current?.focus()} />
      </div>
    </motion.aside>
  );
}
