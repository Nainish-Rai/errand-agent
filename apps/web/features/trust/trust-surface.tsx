// The shared frame of the fixed trust components. It is private to features/trust on purpose:
// generated UI must never be able to copy the look of a surface that commits money.
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function TrustCard({
  label,
  tone = "plain",
  busy = false,
  children,
}: {
  readonly label: string;
  readonly tone?: "plain" | "voided" | "alert";
  readonly busy?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      aria-busy={busy || undefined}
      data-trust-surface=""
      className={cn(
        "overflow-hidden rounded-panel border bg-surface text-sm",
        tone === "voided" ? "border-danger/45" : "border-line-strong",
        tone === "alert" && "border-l-[3px] border-l-danger",
      )}
    >
      {children}
    </section>
  );
}

export function TrustHeader({ title, lead, status }: { readonly title: string; readonly lead?: ReactNode; readonly status?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-fg-3">
      {lead}
      <h3 className="m-0 text-sm font-semibold text-fg">{title}</h3>
      {status !== undefined && <div className="ml-auto">{status}</div>}
    </header>
  );
}

export type DetailRow = {
  readonly label: string;
  readonly value: ReactNode;
  /** Numbers, times and IDs are set in mono. */
  readonly mono?: boolean;
};

/** The fixed key–value table of material details. */
export function DetailTable({ rows, faded = false }: { readonly rows: readonly DetailRow[]; readonly faded?: boolean }) {
  return (
    <dl className={cn("m-0 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 p-3", faded && "opacity-60")}>
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-fg-3">{row.label}</dt>
          <dd className={cn("m-0 flex items-center gap-1.5 text-fg", row.mono && "font-mono tabular-nums")}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TrustNote({ children }: { readonly children: ReactNode }) {
  return <p className="m-0 px-3 pb-2 text-xs text-fg-3">{children}</p>;
}

export function TrustActions({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 px-3 pt-2 pb-3">{children}</div>;
}

export function Notice({
  tone,
  lead,
  children,
  live = false,
}: {
  readonly tone: "err" | "info" | "ok";
  readonly lead: ReactNode;
  readonly children: ReactNode;
  /** Announce changes politely (for "checking…" lines that later resolve). */
  readonly live?: boolean;
}) {
  return (
    <div
      aria-live={live ? "polite" : undefined}
      className={cn(
        "flex items-start gap-2 px-3 py-2 text-xs text-fg",
        tone === "err" && "bg-danger-tint",
        tone === "info" && "bg-accent-wash",
        tone === "ok" && "bg-success-tint",
      )}
    >
      <span className="mt-0.5 flex-none">{lead}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
