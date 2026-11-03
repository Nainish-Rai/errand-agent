"use client";

import { useAuiState } from "@assistant-ui/react";
import { useState } from "react";

import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { InsightCard } from "@/features/chat/provider-insight";

import { useGeneratedUiHost, useMemory, useReviewInsight } from "./bound-data";

// The review-insight card and the inferred-preference card, bound by id. A review insight is the one
// get_provider_insight returned in this conversation (core's closed sets and numbers; no review text
// can reach it). A preference card names inferred facts that wait for the person's confirmation and
// reads them from GET /memory; Keep and Don't keep only send the person's answer as a message, so
// the agent confirms through confirm_fact with the person's own words as evidence.

export function ReviewInsight({ providerId }: { readonly providerId: string }) {
  const { insight, shownInReply } = useReviewInsight(providerId);
  // This reply's get_provider_insight already shows it: don't show it twice.
  if (shownInReply) return null;
  if (insight === undefined) return <p className="my-2 text-xs text-fg-3">No review insight for this provider yet.</p>;
  return (
    <ul data-testid="review-insight" className="my-3 flex list-none flex-col gap-2 p-0">
      <InsightCard insight={insight} />
    </ul>
  );
}

export function PreferenceCard({ factIds }: { readonly factIds: readonly string[] }) {
  const { send } = useGeneratedUiHost();
  const running = useAuiState((state) => state.thread.isRunning);
  const memory = useMemory();
  const [answered, setAnswered] = useState<Readonly<Record<string, "kept" | "dismissed">>>({});

  if (memory.status === "loading") return <Skeleton className="my-3 h-16" />;
  if (memory.status === "failed") return <p className="my-2 text-xs text-fg-3">Can't read your saved details right now.</p>;
  const facts = memory.data.facts.filter((fact) => factIds.includes(fact.id) && fact.source === "inferred" && fact.status === "pending_confirmation");
  if (facts.length === 0) return null;

  const answer = (factId: string, kept: boolean, text: string) => {
    setAnswered((before) => ({ ...before, [factId]: kept ? "kept" : "dismissed" }));
    void send(text);
  };
  return (
    <section aria-label="Remember these?" data-testid="preference-card" className="my-3 flex flex-col gap-2 rounded-panel border border-line bg-surface p-3">
      <p className="m-0 text-sm font-medium text-fg">Remember these for next time?</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {facts.map((fact) => (
          <li key={fact.id} className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-sm text-fg">
                {fact.label}: {fact.display}
              </span>
              {fact.evidence.kind === "user_message" && <span className="text-xs text-fg-3">From what you said: “{fact.evidence.quote}”</span>}
            </div>
            {answered[fact.id] === undefined ? (
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" disabled={running} onClick={() => answer(fact.id, true, `Yes, remember ${fact.label.toLowerCase()} ${fact.display}.`)}>
                  Keep
                </Button>
                <Button size="sm" variant="ghost" disabled={running} onClick={() => answer(fact.id, false, `No, don't remember ${fact.label.toLowerCase()} ${fact.display}.`)}>
                  Don&apos;t keep
                </Button>
              </div>
            ) : (
              <span className="text-xs text-fg-3">{answered[fact.id] === "kept" ? "Kept" : "Not kept"}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
