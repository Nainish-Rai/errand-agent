import { describe, expect, it } from "vitest";

import type { ErrandDetails } from "../errand/errand";
import { selectContext } from "./context-selection";
import type { MemoryFact } from "./memory-fact";

const NOW = Date.parse("2026-11-04T09:00:00+05:30");
const DAY = 24 * 60 * 60 * 1_000;

function fact(overrides: Partial<MemoryFact> & Pick<MemoryFact, "id" | "key" | "value">): MemoryFact {
  return {
    ownerId: "me",
    source: "explicit",
    status: "active",
    evidence: { kind: "user_action", action: "seed" },
    validFromMs: NOW - DAY,
    ...overrides,
  };
}

const empty: ErrandDetails = { preferences: [] };

describe("context selection", () => {
  it("filters before it ranks: a forgotten, superseded or unconfirmed fact is out even when it would rank first", () => {
    // Each excluded fact would fill a missing detail, the highest rank there is; the included one only matches.
    const facts = [
      fact({ id: "forgotten", key: "budget", value: "900", status: "forgotten", validToMs: NOW - 1 }),
      fact({ id: "superseded", key: "area", value: "Koramangala", status: "superseded", validToMs: NOW - 1 }),
      fact({ id: "guess", key: "preferences", value: "mornings", source: "inferred", status: "pending_confirmation" }),
      fact({ id: "kept", key: "area", value: "HSR Layout" }),
    ];
    const selection = selectContext(facts, { ...empty, area: "HSR Layout" }, NOW);
    expect(selection.included.map(({ fact: { id }, reason }) => [id, reason])).toEqual([["kept", "matches_errand"]]);
    expect(selection.excluded.map(({ fact: { id }, reason }) => [id, reason])).toEqual([
      ["forgotten", "forgotten"],
      ["superseded", "superseded"],
      ["guess", "unconfirmed"],
    ]);
  });

  it("drops an active fact outside its validity window", () => {
    const later = fact({ id: "later", key: "area", value: "HSR Layout", validFromMs: NOW + DAY });
    const ended = fact({ id: "ended", key: "budget", value: "900", validToMs: NOW });
    expect(selectContext([later, ended], undefined, NOW).excluded.map(({ reason }) => reason)).toEqual(["outside_validity", "outside_validity"]);
  });

  it("the person's words for this errand win over a remembered value", () => {
    const selection = selectContext([fact({ id: "area", key: "area", value: "Koramangala" })], { ...empty, area: "HSR Layout" }, NOW);
    expect(selection.included).toEqual([]);
    expect(selection.excluded.map(({ reason }) => reason)).toEqual(["overridden_by_errand"]);
  });

  it("ranks facts that fill a missing detail first, then standing preferences, then ones the errand already says", () => {
    const facts = [
      fact({ id: "same-area", key: "area", value: "HSR Layout" }),
      fact({ id: "technician", key: "favourite_technician", value: "Ravi" }),
      fact({ id: "budget", key: "budget", value: "1500" }),
    ];
    const selection = selectContext(facts, { ...empty, area: "HSR Layout" }, NOW);
    expect(selection.included.map(({ fact: { id }, reason }) => [id, reason])).toEqual([
      ["budget", "fills_missing_detail"],
      ["technician", "standing_preference"],
      ["same-area", "matches_errand"],
    ]);
  });
});
