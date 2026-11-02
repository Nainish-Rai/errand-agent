import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { focusRing } from "./ui/button";

const chipBase =
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-label transition-colors disabled:cursor-not-allowed disabled:opacity-45";

type FilterChipProps = Omit<ComponentProps<"button">, "value"> & {
  readonly icon?: ReactNode;
  /** The current value, e.g. "Koramangala". */
  readonly value: ReactNode;
  /** True when the filter narrows the results (it is not at its default). */
  readonly selected?: boolean;
};

/** A filter with a menu (⌄). The menu itself belongs to the caller; this is its trigger. */
export function FilterChip({ icon, value, selected = false, className, ...props }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      data-selected={selected || undefined}
      className={cn(
        chipBase,
        focusRing,
        "border-edge bg-surface-canvas text-fg-meta hover:border-edge-strong hover:text-fg-body",
        "data-selected:border-interactive data-selected:bg-interactive-tint data-selected:text-fg-emph",
        className,
      )}
      {...props}
    >
      {icon !== undefined && <span aria-hidden>{icon}</span>}
      <span className="text-fg-emph">{value}</span>
      <span aria-hidden>⌄</span>
    </button>
  );
}

/** A suggested follow-up: a dashed pill. Selecting it sends its text. */
export function SuggestionChip({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        chipBase,
        focusRing,
        "rounded-full border-dashed border-edge-strong bg-surface-canvas px-2.5 text-fg-body hover:bg-surface-raised hover:text-fg-emph",
        className,
      )}
      {...props}
    />
  );
}

export type FactOrigin = "explicit" | "inferred";

type MemoryChipProps = ComponentProps<"span"> & {
  /** Explicit facts are solid; inferred ones use the dashed warn edge. */
  readonly origin: FactOrigin;
};

export function MemoryChip({ origin, className, ...props }: MemoryChipProps) {
  return (
    <span
      data-origin={origin}
      className={cn(
        chipBase,
        origin === "inferred" ? "inferred bg-surface-canvas text-warn" : "border-edge bg-surface-canvas text-fg-body",
        className,
      )}
      {...props}
    />
  );
}
