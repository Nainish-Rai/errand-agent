"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRef } from "react";

import { useLimeTiming } from "@/components/layout-motion";
import { Button } from "@/components/ui/button";
import { appApi } from "@/features/chat/backend";

import { MemoryFacts } from "./memory-facts";

// v3's memory sheet: every fact Errand keeps, each correctable or forgettable, the guesses dashed. It rises
// from the bottom over --dur-slow on --ease-out while the scrim fades in, and leaves faster on --ease-in.
// It is a modal dialog: focus moves into it, Tab stays inside, Escape or Done closes it and focus goes
// back to whatever opened it. Done is the sheet's one lime action.

export function MemorySheet({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const timing = useLimeTiming();
  const done = useRef<HTMLButtonElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-(--z-dialog) bg-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: timing.open }}
                exit={{ opacity: 0, transition: timing.close }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby="memory-sheet-description">
              <motion.div
                className="fixed inset-x-0 bottom-0 z-(--z-dialog) mx-auto flex max-h-[90dvh] w-full max-w-(--overlay-lg) flex-col overflow-hidden rounded-t-sheet bg-raised text-fg shadow-overlay outline-none"
                initial={{ y: "100%" }}
                animate={{ y: 0, transition: timing.open }}
                exit={{ y: "100%", transition: timing.close }}
              >
                <div aria-hidden className="mx-auto mt-2 h-1 w-9 flex-none rounded-full bg-line-strong" />
                <div className="flex flex-none items-start gap-3 px-5 pt-4 pb-3">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <DialogPrimitive.Title className="m-0 text-xl leading-tight font-semibold tracking-tight text-fg">Memory</DialogPrimitive.Title>
                    <DialogPrimitive.Description id="memory-sheet-description" className="m-0 text-sm text-fg-2">
                      What Errand keeps about you, and where it came from.
                    </DialogPrimitive.Description>
                  </div>
                  <DialogPrimitive.Close asChild>
                    <Button aria-label="Close" size="icon-sm" variant="secondary">
                      <X />
                    </Button>
                  </DialogPrimitive.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2">
                  <MemoryFacts api={appApi} returnFocus={() => done.current?.focus()} />
                </div>
                <div className="flex flex-none flex-col px-5 pt-3 pb-5">
                  <DialogPrimitive.Close asChild>
                    <Button ref={done} size="lg" variant="primary" className="w-full">
                      Done
                    </Button>
                  </DialogPrimitive.Close>
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
