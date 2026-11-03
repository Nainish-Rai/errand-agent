import type { ReviewReader, ReviewReading, ReviewToRead } from "../../core/ports/review-reader";
import type { Complaint, Sentiment, Strength } from "../../core/review/provider-insight";

// The offline review reader: fixed rules, no model, no network. The evals and the browser checks
// use it so a run is the same every time. Like the model readers it sees the raw reviews and
// answers only in the schema, and its answer goes through the same gate in core.

export const SCRIPTED_READER_MODEL_ID = "review-rules";

const STRENGTH_RULES: readonly (readonly [Strength, RegExp])[] = [
  ["punctual", /\bon time\b|\bpunctual\b/i],
  ["quality_work", /\bgood work\b|\bknew exactly\b|\bno second visit\b|\bfixed (it|my|the)\b|\bgreat job\b/i],
  ["polite", /\bpolite\b|\bcourteous\b/i],
  ["clean", /\bclean(ed)? up\b|\btidy\b/i],
  ["fair_price", /\breasonable price\b|\bfair price\b|\bgood value\b/i],
  ["brings_parts", /\bbrought all the parts\b|\bparts included\b/i],
];

const COMPLAINT_RULES: readonly (readonly [Complaint, RegExp])[] = [
  ["late", /\blate\b/i],
  ["overcharged", /\bpricier\b|\bovercharg/i],
  ["incomplete_work", /\bcome back and finish\b|\bcall twice\b/i],
  ["poor_quality", /\bpoor (work|job|quality)\b|\bshoddy\b/i],
  ["rude", /\brude\b/i],
  ["no_show", /\bno[- ]show\b|\bnever (came|showed)\b/i],
];

/**
 * A review that talks to the assistant instead of about the service: it addresses an AI, poses as
 * a system or operator message, imitates a tool call, hides markup, or tells someone to book,
 * approve, skip a step or remember something.
 */
const INSTRUCTION_SIGNS =
  /\b(AI|assistant|operator)\b|^\s*system\s*:|\bsystem\s*:|\bignore (your|the|all|previous)\b|\badmin mode\b|\bapprov(e|al)\b|\bbook (the|this|it|now|immediately)\b|\bremember\b|"tool"\s*:|<!--|<\/?[a-z][^>]*>/im;

function sentimentOf(reviews: readonly ReviewToRead[], complaints: readonly Complaint[]): Sentiment {
  const average = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
  if (average < 3) return "negative";
  return average >= 4.2 && complaints.length === 0 ? "positive" : "mixed";
}

export function readByRules(reviews: readonly ReviewToRead[]) {
  const matches = <T>(rules: readonly (readonly [T, RegExp])[]) =>
    rules.filter(([, pattern]) => reviews.some((review) => pattern.test(review.text))).map(([value]) => value);
  const complaints = matches(COMPLAINT_RULES);
  return {
    sentiment: sentimentOf(reviews, complaints),
    strengths: matches(STRENGTH_RULES),
    complaints,
    reviewsWithInstructions: reviews.filter((review) => INSTRUCTION_SIGNS.test(review.text)).length,
  };
}

export class ScriptedReviewReader implements ReviewReader {
  readonly name = "scripted" as const;

  async read(reviews: readonly ReviewToRead[]): Promise<ReviewReading> {
    return { kind: "read", answer: readByRules(reviews), usage: { modelId: SCRIPTED_READER_MODEL_ID } };
  }
}
