import { describe, expect, it } from "vitest";

import { renderEvalTable, type AttemptResult, type ModeResults } from "./eval-table";
import type { Invariant } from "./invariants";

const passed: AttemptResult = {
  verdict: "passed",
  actual: "1 turn; search_providers(plumber, Koramangala) → found (8 providers)",
  failures: [],
  pendingInvariants: ["typed-outcome"],
};

const failed: AttemptResult = {
  verdict: "failed",
  actual: "2 turns; search_providers(plumber, Koramangala) → found (8 providers)",
  costUsd: { agent: 0.002, simulatedUser: 0.03 },
  failures: ["calledTool(search_providers): expected 1 call, got 2"],
  pendingInvariants: ["typed-outcome"],
};

const scenario = { id: "scenarios/search/plumber", description: "Searches.", expected: "one search | 3 to 8 providers" };

const offline: ModeResults = {
  mode: "offline",
  ranAt: "2026-11-04T03:30:00.000Z",
  trials: 1,
  scenarios: [{ ...scenario, attempts: [passed] }],
};

const live: ModeResults = {
  mode: "live",
  ranAt: "2026-11-04T04:00:00.000Z",
  trials: 3,
  scenarios: [{ ...scenario, attempts: [{ ...passed, costUsd: { agent: 0.001, simulatedUser: 0.03 } }, passed, failed] }],
};

const invariants: readonly Invariant[] = [
  { id: "typed-outcome", statement: "Every run ends with a typed outcome", realIn: "08" },
  {
    id: "checked-one",
    statement: "A real one",
    realIn: "02",
    check: async () => ({ holds: true }),
  },
];

describe("the eval table", () => {
  const table = renderEvalTable({ offline, live }, invariants);

  it("has a row per scenario with expected, actual, pass/fail and notes, escaping pipes", () => {
    expect(table).toContain("| Scenario | Expected | Actual | Pass/fail | Notes |");
    expect(table).toContain(
      "| scenarios/search/plumber | one search \\| 3 to 8 providers | 1 turn; search_providers(plumber, Koramangala) → found (8 providers) | PASS | 1 invariants pending |",
    );
  });

  it("shows pass^1 and pass^k for live trials, with the failures and the cost", () => {
    expect(table).toContain("| Scenario | Expected | Actual (last trial) | Pass/fail | pass^1 | pass^k (k=3) | Notes |");
    // 2 of 3 passed: pass^1 = 2/3, pass^3 = C(2,3)/C(3,3) = 0.
    expect(table).toContain("| FAIL (2/3) | 0.67 | 0.00 |");
    expect(table).toContain("failed: calledTool(search_providers): expected 1 call, got 2");
    expect(table).toContain("cost $0.0630 (agent $0.0030, simulated user $0.0600)");
  });

  it("says when a mode hasn't run yet", () => {
    expect(table).toContain("## Replay");
    expect(table).toContain("Not run yet. Run `pnpm eval:replay`.");
  });

  it("lists every invariant, pending ones with the ticket that makes them real", () => {
    expect(table).toContain("| Every run ends with a typed outcome | pending until ticket 08 |");
    expect(table).toContain("| A real one | checked |");
  });

  it("marks a scenario whose every trial was skipped as SKIP with the reason", () => {
    const skipped = renderEvalTable(
      {
        replay: {
          mode: "replay",
          ranAt: "2026-11-04T05:00:00.000Z",
          trials: 1,
          scenarios: [
            { ...scenario, attempts: [{ verdict: "skipped", skipReason: "No recording yet.", failures: [], pendingInvariants: [] }] },
          ],
        },
      },
      invariants,
    );
    expect(skipped).toContain("| — | SKIP | skipped: No recording yet. |");
  });
});
