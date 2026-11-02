import path from "node:path";

import type { LanguageModel } from "ai";

import type { Clock } from "../core/ports/clock";
import type { ModelPricing } from "../core/ports/model-pricing";
import type { ProviderWorld } from "../core/ports/provider-world";
import type { TraceSink } from "../core/ports/trace-sink";
import { createModel, parseModelSelection, type ModelRole } from "../adapters/models/select-model";
import { JsonlTraceSink } from "../adapters/tracing/jsonl-trace-sink";
import { PriceTable } from "../adapters/tracing/price-table";
import { Sanitizer } from "../adapters/tracing/sanitize";
import { MockProviderWorld } from "../adapters/world/mock-provider-world";
import { scenarioNamed, type ScenarioName } from "../adapters/world/scenarios/scenarios";

// Main: the only place that constructs adapters. The agent and its channels ask this module for
// use-case dependencies and never import an adapter themselves.

export const DEFAULT_WORLD_SEED = 42;

const systemClock: Clock = { now: () => new Date() };

export interface WorldSettings {
  readonly scenario: ScenarioName;
  readonly seed: number;
}

/** Traces go to `traces/` at the repo root unless ERRAND_TRACE_DIR says otherwise; keep both out of git. */
function traceDirectory(): string {
  return path.resolve(process.env.ERRAND_TRACE_DIR ?? path.join(process.cwd(), "traces"));
}

/** Every secret the process holds, so the sanitiser removes them from traces by value. */
function runtimeSecrets(): (string | undefined)[] {
  return [process.env.MINIMAX_API_KEY, process.env.ANTHROPIC_API_KEY];
}

class Container {
  readonly clock: Clock = systemClock;
  readonly traceSink: TraceSink = new JsonlTraceSink({
    directory: traceDirectory(),
    sanitizer: new Sanitizer({ secrets: runtimeSecrets() }),
  });
  readonly modelPricing: ModelPricing = new PriceTable();
  #world: MockProviderWorld;
  #settings: WorldSettings;

  constructor(settings: WorldSettings) {
    this.#settings = settings;
    this.#world = this.#buildWorld(settings);
  }

  get world(): ProviderWorld {
    return this.#world;
  }

  get worldSettings(): WorldSettings {
    return this.#settings;
  }

  /** Dev only: replace the world with a freshly seeded one for the named scenario. */
  switchScenario(settings: WorldSettings): WorldSettings {
    this.#settings = settings;
    this.#world = this.#buildWorld(settings);
    return settings;
  }

  modelFor(role: ModelRole): LanguageModel {
    const selection = parseModelSelection(process.env.ERRAND_MODELS);
    return createModel(selection[role], { minimaxApiKey: process.env.MINIMAX_API_KEY });
  }

  #buildWorld(settings: WorldSettings): MockProviderWorld {
    return new MockProviderWorld({ seed: settings.seed, scenario: scenarioNamed(settings.scenario), clock: this.clock });
  }
}

// One instance per process: the tools and the app API channel must read the same world, so the
// dev scenario switch reaches the tools.
let instance: Container | undefined;

export function container(): Container {
  instance ??= new Container({ scenario: "default", seed: DEFAULT_WORLD_SEED });
  return instance;
}
