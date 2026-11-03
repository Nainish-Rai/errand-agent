import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type InferredValueProps = {
  /** What kind of guess this is, shown beside the value: "estimated", "heuristic score", "inferred". */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
};

/**
 * An estimate, a heuristic score or an inferred value: the dashed warn edge tells a guess from a
 * fact. Use it for every estimated cost and heuristic score, and never for a measured or explicit one.
 */
export function InferredValue({ label, children, className }: InferredValueProps) {
  return (
    <span className={cn("inferred inline-flex items-baseline gap-1 rounded-sm border px-1.5 py-px text-xs", className)}>
      <span className="text-fg tabular-nums">{children}</span>
      <span className="text-xs text-warn-text">{label}</span>
    </span>
  );
}
