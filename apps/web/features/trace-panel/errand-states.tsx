"use client";

import type { GetSessionTraceResponse, TraceEventView } from "@errand/contracts";

// The errand's workflow as the trace recorded it: one row per state transition, oldest first,
// with the reason and when it happened relative to the first span of the run.

const REASON_LABELS: Readonly<Record<string, string>> = {
  errand_started: "errand started",
  search_started: "search started",
  options_found: "options found",
  no_options: "nothing fits",
  search_rejected: "search refused",
  details_changed: "details changed",
};

function stringAt(event: TraceEventView, key: string): string | undefined {
  const value = event.attributes[key];
  return typeof value === "string" ? value : undefined;
}

function label(state: string | undefined): string {
  return state === undefined ? "start" : state.replaceAll("_", " ");
}

export function ErrandStates({ trace }: { readonly trace: GetSessionTraceResponse }) {
  const transitions = trace.events.filter((event) => event.kind === "state_transition");
  if (transitions.length === 0) return null;
  const originMs = Math.min(...trace.spans.map((span) => span.startTimeMs), ...transitions.map((event) => event.timeMs));
  return (
    <section aria-label="Errand states" className="rounded-md border border-border bg-card p-3">
      <h2 className="mb-2 text-label font-semibold text-fg-emph">Errand states</h2>
      <ol className="flex flex-col gap-1">
        {transitions.map((event) => {
          const reason = stringAt(event, "errand.transition.reason");
          return (
            <li key={event.eventId} className="flex items-baseline justify-between gap-3 text-sm">
              <span>
                <span className="text-fg-meta">{label(stringAt(event, "errand.state.from"))}</span>
                {" → "}
                <span className="font-medium text-fg-emph">{label(stringAt(event, "errand.state.to"))}</span>
                {reason !== undefined && <span className="text-fg-meta"> · {REASON_LABELS[reason] ?? reason}</span>}
              </span>
              <span className="shrink-0 font-mono text-label text-fg-meta tabular-nums">
                {((event.timeMs - originMs) / 1000).toFixed(1)}s
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
