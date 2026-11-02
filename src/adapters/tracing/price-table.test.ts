import { describe, expect, it } from "vitest";

import { PriceTable } from "./price-table";

describe("the cost of a model call", () => {
  const table = new PriceTable();

  it("estimates MiniMax-M3 from the price table: $0.30 in, $1.20 out per 1M tokens", () => {
    const cost = table.costOf({ modelId: "MiniMax-M3", usage: { inputTokens: 100_000, outputTokens: 100_000 } });
    expect(cost?.source).toBe("price_table");
    expect(cost?.usd).toBeCloseTo(0.03 + 0.12, 10);
  });

  it("prices cache reads at the cache rate, not the input rate", () => {
    const cost = table.costOf({
      modelId: "MiniMax-M3",
      usage: { inputTokens: 100_000, cacheReadTokens: 100_000, outputTokens: 0 },
    });
    expect(cost?.usd).toBeCloseTo(0.006, 10);
  });

  it("switches to the long-context tier above 512k input tokens", () => {
    const cost = table.costOf({ modelId: "MiniMax-M3", usage: { inputTokens: 600_000, outputTokens: 0 } });
    expect(cost?.usd).toBeCloseTo(0.36, 10);
  });

  it("records the cost the Claude Code CLI reports instead of estimating one", () => {
    // The shape ai-sdk-provider-claude-code gives the AI SDK from the CLI's total_cost_usd.
    const providerMetadata = { "claude-code": { sessionId: "abc", costUsd: 0.0123, durationMs: 4200 } };
    expect(table.costOf({ modelId: "haiku", usage: { inputTokens: 10, outputTokens: 10 }, providerMetadata })).toEqual({
      usd: 0.0123,
      source: "provider_reported",
    });
  });

  it("says nothing for a model it has no price for and no reported cost", () => {
    expect(table.costOf({ modelId: "unknown-model", usage: { inputTokens: 100 } })).toBeUndefined();
  });
});
