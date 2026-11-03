// What the review reader may say about a provider's reviews, and the gate its answer passes
// through. The reader reads untrusted text, so its answer is untrusted too: only values from these
// closed sets, booleans and bounded counts survive, and nothing it writes as free text can reach
// the main agent. This is the quarantine half of the dual-LLM pattern (CaMeL): the model that
// reads the text has no tools, and the model that has tools never reads the text.

export const SENTIMENTS = ["positive", "mixed", "negative"] as const;
export const STRENGTHS = ["punctual", "quality_work", "polite", "clean", "fair_price", "brings_parts"] as const;
export const COMPLAINTS = ["late", "overcharged", "incomplete_work", "poor_quality", "rude", "no_show"] as const;
/** Who read the reviews. `scripted` is the offline, rule-based reader. */
export const READER_NAMES = ["claude-code", "minimax", "scripted"] as const;

export type Sentiment = (typeof SENTIMENTS)[number];
export type Strength = (typeof STRENGTHS)[number];
export type Complaint = (typeof COMPLAINTS)[number];
export type ReaderName = (typeof READER_NAMES)[number];

/** The reader's whole answer after the gate. */
export interface ReviewSignals {
  readonly sentiment: Sentiment;
  readonly strengths: readonly Strength[];
  readonly complaints: readonly Complaint[];
  /** Reviews that address the assistant or try to give it instructions. */
  readonly reviewsWithInstructions: number;
}

export interface ProviderInsight extends ReviewSignals {
  readonly providerId: string;
  /** From the world, not the reader. */
  readonly providerName: string;
  readonly reviewsRead: number;
  /** The mean of the reviews' star ratings, computed in code, one decimal. */
  readonly averageRating: number;
  readonly readBy: ReaderName;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Keeps the known values of a list, once each, in schema order; drops everything else. */
function knownValues<T extends string>(values: readonly T[], raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  return values.filter((value) => raw.includes(value));
}

/**
 * The gate. Returns the signals the answer holds, or undefined when its one required value (the
 * sentiment) is missing or unknown, or the instruction count isn't a count of the reviews read.
 * Unknown fields, unknown list entries and every string outside the closed sets are dropped.
 */
export function signalsFrom(answer: unknown, reviewsRead: number): ReviewSignals | undefined {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return undefined;
  const fields = answer as Readonly<Record<string, unknown>>;
  if (!isOneOf(SENTIMENTS, fields.sentiment)) return undefined;
  const flagged = fields.reviewsWithInstructions;
  if (typeof flagged !== "number" || !Number.isInteger(flagged) || flagged < 0 || flagged > reviewsRead) return undefined;
  return {
    sentiment: fields.sentiment,
    strengths: knownValues(STRENGTHS, fields.strengths),
    complaints: knownValues(COMPLAINTS, fields.complaints),
    reviewsWithInstructions: flagged,
  };
}

/** The mean star rating, one decimal; ratings are the world's structured field, never the text. */
export function averageRatingOf(ratings: readonly number[]): number {
  if (ratings.length === 0) return 0;
  return Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10;
}
