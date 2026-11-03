import {
  alertsNeedingPerson,
  bookingActivity,
  composerDefaults,
  currentFacts,
  errandsAtWork,
  factsToConfirm,
  homeAlerts,
  upcomingVisits,
  type BookingActivity,
  type ComposerDefaults,
  type ErrandAtWork,
  type HomeAlert,
  type UpcomingVisit,
} from "../home/home-summary";
import type { MemoryFact } from "../memory/memory-fact";
import { selectContext } from "../memory/context-selection";
import type { AlertFeed } from "../ports/alert-feed";
import type { Clock } from "../ports/clock";
import type { ErrandIndex } from "../ports/errand-index";
import type { MemoryStore } from "../ports/memory-store";
import type { ProposalStore } from "../ports/proposal-store";
import type { ProviderWorld } from "../ports/provider-world";
import type { ServiceCatalog } from "../ports/service-catalog";
import { listProposals, type ProposalStanding } from "./list-proposals";

// GetHomeSummary: every home widget in one read, so a client draws the whole screen from one call.

export interface HomeSummaryDependencies {
  readonly errands: ErrandIndex;
  readonly proposals: ProposalStore;
  readonly world: ProviderWorld;
  readonly memory: MemoryStore;
  readonly alerts: AlertFeed;
  readonly catalog: ServiceCatalog;
  /** The world's clock: holds, bookings, "today" and memory validity all run on it. */
  readonly worldClock: Clock;
}

export interface HomeSummary {
  readonly working: readonly ErrandAtWork[];
  readonly waiting: {
    /** Approval cards still pending, newest first. */
    readonly approvals: readonly ProposalStanding[];
    /** Inferred facts the person hasn't confirmed yet. */
    readonly facts: readonly MemoryFact[];
  };
  readonly upcoming: readonly UpcomingVisit[];
  readonly alerts: readonly HomeAlert[];
  /** What the bell counts. */
  readonly alertsNeedingPerson: number;
  readonly activity: BookingActivity;
  /** Current facts: explicit, confirmed and still-unconfirmed guesses. */
  readonly memory: readonly MemoryFact[];
  readonly composer: ComposerDefaults & { readonly areas: readonly string[] };
}

export async function getHomeSummary(
  deps: HomeSummaryDependencies,
  request: { readonly userId: string; readonly ownerId: string },
): Promise<HomeSummary> {
  const nowMs = deps.worldClock.now().getTime();
  const [errands, standings, bookings, memory, providerAlerts] = await Promise.all([
    deps.errands.listErrands(),
    listProposals(deps, { userId: request.userId }),
    deps.world.listBookings(request.userId),
    deps.memory.read(request.ownerId),
    deps.alerts.listAlerts(request.userId),
  ]);
  const alerts = homeAlerts(providerAlerts, errands);
  const usable = selectContext(memory.facts, undefined, nowMs).included.map(({ fact }) => fact);
  return {
    working: errandsAtWork(errands),
    waiting: {
      approvals: standings.filter((standing) => standing.proposal.status === "pending"),
      facts: factsToConfirm(memory.facts),
    },
    upcoming: upcomingVisits(
      bookings,
      standings.map((standing) => standing.proposal),
      nowMs,
    ),
    alerts,
    alertsNeedingPerson: alertsNeedingPerson(alerts),
    activity: bookingActivity(bookings, nowMs),
    memory: currentFacts(memory.facts),
    composer: { ...composerDefaults(usable), areas: deps.catalog.areas() },
  };
}
