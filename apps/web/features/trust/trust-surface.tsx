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
        "overflow-hidden rounded-lg border bg-surface-card text-body",
        tone === "voided" ? "border-err/45" : "border-edge-strong",
        tone === "alert" && "border-l-[3px] border-l-err",
      )}
    >
      {children}
    </section>
  );
}

export function TrustHeader({ title, lead, status }: { readonly title: string; readonly lead?: ReactNode; readonly status?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 border-b border-edge px-3 py-2 text-label text-fg-meta">
      {lead}
      <h3 className="m-0 text-body font-semibold text-fg-emph">{title}</h3>
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
          <dt className="text-fg-meta">{row.label}</dt>
          <dd className={cn("m-0 flex items-center gap-1.5 text-fg-emph", row.mono && "font-mono tabular-nums")}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TrustNote({ children }: { readonly children: ReactNode }) {
  return <p className="m-0 px-3 pb-2 text-label text-fg-meta">{children}</p>;
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
        "flex items-start gap-2 px-3 py-2 text-label text-fg-emph",
        tone === "err" && "bg-err-tint",
        tone === "info" && "bg-interactive-tint",
        tone === "ok" && "bg-ok-tint",
      )}
    >
      <span className="mt-0.5 flex-none">{lead}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
