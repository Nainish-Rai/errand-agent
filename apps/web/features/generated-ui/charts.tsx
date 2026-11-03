"use client";

import { useAuiState } from "@assistant-ui/react";
import { bindPriceChart, bindSlotsPerDay, bindSpend, dayMessage, modelText, rupees } from "@errand/client";
import { BarChart, LineChart } from "@openuidev/react-ui";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/skeleton";

import { useAvailability, useGeneratedUiHost, useProviders, useSpend } from "./bound-data";

// Charts where they help a decision. The model names the providers (or how many months); every
// number drawn comes from the read-only API. Each chart also carries its values as a table for
// screen readers, which is what the browser checks read.

function ChartFrame({
  title,
  label,
  rows,
  children,
}: {
  readonly title: string;
  readonly label: string;
  readonly rows: readonly (readonly [string, string])[];
  readonly children: ReactNode;
}) {
  return (
    <figure aria-label={label} data-testid="generated-chart" className="my-3 flex flex-col gap-2 rounded-lg border border-edge bg-surface-card p-3">
      <figcaption className="text-label text-fg-meta">{title}</figcaption>
      {children}
      <table className="sr-only">
        <tbody>
          {rows.map(([name, value]) => (
            <tr key={name} data-testid="chart-row">
              <th scope="row">{name}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Pending({ what }: { readonly what: string }) {
  return (
    <div aria-busy aria-label={`Loading ${what}`} className="my-3 rounded-lg border border-edge bg-surface-card p-3">
      <Skeleton className="h-32" />
    </div>
  );
}

function Unavailable({ what }: { readonly what: string }) {
  return <p className="my-2 text-label text-fg-meta">The {what} isn't available right now.</p>;
}

export function PriceChart({ providerIds, title }: { readonly providerIds: readonly string[]; readonly title?: string }) {
  const providers = useProviders(providerIds);
  if (providers.status === "loading") return <Pending what="price chart" />;
  if (providers.status === "failed") return <Unavailable what="price chart" />;
  const bars = bindPriceChart(providerIds, providers.data);
  return (
    <ChartFrame title={modelText(title) ?? "Price per visit"} label="Price chart" rows={bars.map((bar) => [bar.name, rupees(bar.priceInr)])}>
      <BarChart data={bars.map((bar) => ({ name: bar.name, price: bar.priceInr }))} categoryKey="name" height={180} condensed legend={false} />
    </ChartFrame>
  );
}

export function SlotsPerDayChart({ providerIds, title }: { readonly providerIds: readonly string[]; readonly title?: string }) {
  const { send } = useGeneratedUiHost();
  const running = useAuiState((state) => state.thread.isRunning);
  const availability = useAvailability(providerIds);
  if (availability.status === "loading") return <Pending what="free slots chart" />;
  if (availability.status === "failed") return <Unavailable what="free slots chart" />;
  const days = bindSlotsPerDay(availability.data);
  return (
    <ChartFrame title={modelText(title) ?? "Free slots per day this week"} label="Free slots per day" rows={days.map((day) => [day.label, String(day.freeSlots)])}>
      <BarChart
        data={days.map((day) => ({ day: day.label, slots: day.freeSlots }))}
        categoryKey="day"
        height={180}
        condensed
        legend={false}
        onClick={(row) => {
          if (!running) void send(dayMessage(String(row.day)));
        }}
      />
      <div role="group" aria-label="Pick a day" className="flex flex-wrap gap-1">
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            disabled={running || day.freeSlots === 0}
            onClick={() => void send(dayMessage(day.label))}
            className="rounded-md border border-edge bg-surface-canvas px-2 py-0.5 text-label text-fg-body hover:border-edge-strong disabled:cursor-not-allowed disabled:opacity-45"
          >
            {day.label}
          </button>
        ))}
      </div>
    </ChartFrame>
  );
}

export function SpendChart({ months, title }: { readonly months: number; readonly title?: string }) {
  const spend = useSpend(months);
  if (spend.status === "loading") return <Pending what="spend chart" />;
  if (spend.status === "failed") return <Unavailable what="spend chart" />;
  const bars = bindSpend(spend.data);
  return (
    <ChartFrame
      title={modelText(title) ?? "Spend on home services"}
      label="Spend chart"
      rows={bars.map((bar) => [bar.label, `${rupees(bar.spendInr)}, ${bar.bookings} booking${bar.bookings === 1 ? "" : "s"}`])}
    >
      <LineChart data={bars.map((bar) => ({ month: bar.label, spend: bar.spendInr }))} categoryKey="month" height={180} condensed legend={false} variant="linear" />
    </ChartFrame>
  );
}
