import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** A key or shortcut, e.g. ⌘K. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("rounded-sm border border-b-2 border-edge-strong px-1 font-mono text-meta text-fg-meta", className)}
      {...props}
    />
  );
}
