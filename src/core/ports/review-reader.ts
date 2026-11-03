import type { ReaderName } from "../review/provider-insight";
import type { ModelCallCost } from "./model-pricing";

// A model with no tools that reads a provider's raw reviews and answers in the insight schema.
// Core never trusts the answer: it goes through `signalsFrom` before anything uses it.

/** One review as the reader gets it: the star rating and the untrusted text, nothing else. */
export interface ReviewToRead {
  readonly rating: number;
  readonly text: string;
}

export interface ReaderUsage {
  readonly modelId: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
  readonly costSource?: ModelCallCost["source"];
}

export type ReviewReading =
  /** The reader answered. `answer` is whatever it produced, unchecked. */
  | { readonly kind: "read"; readonly answer: unknown; readonly usage: ReaderUsage }
  /** The reader failed: an error, a timeout or an answer that isn't JSON. */
  | { readonly kind: "failed"; readonly reason: string; readonly usage?: ReaderUsage };

export interface ReviewReader {
  readonly name: ReaderName;
  read(reviews: readonly ReviewToRead[], signal?: AbortSignal): Promise<ReviewReading>;
}
