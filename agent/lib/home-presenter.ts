import type { DraftErrandRequest, GetHomeSummaryResponse, HomeAlertView, MainModelView, UpcomingVisitView } from "@errand/contracts";

import type { Errand } from "../../src/core/errand/errand";
import type { HomeAlert, UpcomingVisit } from "../../src/core/home/home-summary";
import type { DraftErrandOutcome, ErrandDraft } from "../../src/core/use-cases/draft-errand";
import type { HomeSummary } from "../../src/core/use-cases/get-home-summary";
import { presentFact } from "./memory-presenter";

// Core's home summary to the wire, and the composer's wire request to core's draft. The words a
// person reads (labels, relative times) are the client's to set: every value here is data.

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function timeWindowOf(errand: Errand) {
  const window = errand.details.timeWindow;
  if (window === undefined) return null;
  return { from: window.dates.from, to: window.dates.to, earliestHour: window.hours?.from ?? null, latestHour: window.hours?.to ?? null };
}

function presentVisit(visit: UpcomingVisit): UpcomingVisitView {
  if (visit.kind === "booked") {
    const { booking } = visit;
    return {
      kind: "booked",
      bookingId: booking.bookingId,
      providerName: booking.providerName,
      service: booking.service,
      slot: { start: booking.slot.start, end: booking.slot.end },
      priceInr: booking.priceInr,
    };
  }
  const { proposal } = visit;
  return {
    kind: "checking",
    proposalId: proposal.proposalId,
    sessionId: proposal.sessionId,
    providerName: proposal.terms.providerName,
    service: proposal.terms.service,
    slot: { start: proposal.terms.slot.start, end: proposal.terms.slot.end },
    priceInr: proposal.terms.priceInr,
  };
}

function presentAlert(alert: HomeAlert): HomeAlertView {
  if (alert.kind === "provider_cancelled") {
    const { alert: raised } = alert;
    return {
      kind: "provider_cancelled",
      alertId: raised.alertId,
      bookingId: raised.bookingId,
      providerName: raised.providerName,
      service: raised.service,
      slot: { start: raised.slot.start, end: raised.slot.end },
      replacementsReady: raised.replacementsReady,
      sessionId: raised.sessionId ?? null,
      at: iso(alert.atMs),
    };
  }
  const { errand } = alert;
  return {
    kind: alert.kind,
    errandId: errand.errandId,
    sessionId: errand.sessionId,
    service: errand.details.service ?? null,
    area: errand.details.area ?? null,
    at: iso(alert.atMs),
  };
}

export function presentHomeSummary(summary: HomeSummary, model: MainModelView, generatedAtMs: number): GetHomeSummaryResponse {
  const approvals = summary.waiting.approvals.map(({ proposal, holdLeftMs }) => ({
    proposalId: proposal.proposalId,
    sessionId: proposal.sessionId,
    providerName: proposal.terms.providerName,
    service: proposal.terms.service,
    slot: { start: proposal.terms.slot.start, end: proposal.terms.slot.end },
    priceInr: proposal.terms.priceInr,
    holdSecondsLeft: Math.floor(holdLeftMs / 1_000),
  }));
  return {
    generatedAt: iso(generatedAtMs),
    counts: {
      running: summary.working.length,
      waitingOnYou: approvals.length + summary.waiting.facts.length,
      alerts: summary.alertsNeedingPerson,
    },
    working: summary.working.map(({ errand, sinceMs, waitingOn }) => ({
      sessionId: errand.sessionId,
      errandId: errand.errandId,
      state: errand.state,
      waitingOn,
      since: iso(sinceMs),
      service: errand.details.service ?? null,
      area: errand.details.area ?? null,
      timeWindow: timeWindowOf(errand),
      budgetInr: errand.details.budget?.maxInr ?? null,
    })),
    waiting: { approvals, facts: summary.waiting.facts.map(presentFact) },
    upcoming: summary.upcoming.map(presentVisit),
    alerts: summary.alerts.map(presentAlert),
    activity: { today: summary.activity.today, days: summary.activity.days.map((day) => ({ ...day })) },
    memory: summary.memory.map(presentFact),
    composer: {
      areas: [...summary.composer.areas],
      area: summary.composer.area ?? null,
      budgetInr: summary.composer.budgetInr ?? null,
      earliestHour: summary.composer.earliestHour ?? null,
      model,
    },
  };
}

/** The last hour a day can run to: "from 10:00" with no end means until the day ends. */
const END_OF_DAY = 24;

export function draftOf(request: DraftErrandRequest): ErrandDraft {
  const { area, budgetInr, when } = request;
  const hours =
    when === null || (when.earliestHour === null && when.latestHour === null)
      ? undefined
      : { from: when.earliestHour ?? 0, to: when.latestHour ?? END_OF_DAY };
  return {
    ...(area === null ? {} : { area }),
    ...(budgetInr === null ? {} : { budget: { maxInr: budgetInr } }),
    ...(when === null ? {} : { thisWeek: hours === undefined ? {} : { hours } }),
  };
}

/** What the app API answers when the composer's draft isn't applied: one message per outcome. */
export function presentDraftRefusal(
  outcome: Exclude<DraftErrandOutcome, { readonly kind: "drafted" | "empty_draft" }>,
): { readonly status: number; readonly code: string; readonly message: string } {
  switch (outcome.kind) {
    case "errand_exists":
      return { status: 409, code: "errand_exists", message: "This chat already has an errand; change it by talking to the agent." };
    case "unknown_area":
      return { status: 422, code: "unknown_area", message: `That area isn't one we cover. Try ${outcome.knownAreas.slice(0, 3).join(", ")}.` };
    case "invalid_detail":
      return { status: 422, code: "invalid_detail", message: `The ${outcome.field === "timeWindow" ? "time" : outcome.field} on the composer isn't valid.` };
  }
}
