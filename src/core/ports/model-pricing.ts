export interface ModelCallUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export interface PricedModelCall {
  readonly modelId: string;
  readonly usage: ModelCallUsage;
  /** A cost the provider itself reported for the call, in US dollars. */
  readonly reportedCostUsd?: number;
  /** The provider's raw metadata for the call, which may carry the provider's own cost. */
  readonly providerMetadata?: unknown;
}

/**
 * `provider_reported` is what the provider (for example the Claude Code CLI) said the call cost;
 * `price_table` is our estimate from the versioned price table.
 */
export interface ModelCallCost {
  readonly usd: number;
  readonly source: "provider_reported" | "price_table";
}

export interface ModelPricing {
  /** Undefined when neither the provider nor the price table can say what the call cost. */
  costOf(call: PricedModelCall): ModelCallCost | undefined;
}
