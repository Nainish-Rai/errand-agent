import type { GetProviderInsightOutput, ProviderInsightResult } from "@errand/contracts";

import type { ProviderInsightOutcome } from "../../src/core/use-cases/get-provider-insight";

// Core's insight outcomes to the tool's wire shape. Every field is copied by name, so nothing the
// core value might carry beyond the schema can reach the main agent.

function presentOutcome(outcome: ProviderInsightOutcome): ProviderInsightResult {
  switch (outcome.kind) {
    case "insight": {
      const { insight } = outcome;
      return {
        kind: "insight",
        insight: {
          providerId: insight.providerId,
          providerName: insight.providerName,
          reviewsRead: insight.reviewsRead,
          averageRating: insight.averageRating,
          sentiment: insight.sentiment,
          strengths: [...insight.strengths],
          complaints: [...insight.complaints],
          reviewsWithInstructions: insight.reviewsWithInstructions,
          readBy: insight.readBy,
        },
      };
    }
    case "not_available":
    case "no_reviews":
    case "provider_not_found":
      return { kind: outcome.kind, providerId: outcome.providerId };
  }
}

export function presentInsights(outcomes: readonly ProviderInsightOutcome[]): GetProviderInsightOutput {
  return { insights: outcomes.map(presentOutcome) };
}
