import path from "node:path";

import type { LanguageModel } from "ai";

import { CONTEXT_BUDGET } from "../core/context/context-budget";
import { DEFAULT_RUN_LIMITS, type RunExit, type RunKey, type RunLimits } from "../core/budget/run-budget";
import type { RunOutcome } from "../core/budget/outcome";
import type { ActionLedger } from "../core/ports/action-ledger";
import type { Clock } from "../core/ports/clock";
import type { ErrandStore } from "../core/ports/errand-store";
import type { ProposalStore } from "../core/ports/proposal-store";
import type { MemoryStore } from "../core/ports/memory-store";
import type { ServiceCatalog } from "../core/ports/service-catalog";
import type { ModelContextDependencies } from "../core/use-cases/build-model-context";
import type { DraftErrandDependencies } from "../core/use-cases/draft-errand";
import type { HomeSummaryDependencies } from "../core/use-cases/get-home-summary";
import type { AlertFeed } from "../core/ports/alert-feed";
import type { ErrandDependencies } from "../core/use-cases/errand-session";
import type { GeneratedUiDependencies } from "../core/use-cases/generated-ui-session";
import type { ProviderPhotoFiles } from "../core/ports/provider-photo-files";
import type { ProposalDependencies } from "../core/use-cases/proposal-session";
import type { MemoryDependencies } from "../core/use-cases/memory-session";
import type { ModelPricing } from "../core/ports/model-pricing";
import type { ProviderWorld } from "../core/ports/provider-world";
import type { RunBudgetStore } from "../core/ports/run-budget-store";
import type { TraceSink } from "../core/ports/trace-sink";
import { admitToolCalls } from "../core/use-cases/admit-tool-calls";
import { recordModelContext } from "../core/use-cases/record-model-context";
import { recordModelFailure } from "../core/use-cases/record-model-failure";
import type { BookingDependencies } from "../core/use-cases/book-approved-proposal";
import type { RunBudgetDependencies } from "../core/use-cases/run-budget-session";
import type { SettleRunDependencies } from "../core/use-cases/settle-run";
import { startModelTurn } from "../core/use-cases/start-model-turn";
import type { ReviewReader } from "../core/ports/review-reader";
import type { ProviderInsightDependencies } from "../core/use-cases/get-provider-insight";
import { clockStartingAt } from "../adapters/clock/clock-starting-at";
import { randomIds, sha256Hasher } from "../adapters/crypto/node-crypto";
import { databasePath, openDatabase, type Database } from "../adapters/sqlite/database";
import { InMemoryErrandStore } from "../adapters/memory/in-memory-errand-store";
import { EmptyAlertFeed } from "../adapters/alerts/empty-alert-feed";
import { gatedModel } from "../adapters/models/run-budget-gate";
import { SqliteActionLedger } from "../adapters/sqlite/sqlite-action-ledger";
import { SqliteProposalStore } from "../adapters/sqlite/sqlite-proposal-store";
import { SqliteMemoryStore } from "../adapters/sqlite/sqlite-memory-store";
import { SqliteWorldStateStore } from "../adapters/sqlite/sqlite-world-state-store";
import { ModelScriptPlayer } from "../adapters/models/scripted";
import { MINIMAX_MODEL_ID } from "../adapters/models/minimax";
import { createModel, parseModelSelection, type ModelRole } from "../adapters/models/select-model";
import { reviewReadersFor } from "../adapters/review-reader/select-review-readers";
import { contextBudgetedModel, ModelCallPlaces } from "../adapters/tracing/context-log-middleware";
import { JsonlTraceSink } from "../adapters/tracing/jsonl-trace-sink";
import { PriceTable } from "../adapters/tracing/price-table";
import { Sanitizer } from "../adapters/tracing/sanitize";
import { SqliteRunBudgetStore } from "../adapters/sqlite/run-budget-store";
import { faultyWorld, WorldPause, type WorldFault } from "../adapters/world/faulty-world";
import { DEV_USER_ID, MockProviderWorld } from "../adapters/world/mock-provider-world";
import { isScenarioName, scenarioNamed, type ScenarioName } from "../adapters/world/scenarios/scenarios";
import { worldCatalog } from "../adapters/world/world-catalog";
import { providerPhotoFiles } from "../adapters/world/provider-photos";
import { generatedUiInstructions, openUiLangReader } from "../adapters/generated-ui/openui-lang-reader";

