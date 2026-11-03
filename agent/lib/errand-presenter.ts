import type {
  ErrandOption as WireErrandOption,
  ErrandSearchOutput,
  ErrandView,
  QuickReply,
  UpdateErrandOutput,
} from "@errand/contracts";

import { fieldsToAsk, missingFields, type Errand, type RequiredField } from "../../src/core/errand/errand";
import type { ErrandOption, OptionTag } from "../../src/core/errand/errand-options";
import type { ServiceKind, Slot } from "../../src/core/ports/provider-world";
import type { ServiceCatalog } from "../../src/core/ports/service-catalog";
import type { FindErrandOptionsOutcome } from "../../src/core/use-cases/find-errand-options";
import type { UpdateErrandOutcome } from "../../src/core/use-cases/update-errand";
import { presentSummary } from "./world-presenter";

// Core errands and outcomes to wire shapes, and the one place their user-facing words live: the
// quick replies under a question and the one-line reason under each option.

const SERVICE_LABELS: Readonly<Record<ServiceKind, string>> = {
  plumber: "Plumber",
  electrician: "Electrician",
  ac_servicing: "AC servicing",
  carpenter: "Carpenter",
  cleaner: "Cleaner",
};

const TIME_WINDOW_REPLIES = ["Today", "Tomorrow morning", "This weekend", "This week"];
const AREA_REPLIES = 4;

function quickRepliesFor(field: RequiredField, catalog: ServiceCatalog): QuickReply[] {
  switch (field) {
    case "service":
      return catalog.services().map((service) => ({ field, text: SERVICE_LABELS[service] }));
    case "area":
      return catalog.areas().slice(0, AREA_REPLIES).map((area) => ({ field, text: area }));
    case "timeWindow":
      return TIME_WINDOW_REPLIES.map((text) => ({ field, text }));
  }
}

export function presentErrand(errand: Errand, catalog: ServiceCatalog): ErrandView {
  const { details } = errand;
  const asking = fieldsToAsk(details);
  return {
    errandId: errand.errandId,
    state: errand.state,
    service: details.service ?? null,
    area: details.area ?? null,
    timeWindow:
      details.timeWindow === undefined
        ? null
        : {
            from: details.timeWindow.dates.from,
            to: details.timeWindow.dates.to,
            earliestHour: details.timeWindow.hours?.from ?? null,
            latestHour: details.timeWindow.hours?.to ?? null,
          },
    budgetInr: details.budget?.maxInr ?? null,
    preferences: [...details.preferences],
    missing: missingFields(details),
    question:
      asking.length === 0
        ? null
        : { fields: asking, quickReplies: asking.flatMap((field) => quickRepliesFor(field, catalog)) },
    transitions: errand.transitions.map((transition) => ({
      sequence: transition.sequence,
      from: transition.from ?? null,
      to: transition.to,
      reason: transition.reason,
      atMs: transition.atMs,
    })),
    replacing: errand.replacing === undefined ? null : { ...errand.replacing },
  };
}

export function presentUpdateOutcome(outcome: UpdateErrandOutcome, catalog: ServiceCatalog): UpdateErrandOutput {
  const errand = presentErrand(outcome.errand, catalog);
  switch (outcome.kind) {
    case "updated":
      return { kind: "updated", errand, changed: [...outcome.changed] };
    case "invalid_detail":
      return { kind: "invalid_detail", errand, field: outcome.field, reason: outcome.reason };
    case "unknown_service":
      return { kind: "unknown_service", errand, knownServices: [...outcome.knownServices] };
    case "unknown_area":
      return { kind: "unknown_area", errand, knownAreas: [...outcome.knownAreas] };
    case "not_editable":
      return { kind: "not_editable", errand };
  }
}

const slotFormat = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

function formatSlot(slot: Slot): string {
  return `${slotFormat.format(new Date(slot.start))} IST`;
}

function reasonFor(tag: OptionTag, option: ErrandOption, firstSlot: Slot): string {
  const { provider } = option;
  switch (tag) {
    case "best_match": {
      const met = option.preferencesMet > 0 ? `, meets ${option.preferencesMet} of your preferences` : "";
      return `Best match: rated ${provider.rating} from ${provider.reviewCount} reviews${met}`;
    }
    case "cheapest":
      return `Cheapest: ₹${provider.priceInr.toLocaleString("en-IN")}`;
    case "earliest":
      return `Earliest: ${formatSlot(firstSlot)}`;
    case "runner_up":
      return `Runner-up: rated ${provider.rating}, ₹${provider.priceInr.toLocaleString("en-IN")}`;
  }
}

function presentOption(option: ErrandOption): WireErrandOption {
  const [firstSlot] = option.slots;
  if (firstSlot === undefined) throw new Error(`Option ${option.provider.id} has no slot in the time window.`);
  return {
    providerId: option.provider.id,
    tags: [...option.tags],
    reason: option.tags.map((tag) => reasonFor(tag, option, firstSlot)).join(" · "),
    earliestSlot: { start: firstSlot.start, end: firstSlot.end },
  };
}

/** Options as the model and the chat see them; also the next options after a slot was taken. */
export function presentOptions(options: readonly ErrandOption[]): WireErrandOption[] {
  return options.map(presentOption);
}

export function presentFindOutcome(outcome: FindErrandOptionsOutcome, catalog: ServiceCatalog): ErrandSearchOutput {
  const errand = presentErrand(outcome.errand, catalog);
  switch (outcome.kind) {
    case "options": {
      const { eligible, options, excluded } = outcome.selection;
      return {
        kind: "found",
        // Each provider with only the slots inside the time window, so nothing outside it is shown.
        providers: eligible.map((option) => presentSummary({ ...option.provider, freeSlots: option.slots })),
        options: options.map(presentOption),
        excluded: { ...excluded },
        errand,
      };
    }
    case "no_options":
      return { kind: "no_options", searched: outcome.searched, excluded: { ...outcome.excluded }, errand };
    case "unknown_service":
      return { kind: "unknown_service", knownServices: [...outcome.knownServices], errand };
    case "unknown_area":
      return { kind: "unknown_area", knownAreas: [...outcome.knownAreas], errand };
    case "invalid_date_range":
      return { kind: "invalid_date_range", reason: outcome.reason, errand };
    case "invalid_detail":
      return { kind: "invalid_detail", field: outcome.field, reason: outcome.reason, errand };
    case "missing_details":
      return { kind: "missing_details", missing: [...outcome.missing], errand };
    case "not_editable":
      return { kind: "not_editable", errand };
  }
}
