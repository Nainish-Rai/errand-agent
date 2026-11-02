import path from "node:path";

import type { LanguageModel } from "ai";

import type { Clock } from "../core/ports/clock";
import type { ErrandStore } from "../core/ports/errand-store";
import type { ServiceCatalog } from "../core/ports/service-catalog";
import type { ErrandDependencies } from "../core/use-cases/errand-session";
import type { ModelPricing } from "../core/ports/model-pricing";
import type { ProviderWorld } from "../core/ports/provider-world";
import type { TraceSink } from "../core/ports/trace-sink";
import { clockStartingAt } from "../adapters/clock/clock-starting-at";
import { InMemoryErrandStore } from "../adapters/memory/in-memory-errand-store";
import { ModelScriptPlayer } from "../adapters/models/scripted";
import { createModel, parseModelSelection, type ModelRole } from "../adapters/models/select-model";
import { JsonlTraceSink } from "../adapters/tracing/jsonl-trace-sink";
import { PriceTable } from "../adapters/tracing/price-table";
import { Sanitizer } from "../adapters/tracing/sanitize";
import { MockProviderWorld } from "../adapters/world/mock-provider-world";
import { scenarioNamed, type ScenarioName } from "../adapters/world/scenarios/scenarios";
import { worldCatalog } from "../adapters/world/world-catalog";

// Main: the only place that constructs adapters. The agent and its channels ask this module for
// use-case dependencies and never import an adapter themselves.

export const DEFAULT_WORLD_SEED = 42;

const systemClock: Clock = { now: () => new Date() };

/** ERRAND_CLOCK_START pins the process's start date (evals use it); unset, the clock is the system's. */
function processClock(): { readonly clock: Clock; readonly isPinned: boolean } {
  const start = process.env.ERRAND_CLOCK_START;
  if (start === undefined || start.trim() === "") return { clock: systemClock, isPinned: false };
  return { clock: clockStartingAt(start, systemClock), isPinned: true };
}

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
  readonly clock: Clock;
  /** True when ERRAND_CLOCK_START set the clock, so sessions read it instead of their own time. */
  readonly isClockPinned: boolean;
  /** The offline model's script, loaded per scenario through the dev-only model-script route. */
  readonly modelScript = new ModelScriptPlayer();
  readonly traceSink: TraceSink = new JsonlTraceSink({
    directory: traceDirectory(),
    sanitizer: new Sanitizer({ secrets: runtimeSecrets() }),
  });
  readonly modelPricing: ModelPricing = new PriceTable();
  readonly errands: ErrandStore = new InMemoryErrandStore();
  readonly catalog: ServiceCatalog = worldCatalog;
  #world: MockProviderWorld;
  #settings: WorldSettings;

  constructor(settings: WorldSettings) {
    ({ clock: this.clock, isPinned: this.isClockPinned } = processClock());
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

  /**
   * What the errand use cases need. Transitions are stamped with the system clock, the one the
   * trace's spans use, so a pinned eval clock can't put them hours away from the spans around them.
   */
  get errandDependencies(): ErrandDependencies & { readonly world: ProviderWorld } {
    return { errands: this.errands, catalog: this.catalog, traceSink: this.traceSink, clock: systemClock, world: this.world };
  }

  modelFor(role: ModelRole): LanguageModel {
    const selection = parseModelSelection(process.env.ERRAND_MODELS);
    return createModel(selection[role], { minimaxApiKey: process.env.MINIMAX_API_KEY, scriptPlayer: this.modelScript });
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
