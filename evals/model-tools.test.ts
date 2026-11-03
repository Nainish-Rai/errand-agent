import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The model's tools are the files in agent/tools (eve names each tool after its file). The model
// must never reach a side effect directly: no tool is book, cancel or reschedule, and no tool's
// source calls the world's book. It books only through execute_proposal, which needs a grant.

const TOOLS = path.resolve(import.meta.dirname, "..", "agent", "tools");
const toolFiles = readdirSync(TOOLS).filter((file) => file.endsWith(".ts"));

describe("the model's tools", () => {
  it("include no direct book, cancel or reschedule", () => {
    const names = toolFiles.map((file) => file.replace(/\.ts$/, ""));
    expect(names).toContain("execute_proposal");
    for (const forbidden of ["book", "cancel", "reschedule", "approve", "approve_proposal"]) expect(names).not.toContain(forbidden);
  });

  it("never call the world's book or the approval use case", () => {
    for (const file of toolFiles) {
      const source = readFileSync(path.join(TOOLS, file), "utf8");
      expect(source, file).not.toMatch(/\.book\(/);
      expect(source, file).not.toMatch(/approve-proposal|approveProposal/);
    }
  });
});
