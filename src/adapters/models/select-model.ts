import type { LanguageModel } from "ai";

import { createClaudeCodeModel } from "./claude-code";
import { createMinimaxModel } from "./minimax";
import { createScriptedModel } from "./scripted";

// One setting, ERRAND_MODELS, picks the provider for each model role, for example
// `ERRAND_MODELS=main=scripted` or `ERRAND_MODELS=main=minimax,review_reader=minimax`.
// Roles left out keep their default.

export type ModelRole = "main" | "review_reader" | "user_simulator";
export type ModelProviderName = "minimax" | "claude-code" | "scripted";

const ROLES: readonly ModelRole[] = ["main", "review_reader", "user_simulator"];
const PROVIDERS: readonly ModelProviderName[] = ["minimax", "claude-code", "scripted"];

/** Roles whose model must call tools. The Claude Code provider can't, so it never serves them. */
const TOOL_ROLES: ReadonlySet<ModelRole> = new Set(["main"]);

export const DEFAULT_MODEL_SELECTION: Readonly<Record<ModelRole, ModelProviderName>> = {
  main: "minimax",
  review_reader: "claude-code",
  user_simulator: "claude-code",
};

export class ModelSelectionError extends Error {
  constructor(message: string) {
    super(`ERRAND_MODELS: ${message}`);
    this.name = "ModelSelectionError";
  }
}

function isRole(value: string): value is ModelRole {
  return (ROLES as readonly string[]).includes(value);
}

function isProvider(value: string): value is ModelProviderName {
  return (PROVIDERS as readonly string[]).includes(value);
}

export function parseModelSelection(setting: string | undefined): Record<ModelRole, ModelProviderName> {
  const selection = { ...DEFAULT_MODEL_SELECTION };
  for (const entry of (setting ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const [role = "", provider = ""] = entry.split("=").map((part) => part.trim());
    if (!isRole(role)) throw new ModelSelectionError(`unknown role "${role}" (roles: ${ROLES.join(", ")}).`);
    if (!isProvider(provider)) {
      throw new ModelSelectionError(`unknown provider "${provider}" (providers: ${PROVIDERS.join(", ")}).`);
    }
    if (TOOL_ROLES.has(role) && provider === "claude-code") {
      throw new ModelSelectionError(`role "${role}" calls tools, and the claude-code provider can't.`);
    }
    selection[role] = provider;
  }
  return selection;
}

export interface ModelEnvironment {
  readonly minimaxApiKey: string | undefined;
}

export function createModel(provider: ModelProviderName, environment: ModelEnvironment): LanguageModel {
  switch (provider) {
    case "minimax":
      return createMinimaxModel(environment.minimaxApiKey);
    case "claude-code":
      return createClaudeCodeModel();
    case "scripted":
      return createScriptedModel();
  }
}
