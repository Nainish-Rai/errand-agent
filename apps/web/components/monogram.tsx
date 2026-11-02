import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

export type MonogramTone = 1 | 2 | 3 | 4 | 5 | 6;

type MonogramProps = {
  /** One or two letters. Providers get initials, never photos of people. */
  readonly initials: string;
  /** A categorical palette slot (--cat-1 … --cat-6), so a provider keeps its colour everywhere. */
  readonly tone?: MonogramTone;
  readonly className?: string;
};

export function Monogram({ initials, tone = 1, className }: MonogramProps) {
  return (
    <span
      aria-hidden
      style={{ "--av": `var(--cat-${tone})` } as CSSProperties}
      className={cn(
        "grid size-6 flex-none place-items-center rounded-md border text-meta font-semibold text-fg-emph",
        "border-[color-mix(in_oklab,var(--av)_45%,transparent)] bg-[color-mix(in_oklab,var(--av)_28%,var(--surface-card))]",
        className,
      )}
    >
      {initials}
    </span>
  );
}
