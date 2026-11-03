import { describe, expect, it } from "vitest";

import { EVAL_CLOCK_START, evalMode, EvalModeError, isRecording, serverEnvironmentFor, trialsFor } from "./modes";

describe("eval modes", () => {
  it("runs offline by default and refuses an unknown mode", () => {
    expect(evalMode({})).toBe("offline");
    expect(() => evalMode({ ERRAND_EVAL_MODE: "dry-run" })).toThrow(EvalModeError);
  });

  it("gives the backend the scripted model offline and in replay, MiniMax live, keeping other roles", () => {
    expect(serverEnvironmentFor("offline", {}).ERRAND_MODELS).toBe("main=scripted,review_reader=scripted");
    expect(serverEnvironmentFor("replay", { ERRAND_MODELS: "main=minimax" }).ERRAND_MODELS).toBe("main=scripted,review_reader=scripted");
    expect(serverEnvironmentFor("offline", { ERRAND_MODELS: "review_reader=minimax" }).ERRAND_MODELS).toBe(
      "main=scripted,review_reader=minimax",
    );
    expect(serverEnvironmentFor("live", { ERRAND_MODELS: "main=scripted,review_reader=minimax" }).ERRAND_MODELS).toBe(
      "main=minimax,review_reader=minimax",
    );
  });

  it("pins the clock to the eval start unless one is given", () => {
    expect(serverEnvironmentFor("offline", {}).ERRAND_CLOCK_START).toBe(EVAL_CLOCK_START);
    expect(serverEnvironmentFor("live", { ERRAND_CLOCK_START: "2026-12-01T10:00:00+05:30" }).ERRAND_CLOCK_START).toBe(
      "2026-12-01T10:00:00+05:30",
    );
  });

  it("runs k trials only live, and records only live runs", () => {
    expect(trialsFor("offline", { ERRAND_EVAL_TRIALS: "5" })).toBe(1);
    expect(trialsFor("live", { ERRAND_EVAL_TRIALS: "2" })).toBe(2);
    expect(() => trialsFor("live", { ERRAND_EVAL_TRIALS: "0" })).toThrow(EvalModeError);
    expect(isRecording({ ERRAND_EVAL_MODE: "live", ERRAND_EVAL_RECORD: "1" })).toBe(true);
    expect(() => isRecording({ ERRAND_EVAL_RECORD: "1" })).toThrow(EvalModeError);
  });
});
