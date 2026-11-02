import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ToastTone = "ok" | "err" | "info";

const toastGlyph: Record<ToastTone, { readonly glyph: string; readonly tone: string; readonly word: string }> = {
  ok: { glyph: "✓", tone: "text-ok", word: "Done" },
  err: { glyph: "✕", tone: "text-err", word: "Failed" },
  info: { glyph: "i", tone: "text-info", word: "Note" },
};

type ToastProps = {
  readonly tone: ToastTone;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
};

/**
 * The toast's look. It is presentational: the caller (a toaster such as sonner) decides when it shows.
 * An error interrupts (role="alert"); the rest are polite.
 */
export function Toast({ tone, children, action, className }: ToastProps) {
  const { glyph, tone: toneClass, word } = toastGlyph[tone];
  return (
    <div
      role={tone === "err" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-2 rounded-md border border-edge-strong bg-surface-raised px-3 py-2 text-label text-fg-emph shadow-md",
        className,
      )}
    >
      <span aria-hidden className={cn("w-3.5 text-center font-semibold", toneClass)}>
        {glyph}
      </span>
      <span className="sr-only">{word}: </span>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}
