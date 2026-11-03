"use client";

import { motion as lime } from "@errand/design-tokens";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Lime's layout motion (design-system-v3.html, Motion): something arriving rises 4px and fades in over
// --dur-base on --ease-out, something leaving fades over --dur-fast on --ease-in, a collapsing panel
// animates its height (or width), and a count slides its old figure out and the new one in. Only
// opacity, translate, scale and a collapsing panel's height or width move: no spring, no overshoot, no
// loop and nothing on scroll. What is on screen at first render shows settled.
//
// Under reduced motion every duration is zero, so each change is instant. Nothing here moves focus or
// touches a live region, so focus and announcements are the same either way.

/** Lime's transitions as motion takes them; every duration is zero under reduced motion. */
export function useLimeTiming() {
  const reduced = useReducedMotion() ?? false;
  const seconds = (ms: number) => (reduced ? 0 : ms / 1000);
  const curve = (points: typeof lime.easeOut): [number, number, number, number] => [...points];
  const timing = (ms: number, points: typeof lime.easeOut): Transition => ({ duration: seconds(ms), ease: curve(points) });
  return {
    reduced,
    /** Arriving, a popup or menu opening, a panel's height, rows arriving. */
    arrive: timing(lime.base, lime.easeOut),
    /** A small state change. */
    fast: timing(lime.fast, lime.easeOut),
    /** Anything leaving or closing. */
    leave: timing(lime.fast, lime.easeIn),
    /** A dialog or sheet opening. */
    open: timing(lime.slow, lime.easeOut),
    /** A dialog or sheet closing: faster than it opened. */
    close: timing(lime.base, lime.easeIn),
  };
}

/**
 * Wraps children that come and go. What is there on the first render shows settled; later arrivals and
 * departures animate. `wait` lets one child leave before the next arrives (a state swap).
 */
export function Presence({ children, wait = false }: { readonly children: ReactNode; readonly wait?: boolean }) {
  return (
    <AnimatePresence initial={false} mode={wait ? "wait" : "sync"}>
      {children}
    </AnimatePresence>
  );
}

const revealTags = { div: motion.div, li: motion.li, section: motion.section, p: motion.p } as const;

type RevealProps = {
  readonly as?: keyof typeof revealTags;
  readonly children: ReactNode;
  readonly className?: string;
  readonly id?: string;
  readonly role?: string;
  readonly "aria-label"?: string;
  readonly "aria-busy"?: boolean;
  /** Rise on arrival in px; 0 for a panel that only opens. */
  readonly rise?: number;
};

/**
 * A row, widget or panel that opens its height as it arrives and collapses it as it leaves, so whatever
 * sits below slides instead of jumping. Put it directly inside `Presence`, with a stable key.
 * It clips only while it moves, so focus rings inside it are never cut off at rest.
 */
export function Reveal({ as = "div", children, className, rise = 4, ...rest }: RevealProps) {
  const timing = useLimeTiming();
  const ref = useRef<HTMLElement>(null);
  const Tag = revealTags[as];
  const clip = (on: boolean) => {
    if (ref.current !== null) ref.current.style.overflow = on ? "hidden" : "";
  };
  return (
    <Tag
      // One ref type serves every tag here: each is an HTMLElement.
      ref={ref as never}
      className={className}
      initial={{ height: 0, opacity: 0, y: rise }}
      animate={{ height: "auto", opacity: 1, y: 0, transition: timing.arrive }}
      exit={{ height: 0, opacity: 0, y: 0, transition: timing.leave }}
      onAnimationStart={() => clip(true)}
      onAnimationComplete={() => clip(false)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Text or a mark that changes in place (a status word, a corrected value): the old one fades out and
 * the new one fades in with a small rise, in the same box, so nothing around it moves.
 */
export function CrossFade({ swapKey, children, className }: { readonly swapKey: string; readonly children: ReactNode; readonly className?: string }) {
  const timing = useLimeTiming();
  return (
    <span className={cn("inline-grid", className)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={swapKey}
          className="col-start-1 row-start-1 min-w-0"
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0, transition: timing.fast }}
          exit={{ opacity: 0, transition: timing.leave }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * A count that changes: the old figure slides 4px up and out over --dur-fast while the new one slides in
 * from below, in one tabular box, so the badge around it keeps its place. Screen readers get the
 * current figure once.
 */
export function AnimatedCount({ value, className }: { readonly value: number; readonly className?: string }) {
  const timing = useLimeTiming();
  return (
    <span className={cn("relative inline-grid overflow-hidden tabular-nums", className)}>
      <span className="sr-only">{value}</span>
      <AnimatePresence initial={false}>
        <motion.span
          key={value}
          aria-hidden
          className="col-start-1 row-start-1 text-center"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0, transition: timing.fast }}
          exit={{ opacity: 0, y: -4, transition: timing.leave }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
