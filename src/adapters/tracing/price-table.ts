import type { ModelCallCost, ModelCallUsage, ModelPricing, PricedModelCall } from "../../core/ports/model-pricing";
import prices from "./prices.json";

// Cost of one model call. A cost the provider reports wins: the Claude Code CLI reports
// `total_cost_usd`, which ai-sdk-provider-claude-code passes on as
// `providerMetadata["claude-code"].costUsd`, and AI Gateway reports one as `usage.costUsd`.
// Otherwise the versioned price table in prices.json gives the estimate.

interface Rates {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number | null;
  readonly cacheWrite: number | null;
}

interface ModelPrice extends Rates {
  readonly longContext?: Rates & { readonly aboveInputTokens: number };
}

export interface PriceTableFile {
  readonly version: string;
  readonly models: Readonly<Record<string, ModelPrice>>;
}

const PER_TOKEN = 1 / 1_000_000;

function count(tokens: number | undefined): number {
  return tokens !== undefined && Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The cost a provider put in its own metadata, e.g. `{ "claude-code": { costUsd: 0.0123 } }`. */
export function providerReportedCostUsd(providerMetadata: unknown): number | undefined {
  if (!isRecord(providerMetadata)) return undefined;
  for (const entry of Object.values(providerMetadata)) {
    if (!isRecord(entry)) continue;
    const cost = entry.costUsd;
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) return cost;
  }
  return undefined;
}

function ratesFor(price: ModelPrice, usage: ModelCallUsage): Rates {
  const longContext = price.longContext;
  return longContext !== undefined && count(usage.inputTokens) > longContext.aboveInputTokens ? longContext : price;
}

/** AI SDK input tokens include cached ones, so cache reads and writes are taken out first. */
function estimateUsd(rates: Rates, usage: ModelCallUsage): number {
  const cacheRead = count(usage.cacheReadTokens);
  const cacheWrite = count(usage.cacheWriteTokens);
  const uncached = Math.max(0, count(usage.inputTokens) - cacheRead - cacheWrite);
  const usd =
    uncached * rates.input +
    cacheRead * (rates.cacheRead ?? rates.input) +
    cacheWrite * (rates.cacheWrite ?? rates.input) +
    count(usage.outputTokens) * rates.output;
  return usd * PER_TOKEN;
}

export class PriceTable implements ModelPricing {
  readonly #table: PriceTableFile;

  constructor(table: PriceTableFile = prices) {
    this.#table = table;
  }

  get version(): string {
    return this.#table.version;
  }

  costOf(call: PricedModelCall): ModelCallCost | undefined {
    const reported = call.reportedCostUsd ?? providerReportedCostUsd(call.providerMetadata);
    if (reported !== undefined) return { usd: reported, source: "provider_reported" };
    const price = this.#table.models[call.modelId];
    if (price === undefined) return undefined;
    return { usd: estimateUsd(ratesFor(price, call.usage), call.usage), source: "price_table" };
  }
}
