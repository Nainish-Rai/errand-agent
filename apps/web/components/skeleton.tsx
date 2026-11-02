import { cn } from "@/lib/utils";

/** A loading placeholder bar. Mark the container aria-busy while it shows. */
export function Skeleton({ className }: { readonly className?: string }) {
  return <div aria-hidden className={cn("h-2.5 rounded-sm bg-surface-raised", className)} />;
}