// Main: the only place that constructs adapters. The agent and its channels ask this module for
// use-case dependencies and never import an adapter themselves.

export const DEFAULT_WORLD_SEED = 42;

export type { WorldFault } from "../adapters/world/faulty-world";

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
  /**
   * The real time, never pinned. Trace spans and events are stamped with it, so everything on the
   * trace's timeline (and the trace route's "now") uses one clock even when evals pin `clock`.
   */
  readonly wallClock: Clock = systemClock;
  /** True when ERRAND_CLOCK_START set the clock, so sessions read it instead of their own time. */
  readonly isClockPinned: boolean;
  /** The offline model's script, loaded per scenario through the dev-only model-script route. */
  readonly modelScript = new ModelScriptPlayer();
  readonly traceSink: TraceSink = new JsonlTraceSink({
    directory: traceDirectory(),
    sanitizer: new Sanitizer({ secrets: runtimeSecrets() }),
  });
  readonly modelPricing: ModelPricing = new PriceTable();
  /** Which chat span each run's current model call is, so its context event can name it (ticket 12). */
  readonly modelCallPlaces = new ModelCallPlaces();
  readonly #errandRecords = new InMemoryErrandStore();
  readonly errands: ErrandStore = this.#errandRecords;
  /** Provider alerts for the home screen; empty until ticket 14 raises them. */
  readonly alertFeed: AlertFeed = new EmptyAlertFeed();
  readonly catalog: ServiceCatalog = worldCatalog;
  #world: MockProviderWorld;
  #settings: WorldSettings;
  #database: Database | undefined;
  #runBudgets: RunBudgetStore | undefined;
  /** Dev only: limits a scenario set for the runs that start after it, and a fault in the world. */
  #runLimits: RunLimits = DEFAULT_RUN_LIMITS;
  #worldFault: WorldFault | undefined;
  readonly #worldPause = new WorldPause();
  #proposals: ProposalStore | undefined;
  #memory: MemoryStore | undefined;
  #reviewReaders: readonly ReviewReader[] | undefined;
  #ledger: ActionLedger | undefined;
  #worldStates: SqliteWorldStateStore | undefined;

  constructor(settings: WorldSettings) {
    ({ clock: this.clock, isPinned: this.isClockPinned } = processClock());
    const restored = this.#restoredWorld();
    this.#settings = restored?.settings ?? settings;
    this.#world = restored?.world ?? this.#buildWorld(settings);
  }

  get world(): ProviderWorld {
    return this.#worldFault === undefined ? this.#world : faultyWorld(this.#world, this.#worldFault, this.#worldPause);
  }

  /**
   * The process's SQLite database, opened on first use. Stores that must survive a restart take it
   * and run their own migrations (see src/adapters/sqlite/database.ts).
   */
  get database(): Database {
    this.#database ??= openDatabase(databasePath());
    return this.#database;
  }

  /** The action ledger: every booking intent, recorded before `book` is sent (see src/core/booking). */
  get ledger(): ActionLedger {
    this.#ledger ??= new SqliteActionLedger(this.database);
    return this.#ledger;
  }

  /** Proposals and grants, in the SQLite database so an approval survives a restart. */
  get proposals(): ProposalStore {
    this.#proposals ??= new SqliteProposalStore(this.database);
    return this.#proposals;
  }

  /**
   * The world's user for the local-dev principal: the channel's auth context says who is calling,
   * and locally that is always the one dev user. Real auth maps its principals here instead.
   */
  readonly devUserId = DEV_USER_ID;

  get worldSettings(): WorldSettings {
    return this.#settings;
  }

  /**
   * Dev only: replace the world with a freshly seeded one for the named scenario. A new scenario
   * starts clean: default run limits, no world fault, and no proposals, grants or errands (they name
   * the old world's holds and bookings, whose ids the new world reuses).
   */
  async switchScenario(settings: WorldSettings): Promise<WorldSettings> {
    this.#settings = settings;
    this.#world = this.#buildWorld(settings);
    this.#runLimits = DEFAULT_RUN_LIMITS;
    this.injectWorldFault(null);
    await this.proposals.discardAll();
    this.#errandRecords.discardAll();
    await this.ledger.discardAll();
    return settings;
  }

  /** Persisted run budgets, so a restart keeps every run's counts (see src/core/budget). */
  get runBudgets(): RunBudgetStore {
    this.#runBudgets ??= new SqliteRunBudgetStore(this.database);
    return this.#runBudgets;
  }

  get runLimits(): RunLimits {
    return this.#runLimits;
  }

  /** Dev only: the limits runs start with from now on; `null` goes back to the defaults. */
  setRunLimits(limits: Partial<RunLimits> | null): RunLimits {
    this.#runLimits = limits === null ? DEFAULT_RUN_LIMITS : { ...DEFAULT_RUN_LIMITS, ...limits };
    return this.#runLimits;
  }

  get worldFault(): WorldFault | null {
    return this.#worldFault ?? null;
  }

  /** How many world calls a `pause_after` fault has held since the process started. */
  get pausedWorldCalls(): number {
    return this.#worldPause.paused;
  }

  /**
   * Dev only: make one world operation slow, throw, or pause after it took effect, until a
   * scenario switch or `null` clears it. Clearing lets any paused reply through.
   */
  injectWorldFault(fault: WorldFault | null): WorldFault | null {
    this.#worldFault = fault ?? undefined;
    if (fault === null) this.#worldPause.releaseAll();
    return this.worldFault;
  }

  /** What the run-budget use cases need. Time is the wall clock: a pinned clock must not age a run. */
  get runBudgetDependencies(): RunBudgetDependencies {
    return { budgets: this.runBudgets, limits: this.#runLimits, clock: this.wallClock };
  }

  get settleRunDependencies(): SettleRunDependencies {
    return {
      budgets: this.runBudgets,
      errands: this.errands,
      traceSink: this.traceSink,
      clock: this.wallClock,
      world: this.world,
      proposals: this.proposals,
    };
  }

  /**
   * The role's model held to one run's budget: every model call, and every tool call it asks for,
   * is charged to `run` first (see src/adapters/models/run-budget-gate.ts), and every call's
   * context is packed into the fixed context budget and logged (src/adapters/tracing/context-log-middleware.ts).
   */
  budgetedModelFor(role: ModelRole, run: RunKey, describe: (outcome: RunOutcome) => string): LanguageModel {
    const deps = this.runBudgetDependencies;
    // Inside the gate: a call the run budget stops is never packed or logged.
    const contextBudgeted = contextBudgetedModel(this.modelFor(role), {
      budget: CONTEXT_BUDGET,
      run,
      places: this.modelCallPlaces,
      record: (request) => recordModelContext({ traceSink: this.traceSink, clock: this.wallClock }, request),
    });
    return gatedModel(contextBudgeted, {
      startModelTurn: () => startModelTurn(deps, run),
      admitToolCalls: (count) => admitToolCalls(deps, { run, count }),
      recordModelFailure: () => recordModelFailure(deps, run),
      describe: (exit: RunExit) => describe(exit),
    });
  }

  /** Memory facts, in the shared database so they outlive the process (ticket 11). */
  get memory(): MemoryStore {
    this.#memory ??= new SqliteMemoryStore(this.database);
    return this.#memory;
  }

  /** What the memory use cases need. Validity windows use the process clock, pinned in evals. */
  get memoryDependencies(): MemoryDependencies {
    return { memory: this.memory, catalog: this.catalog, clock: this.clock };
  }

  /** What the memory provider needs to build each turn's remembered context. */
  get modelContextDependencies(): ModelContextDependencies {
    return {
      memory: this.memory,
      errands: this.errands,
      traceSink: this.traceSink,
      budget: CONTEXT_BUDGET,
      clock: this.clock,
      wallClock: this.wallClock,
    };
  }

  /** What the errand use cases need. Transitions are stamped with the trace's wall clock. */
  get errandDependencies(): ErrandDependencies & { readonly world: ProviderWorld } {
    return { errands: this.errands, catalog: this.catalog, traceSink: this.traceSink, clock: this.wallClock, world: this.world };
  }

  /** What the hold, propose, approve, decline and execute use cases need. Holds and grants run on the world's clock. */
  get proposalDependencies(): ProposalDependencies {
    return {
      errand: this.errandDependencies,
      world: this.world,
      proposals: this.proposals,
      hasher: sha256Hasher,
      ids: randomIds,
      worldClock: this.clock,
    };
  }

  /**
   * What get_provider_insight needs: the world, and the review readers in fallback order for the
   * `review_reader` role (see src/adapters/review-reader/select-review-readers.ts).
   */
  get insightDependencies(): ProviderInsightDependencies {
    this.#reviewReaders ??= reviewReadersFor(parseModelSelection(process.env.ERRAND_MODELS).review_reader, {
      minimaxApiKey: process.env.MINIMAX_API_KEY,
      pricing: this.modelPricing,
    });
    return { world: this.world, readers: this.#reviewReaders, traceSink: this.traceSink, clock: this.wallClock };
  }

  /** What the home composer starts an errand with: its chips become the errand before the first model turn. */
  get draftErrandDependencies(): DraftErrandDependencies {
    return { ...this.errandDependencies, calendar: this.clock };
  }

  /** Everything the home screen reads, on the world's clock. */
  get homeDependencies(): HomeSummaryDependencies {
    return {
      errands: this.#errandRecords,
      proposals: this.proposals,
      world: this.world,
      memory: this.memory,
      alerts: this.alertFeed,
      catalog: this.catalog,
      worldClock: this.clock,
    };
  }

  /** The model the agent's main role runs on, as the composer's model chip names it. */
  get mainModel(): { readonly provider: "minimax" | "scripted"; readonly modelId: string } {
    const provider = parseModelSelection(process.env.ERRAND_MODELS).main;
    return provider === "minimax" ? { provider, modelId: MINIMAX_MODEL_ID } : { provider: "scripted", modelId: "scripted" };
  }

  /** What executing a proposal and reconciling the ledger need: the proposal use cases plus the ledger. */
  get bookingDependencies(): BookingDependencies {
    return { ...this.proposalDependencies, ledger: this.ledger };
  }


  /** What the present and ask (generated UI) use cases need: the OpenUI Lang reader and the world that confirms ids. */
  get generatedUiDependencies(): GeneratedUiDependencies {
    return { reader: openUiLangReader, world: this.world, errands: this.errands, traceSink: this.traceSink, clock: this.wallClock };
  }

  /** The generated-UI library's part of the model's instructions (it counts toward the context budget). */
  readonly generatedUiInstructions: string = generatedUiInstructions();

  /** The committed provider photos the app API serves. */
  readonly providerPhotoFiles: ProviderPhotoFiles = providerPhotoFiles;

  modelFor(role: ModelRole): LanguageModel {
    const selection = parseModelSelection(process.env.ERRAND_MODELS);
    return createModel(selection[role], { minimaxApiKey: process.env.MINIMAX_API_KEY, scriptPlayer: this.modelScript });
  }

  get #worldStateStore(): SqliteWorldStateStore {
    this.#worldStates ??= new SqliteWorldStateStore(this.database);
    return this.#worldStates;
  }

  #buildWorld(settings: WorldSettings): MockProviderWorld {
    return new MockProviderWorld({
      seed: settings.seed,
      scenario: scenarioNamed(settings.scenario),
      clock: this.clock,
      store: this.#worldStateStore,
    });
  }

  /** The world as the last process left it, so a restart doesn't make the provider forget its bookings. */
  #restoredWorld(): { readonly world: MockProviderWorld; readonly settings: WorldSettings } | undefined {
    const state = this.#worldStateStore.load();
    if (state === undefined || !isScenarioName(state.scenario)) return undefined;
    const settings: WorldSettings = { scenario: state.scenario, seed: state.seed };
    const world = new MockProviderWorld({
      seed: state.seed,
      scenario: scenarioNamed(state.scenario),
      clock: this.clock,
      store: this.#worldStateStore,
      state,
    });
    return { world, settings };
  }
}

// One instance per process: the tools and the app API channel must read the same world, so the
// dev scenario switch reaches the tools. It is kept on globalThis, not in a module variable,
// because eve bundles the instrumentation apart from the tools and channels: a module variable gave
// the run trace its own container, with an empty errand store, so it couldn't see the errand a run
// left behind.
const INSTANCE = Symbol.for("errand-agent.container");

export function container(): Container {
  const holder = globalThis as { [INSTANCE]?: Container };
  holder[INSTANCE] ??= new Container({ scenario: "default", seed: DEFAULT_WORLD_SEED });
  return holder[INSTANCE];
}
