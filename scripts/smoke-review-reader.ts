// Runs the review reader on the whole injection campaign, one live call per provider-sized batch,
// and prints only what passed the schema gate. `pnpm smoke:review-reader` uses the Claude Code CLI
// (local `claude` login); `-- minimax` uses MiniMax (MINIMAX_API_KEY).
import { ModelReviewReader } from "../src/adapters/review-reader/model-review-reader";
import { CLAUDE_CODE_MODEL_ID, createClaudeCodeReaderModel } from "../src/adapters/models/claude-code";
import { createMinimaxModel, MINIMAX_MODEL_ID } from "../src/adapters/models/minimax";
import { PriceTable } from "../src/adapters/tracing/price-table";
import { INJECTION_CAMPAIGN, REVIEW_TEXTS } from "../src/adapters/world/seed/catalog";
import { signalsFrom } from "../src/core/review/provider-insight";

const useMinimax = process.argv.includes("minimax");
const reader = new ModelReviewReader(
  useMinimax
    ? { name: "minimax", model: () => createMinimaxModel(process.env.MINIMAX_API_KEY), modelId: MINIMAX_MODEL_ID, pricing: new PriceTable() }
    : { name: "claude-code", model: () => createClaudeCodeReaderModel(), modelId: CLAUDE_CODE_MODEL_ID, pricing: new PriceTable() },
);

// Two ordinary reviews and one attack per batch, like a seeded provider in the review_injection world.
let missed = 0;
let costUsd = 0;
for (const variant of INJECTION_CAMPAIGN) {
  const reviews = [REVIEW_TEXTS[0], REVIEW_TEXTS[3], variant].map((review) => ({ rating: review?.rating ?? 5, text: review?.text ?? "" }));
  const startedAt = Date.now();
  const reading = await reader.read(reviews);
  const signals = reading.kind === "read" ? signalsFrom(reading.answer, reviews.length) : undefined;
  costUsd += reading.usage?.costUsd ?? 0;
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`${variant.id} (${seconds}s): ${reading.kind === "failed" ? `failed: ${reading.reason}` : JSON.stringify(signals ?? "outside the schema")}`);
  if (signals === undefined || signals.reviewsWithInstructions < 1) missed += 1;
}
console.log(`reader: ${reader.name}; flagged ${INJECTION_CAMPAIGN.length - missed}/${INJECTION_CAMPAIGN.length}; cost $${costUsd.toFixed(4)}`);
if (missed > 0) process.exit(1);
