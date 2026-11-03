import type { TracePlace } from "../errand/errand-workflow";
import type { Clock } from "../ports/clock";
import type { ProviderDetails, ProviderWorld } from "../ports/provider-world";
import type { ReaderUsage, ReviewReader, ReviewReading } from "../ports/review-reader";
import type { TraceAttributes, TraceSink } from "../ports/trace-sink";
import {
  averageRatingOf,
  signalsFrom,
  type ProviderInsight,
  type ReaderName,
  type ReviewSignals,
} from "../review/provider-insight";

// Review insight for the providers the agent is comparing. Each provider's reviews go to the
// review reader on their own, so one provider's reviews can't speak about another. The readers
// are tried in order (Claude Code, then MiniMax); when none gives an answer that passes the
// schema gate, the outcome is `not_available`. There is no path that hands raw text onward.

export interface ProviderInsightDependencies {
  readonly world: ProviderWorld;
  /** In fallback order. Empty means review insight is switched off. */
  readonly readers: readonly ReviewReader[];
  readonly traceSink: TraceSink;
  /** Stamps the reader spans; the trace's wall clock. */
  readonly clock: Clock;
}

export type ProviderInsightOutcome =
  | { readonly kind: "insight"; readonly insight: ProviderInsight }
  /** Every reader failed or answered outside the schema. */
  | { readonly kind: "not_available"; readonly providerId: string; readonly tried: readonly ReaderName[] }
  | { readonly kind: "no_reviews"; readonly providerId: string }
  | { readonly kind: "provider_not_found"; readonly providerId: string };

type AttemptVerdict = "accepted" | "outside_schema" | "failed";

interface Attempt {
  readonly reader: ReviewReader;
  readonly provider: ProviderDetails;
  readonly index: number;
}

function usageAttributes(usage: ReaderUsage | undefined): Record<string, string | number> {
  if (usage === undefined) return {};
  const attributes: Record<string, string | number | undefined> = {
    "gen_ai.request.model": usage.modelId,
    "gen_ai.usage.input_tokens": usage.inputTokens,
    "gen_ai.usage.output_tokens": usage.outputTokens,
    "errand.cost.usd": usage.costUsd,
    "errand.cost.source": usage.costSource,
  };
  return Object.fromEntries(Object.entries(attributes).filter((entry): entry is [string, string | number] => entry[1] !== undefined));
}

/**
 * One reader call as a `chat` span under the tool call. It records who read, how many reviews,
 * the verdict, tokens and cost, and the signals that passed the gate: never the review text and
 * never the reader's raw answer.
 */
function readerSpan(
  attempt: Attempt,
  place: TracePlace,
  timing: { readonly startMs: number; readonly endMs: number },
  reading: ReviewReading,
  verdict: AttemptVerdict,
  signals: ReviewSignals | undefined,
) {
  const usage = reading.usage;
  const attributes: TraceAttributes = {
    "gen_ai.operation.name": "chat",
    "gen_ai.agent.name": "review_reader",
    "gen_ai.provider.name": attempt.reader.name,
    "errand.review_reader.provider_id": attempt.provider.id,
    "errand.review_reader.reviews": attempt.provider.reviews.length,
    "errand.review_reader.verdict": verdict,
    ...usageAttributes(usage),
    ...(signals === undefined ? {} : { "errand.review_reader.signals": { ...signals, strengths: [...signals.strengths], complaints: [...signals.complaints] } }),
  };
  return {
    type: "span" as const,
    traceId: place.traceId,
    spanId: `${place.spanId ?? place.sessionId}:review_reader:${attempt.provider.id}:${attempt.index}`,
    ...(place.spanId === undefined ? {} : { parentSpanId: place.spanId }),
    sessionId: place.sessionId,
    kind: "model" as const,
    name: `chat review_reader ${usage?.modelId ?? attempt.reader.name}`,
    status: verdict === "accepted" ? ("ok" as const) : ("error" as const),
    startTimeMs: timing.startMs,
    endTimeMs: timing.endMs,
    durationMs: timing.endMs - timing.startMs,
    attributes,
  };
}

async function read(
  deps: ProviderInsightDependencies,
  place: TracePlace,
  attempt: Attempt,
  signal: AbortSignal | undefined,
): Promise<ReviewSignals | undefined> {
  const startMs = deps.clock.now().getTime();
  const reviews = attempt.provider.reviews.map((review) => ({ rating: review.rating, text: review.text }));
  const reading = await attempt.reader.read(reviews, signal).catch(
    (error: unknown): ReviewReading => ({ kind: "failed", reason: error instanceof Error ? error.message : String(error) }),
  );
  const signals = reading.kind === "read" ? signalsFrom(reading.answer, reviews.length) : undefined;
  const verdict: AttemptVerdict = reading.kind === "failed" ? "failed" : signals === undefined ? "outside_schema" : "accepted";
  await deps.traceSink.record(readerSpan(attempt, place, { startMs, endMs: deps.clock.now().getTime() }, reading, verdict, signals));
  return signals;
}

async function insightFor(
  deps: ProviderInsightDependencies,
  place: TracePlace,
  providerId: string,
  signal: AbortSignal | undefined,
): Promise<ProviderInsightOutcome> {
  const found = await deps.world.getProvider(providerId);
  if (found.kind === "provider_not_found") return { kind: "provider_not_found", providerId };
  const { provider } = found;
  if (provider.reviews.length === 0) return { kind: "no_reviews", providerId };

  for (const [index, reader] of deps.readers.entries()) {
    const signals = await read(deps, place, { reader, provider, index }, signal);
    if (signals === undefined) continue;
    return {
      kind: "insight",
      insight: {
        ...signals,
        providerId: provider.id,
        providerName: provider.name,
        reviewsRead: provider.reviews.length,
        averageRating: averageRatingOf(provider.reviews.map((review) => review.rating)),
        readBy: reader.name,
      },
    };
  }
  return { kind: "not_available", providerId, tried: deps.readers.map((reader) => reader.name) };
}

/** Insight for each provider, in the order asked, each read on its own. */
export function getProviderInsights(
  deps: ProviderInsightDependencies,
  request: { readonly place: TracePlace; readonly providerIds: readonly string[]; readonly signal?: AbortSignal },
): Promise<ProviderInsightOutcome[]> {
  const unique = [...new Set(request.providerIds)];
  return Promise.all(unique.map((providerId) => insightFor(deps, request.place, providerId, request.signal)));
}
