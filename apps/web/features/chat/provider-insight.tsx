"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  GetProviderInsightOutputSchema,
  type Complaint,
  type ProviderInsightResult,
  type ProviderInsightView,
  type ReaderNameView,
  type Sentiment,
  type Strength,
} from "@errand/contracts";
import { Star } from "lucide-react";

import { StatusMark } from "@/components/status-mark";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

// get_provider_insight as short cards: strengths and red flags, drawn only from the tool's schema
// output (closed sets and numbers). Every word on the card comes from the labels below, never from
// a review, so no review text can reach the screen through here.

const SENTIMENT_LABELS: Readonly<Record<Sentiment, string>> = {
  positive: "Mostly positive",
  mixed: "Mixed",
  negative: "Mostly negative",
};

const STRENGTH_LABELS: Readonly<Record<Strength, string>> = {
  punctual: "On time",
  quality_work: "Good work",
  polite: "Polite",
  clean: "Cleans up",
  fair_price: "Fair price",
  brings_parts: "Brings parts",
};

const COMPLAINT_LABELS: Readonly<Record<Complaint, string>> = {
  late: "Late",
  overcharged: "Overcharged",
  incomplete_work: "Unfinished work",
  poor_quality: "Poor work",
  rude: "Rude",
  no_show: "No-show",
};

const READER_LABELS: Readonly<Record<ReaderNameView, string>> = {
  "claude-code": "Claude Code",
  minimax: "MiniMax",
  scripted: "the offline reader",
};

const UNREADABLE_LABELS: Readonly<Record<Exclude<ProviderInsightResult["kind"], "insight">, string>> = {
  not_available: "Review insight not available right now",
  no_reviews: "No reviews yet",
  provider_not_found: "Provider not found",
};

function TagList({ label, items }: { readonly label: string; readonly items: readonly string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      <span className="text-label text-fg-meta">{label}</span>
      {items.length === 0 ? (
        <span className="text-label text-fg-meta">none reported</span>
      ) : (
        items.map((item) => (
          <Badge key={item} variant={label === "Strengths" ? "verified" : "tag"}>
            {item}
          </Badge>
        ))
      )}
    </div>
  );
}

function InsightCard({ insight }: { readonly insight: ProviderInsightView }) {
  const flagged = insight.reviewsWithInstructions;
  return (
    <li>
      <section
        aria-label={`Review insight for ${insight.providerName}`}
        className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-medium">{insight.providerName}</span>
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
            <Star aria-hidden className="size-3.5" />
            {insight.averageRating.toFixed(1)} from {insight.reviewsRead} reviews · {SENTIMENT_LABELS[insight.sentiment]}
          </span>
        </div>
        <TagList label="Strengths" items={insight.strengths.map((strength) => STRENGTH_LABELS[strength])} />
        <TagList label="Red flags" items={insight.complaints.map((complaint) => COMPLAINT_LABELS[complaint])} />
        {flagged > 0 && (
          <StatusMark
            kind="needs-you"
            label={`${flagged} review${flagged === 1 ? "" : "s"} tried to instruct the assistant and ${flagged === 1 ? "was" : "were"} ignored`}
          />
        )}
        <p className="text-label text-fg-meta">Read by {READER_LABELS[insight.readBy]}; review text is never shown to the agent.</p>
      </section>
    </li>
  );
}

function ResultRow({ result }: { readonly result: ProviderInsightResult }) {
  if (result.kind === "insight") return <InsightCard insight={result.insight} />;
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
      {UNREADABLE_LABELS[result.kind]} ({result.providerId})
    </li>
  );
}

export const ProviderInsight: ToolCallMessagePartComponent = ({ result, status }) => {
  if (result === undefined) {
    return (
      <div className="my-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Reading reviews…
      </div>
    );
  }
  const parsed = GetProviderInsightOutputSchema.safeParse(result);
  if (!parsed.success || status.type === "incomplete") {
    return <p className="my-2 text-sm text-muted-foreground">Review insight not available.</p>;
  }
  return (
    <section aria-label="Review insight" className="my-3 flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">What reviews say</p>
      <ul className="flex flex-col gap-2">
        {parsed.data.insights.map((insight) => (
          <ResultRow key={insight.kind === "insight" ? insight.insight.providerId : insight.providerId} result={insight} />
        ))}
      </ul>
    </section>
  );
};
