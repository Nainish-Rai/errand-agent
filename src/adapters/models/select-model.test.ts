import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL_SELECTION, ModelSelectionError, parseModelSelection } from "./select-model";

describe("ERRAND_MODELS", () => {
  it("uses MiniMax for the main role and Claude Code for tool-free roles by default", () => {
    expect(parseModelSelection(undefined)).toEqual(DEFAULT_MODEL_SELECTION);
    expect(DEFAULT_MODEL_SELECTION).toEqual({ main: "minimax", review_reader: "claude-code", user_simulator: "claude-code" });
  });

  it("overrides only the roles it names", () => {
    expect(parseModelSelection("main=scripted, review_reader=minimax")).toEqual({
      main: "scripted",
      review_reader: "minimax",
      user_simulator: "claude-code",
    });
  });

  it("refuses the Claude Code provider for a role that calls tools", () => {
    expect(() => parseModelSelection("main=claude-code")).toThrow(ModelSelectionError);
  });

  it("refuses unknown roles and providers", () => {
    expect(() => parseModelSelection("planner=minimax")).toThrow(/unknown role/);
    expect(() => parseModelSelection("main=gpt")).toThrow(/unknown provider/);
  });
});
