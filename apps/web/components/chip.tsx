import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { focusRing } from "./ui/button";

const chipBase =
  "inline-flex items-center gap-1.5 rounded-control border px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45";

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
        "border-line bg-page text-fg-3 hover:border-line-strong hover:text-fg-2",
        "data-selected:border-accent-line data-selected:bg-accent-wash data-selected:text-fg",
        className,
      )}
      {...props}
    >
      {icon !== undefined && <span aria-hidden>{icon}</span>}
      <span className="text-fg">{value}</span>
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
        "rounded-full border-dashed border-line-strong bg-page px-2.5 text-fg-2 hover:bg-surface-2 hover:text-fg",
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
        origin === "inferred" ? "inferred bg-page text-warn-text" : "border-line bg-page text-fg-2",
        className,
      )}
      {...props}
    />
  );
}
