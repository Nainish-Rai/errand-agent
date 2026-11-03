import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Badge } from "./ui/badge";

type WidgetProps = {
  readonly icon?: ReactNode;
  readonly title: string;
  /** A count in the header: `needs-you` uses the warn fill, `plain` is text. */
  readonly count?: { readonly value: number; readonly tone: "needs-you" | "plain" };
  /** One optional header action, e.g. a SegmentedControl or a small Button. */
  readonly action?: ReactNode;
  /** While the body loads; pair it with Skeleton rows. */
  readonly busy?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
};

/** The base of every home widget: header (icon, title, count, action), then compact rows. */
export function Widget({ icon, title, count, action, busy = false, children, className }: WidgetProps) {
  return (
    <section aria-label={title} aria-busy={busy || undefined} className={cn("rounded-lg border border-edge bg-surface-card px-3 py-2.5", className)}>
      <header className="mb-2 flex items-center gap-1.5 text-label text-fg-meta">
        {icon !== undefined && <span aria-hidden>{icon}</span>}
        <h3 className="m-0 text-label font-normal">{title}</h3>
        {count?.tone === "needs-you" && <Badge variant="count">{count.value}</Badge>}
        {count?.tone === "plain" && <span className="font-mono text-fg-emph tabular-nums">{count.value}</span>}
        {action !== undefined && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

type ListRowProps = {
  /** A status mark, monogram or dot before the text. */
  readonly lead?: ReactNode;
  readonly title: ReactNode;
  /** Mono meta line: times, prices, IDs. */
  readonly meta?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
};

/** A compact row: lead, title over meta, one action on the right. */
export function ListRow({ lead, title, meta, action, className }: ListRowProps) {
  return (
    <div className={cn("flex items-center gap-2 py-1", className)}>
      {lead}
      <div className="min-w-0 flex-1">
        <div className="truncate text-fg-emph">{title}</div>
        {meta !== undefined && <div className="truncate font-mono text-meta text-fg-meta">{meta}</div>}
      </div>
      {action}
    </div>
  );
}

/** The warn dot for rows that need the user. Pair it with words in the row: never colour alone. */
export function NeedsYouDot() {
  return <span aria-hidden className="size-1.5 flex-none rounded-full bg-warn" />;
}

type MiniBarChartProps = {
  /** One bar per value; heights are relative to the largest. */
  readonly values: readonly number[];
  /** Read out instead of the bars, e.g. "Bookings per day, last 14 days". */
  readonly label: string;
  /** The bar for now (today), drawn at full strength; the others are slightly muted. */
  readonly current?: number;
  readonly className?: string;
};

/** CSS bars for widgets. Missing data is the caller's to say ("not available"), never a zero bar. */
export function MiniBarChart({ values, label, current, className }: MiniBarChartProps) {
  const max = Math.max(...values, 1);
  return (
    <div role="img" aria-label={label} className={cn("mt-1.5 flex h-12 items-end gap-1", className)}>
      {values.map((value, index) => (
        <div
          // Bars are positional: the index is the day.
          key={index}
          className={cn("flex-1 rounded-t-[2px] bg-chart-1", current !== undefined && index !== current && "opacity-80")}
          style={{ height: `${Math.max((value / max) * 100, 2)}%` }}
        />
      ))}
    </div>
  );
}
