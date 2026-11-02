import type { LanguageModel } from "ai";

import type { Clock } from "../core/ports/clock";
import type { ProviderWorld } from "../core/ports/provider-world";
import { createModel, parseModelSelection, type ModelRole } from "../adapters/models/select-model";
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

class Container {
  readonly clock: Clock = systemClock;
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
