// The shared frame of the fixed trust components. It is private to features/trust on purpose:
// generated UI must never be able to copy the look of a surface that commits money.
import { CircleCheck, TriangleAlert } from "lucide-react";
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

// ---- v3's ApprovalRequest and ActionReceipt frame (ticket 21). Hanken Grotesk throughout: mono is
// kept for code and IDs only; numbers and times use tabular figures.

/**
 * The card a commitment is made on: v3's Card (--surface, --radius-panel, 16px in, 12px apart). It
 * rises in when it arrives. `data-state` names the state, so a state change can be told apart.
 */
export function RequestCard({
  label,
  state,
  busy = false,
  children,
}: {
  readonly label: string;
  readonly state: string;
  readonly busy?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      aria-busy={busy || undefined}
      data-trust-surface=""
      data-slot="approval-request"
      data-state={state}
      className="flex w-full min-w-0 animate-rise flex-col gap-3 rounded-panel bg-surface p-4 text-sm text-fg"
    >
      {children}
    </section>
  );
}

/** A provider's initials, for the picture's fallback: "Shiva Sanitary Solutions" is "SS". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** A provider's picture. Until ticket 22 adds photos it is their initials; `media` replaces it. */
export function RequestMedia({ media, initials }: { readonly media?: ReactNode; readonly initials: string }) {
  if (media !== undefined) return <span className="flex size-10 shrink-0 overflow-hidden rounded-sm">{media}</span>;
  return (
    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-sm border border-line bg-page text-sm font-semibold text-fg-2">
      {initials}
    </span>
  );
}

/** v3's Amount: the money a commitment moves, as a chip. A charge reads with a true minus sign. */
export function AmountChip({ amount }: { readonly amount: number }) {
  const shown = amount === 0 ? "₹0" : `−₹${new Intl.NumberFormat("en-IN").format(amount)}`;
  return (
    <span className="inline-flex h-7 shrink-0 items-center rounded-control bg-surface-2 px-3 text-sm font-medium whitespace-nowrap text-fg-2 tabular-nums">
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{amount === 0 ? "No charge" : `₹${amount} to pay`}</span>
    </span>
  );
}

export type Detail = {
  readonly label: string;
  readonly value: ReactNode;
  /** An amount: right-aligned in tabular figures. */
  readonly amount?: boolean;
  /** An ID, the one thing set in mono. */
  readonly id?: boolean;
};

/** The material details: v3's two-column list, labels in --fg-2. */
export function Details({ rows, faded = false }: { readonly rows: readonly Detail[]; readonly faded?: boolean }) {
  return (
    <dl
      className={cn(
        "m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm transition-opacity duration-(--dur-base)",
        faded && "opacity-60",
      )}
    >
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-fg-2">{row.label}</dt>
          <dd
            className={cn(
              "m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 text-fg tabular-nums",
              row.amount === true && "justify-end",
              row.id === true && "font-mono",
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A line under the heading that opens its height over --dur-base when it appears (a stale or declined card). */
export function CardNote({ tone, icon, children }: { readonly tone: "warn" | "info"; readonly icon: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="grid animate-open grid-rows-[1fr]">
      <div className="min-h-0 overflow-hidden">
        <p className={cn("m-0 flex items-start gap-2 pt-1 text-sm", tone === "warn" ? "text-warn-text" : "text-fg-2")}>
          <span aria-hidden className="mt-0.5 flex shrink-0 [&_svg]:size-4">
            {icon}
          </span>
          <span className="min-w-0">{children}</span>
        </p>
      </div>
    </div>
  );
}

/** The footer: the actions, or the outcome that replaced them, at the same height so nothing below moves. */
export function RequestFooter({ outcome, children }: { readonly outcome: string; readonly children: ReactNode }) {
  return (
    <div aria-live="polite" className="flex min-h-8 items-center gap-2">
      <div key={outcome} className="flex min-w-0 flex-1 animate-rise flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}

/** One line of what was done: a mark, a hidden Done or Failed, the past-tense label and its detail. */
export type ReceiptLine = {
  readonly label: string;
  readonly detail?: ReactNode;
  /** The step did not happen; the label says why. */
  readonly failed?: boolean;
};

/** v3's apart(): rows 40ms apart (half of --dur-instant, so reduced motion zeroes it too), at most five steps. */
function apart(index: number): string {
  return `calc(var(--dur-instant) * ${Math.min(index, 5)} / 2)`;
}

/**
 * v3's ActionReceipt: an assistant message, not a card. The head says what happened, the lines what
 * Errand did, each with its detail, then a note and the follow-on actions. Lines arrive 40ms apart.
 */
export function ActionReceipt({
  label,
  state,
  head,
  lines,
  note,
  actions,
  busy = false,
}: {
  readonly label: string;
  readonly state: string;
  readonly head: ReactNode;
  readonly lines: readonly ReceiptLine[];
  readonly note?: ReactNode;
  readonly actions?: ReactNode;
  readonly busy?: boolean;
}) {
  return (
    <section
      aria-label={label}
      aria-busy={busy || undefined}
      data-trust-surface=""
      data-slot="action-receipt"
      data-state={state}
      className="flex w-full min-w-0 flex-col text-sm text-fg"
    >
      <div className="flex min-w-0 animate-rise items-center gap-3">{head}</div>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {lines.map((line, index) => (
          <li key={line.label} className="flex min-w-0 animate-rise items-center gap-2.5" style={{ animationDelay: apart(index + 1) }}>
            {line.failed === true ? (
              <TriangleAlert aria-hidden className="size-4 shrink-0 text-danger-text" />
            ) : (
              <CircleCheck aria-hidden className="size-4 shrink-0 text-success-text" />
            )}
            <span className="sr-only">{line.failed === true ? "Failed" : "Done"}: </span>
            <span className={cn("min-w-0", line.failed === true ? "flex-1 text-danger-text" : "truncate")}>{line.label}</span>
            {line.detail !== undefined && <span className="min-w-0 flex-1 truncate text-end text-fg-3 tabular-nums">{line.detail}</span>}
          </li>
        ))}
      </ul>
      {note !== undefined && (
        <p className="m-0 mt-3 animate-rise text-sm text-fg-2" style={{ animationDelay: apart(5) }}>
          {note}
        </p>
      )}
      {actions !== undefined && (
        <div className="-ml-2 mt-2 flex animate-rise flex-wrap items-center gap-1" style={{ animationDelay: apart(5) }}>
          {actions}
        </div>
      )}
    </section>
  );
}
