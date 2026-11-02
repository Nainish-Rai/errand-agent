import { cn } from "@/lib/utils";

import { Spinner } from "./ui/spinner";

export type StatusKind = "ok" | "checking" | "replacing" | "cancelled" | "needs-you" | "expired";

const glyphs: Record<Exclude<StatusKind, "checking">, { readonly glyph: string; readonly tone: string }> = {
  ok: { glyph: "✓", tone: "text-ok" },
  replacing: { glyph: "↻", tone: "text-fg-meta" },
  cancelled: { glyph: "✕", tone: "text-err" },
  "needs-you": { glyph: "●", tone: "text-warn" },
  expired: { glyph: "◷", tone: "text-fg-meta" },
};

type StatusMarkProps = {
  readonly kind: StatusKind;
  /** Always shown: status is never carried by colour or glyph alone. */
  readonly label: string;
  readonly className?: string;
};

/** A glyph in the status tone followed by its text label. */
export function StatusMark({ kind, label, className }: StatusMarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-label text-fg-body", className)} data-status={kind}>
      {kind === "checking" ? (
        <Spinner aria-hidden className="mx-0.5" />
      ) : (
        <span aria-hidden className={cn("w-3.5 text-center", glyphs[kind].tone)}>
          {glyphs[kind].glyph}
        </span>
      )}
      {label}
    </span>
  );
}
