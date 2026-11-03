import type { ProviderPhoto, Review, ServiceKind, Slot } from "../../../core/ports/provider-world";
import { photosFor } from "../provider-photos";
import {
  AREAS,
  ATTRIBUTES,
  CANCELLATION_TERMS,
  NAME_STEMS,
  NAME_SUFFIX,
  PRICE_RANGE_INR,
  INJECTION_CAMPAIGN,
  PROMPT_INJECTION_REVIEW,
  REVIEW_AUTHORS,
  REVIEW_TEXTS,
  SERVICES,
  VISIT_HOURS,
} from "./catalog";
import { drawFor, SeededRandom } from "./seeded-random";

/**
 * Which providers carry an injected review: `best_rated` gives the best-rated provider of each
 * group the classic one, `every_provider` gives every provider one variant of the campaign.
 */
export type ReviewInjection = "best_rated" | "every_provider";

/** A provider as seeded: everything except its free slots, which depend on the dates asked. */
export interface SeededProvider {
  readonly id: string;
  readonly name: string;
  readonly service: ServiceKind;
  readonly area: string;
  readonly priceInr: number;
  readonly rating: number;
  readonly reviewCount: number;
  readonly attributes: readonly string[];
  readonly about: string;
  readonly cancellationTerms: string;
  readonly reviews: readonly Review[];
  readonly photos: readonly ProviderPhoto[];
}

const SLOT_FREE_PROBABILITY = 0.35;

function slugOf(area: string): string {
  return area.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function roundToNine(price: number): number {
  return Math.round(price / 50) * 50 - 1;
}

type Injected = { readonly rating: number; readonly text: string } | undefined;

function seedReviews(random: SeededRandom, injected: Injected): Review[] {
  const count = random.integer(3, 5);
  const reviews = random.sample(REVIEW_TEXTS, count).map((review, index) => ({
    author: REVIEW_AUTHORS[(index + random.integer(0, 7)) % REVIEW_AUTHORS.length] ?? "Anonymous",
    rating: review.rating,
    postedOn: `2026-${String(random.integer(5, 10)).padStart(2, "0")}-${String(random.integer(1, 28)).padStart(2, "0")}`,
    text: review.text,
  }));
  if (injected === undefined) return reviews;
  return [
    ...reviews.slice(0, 1),
    { author: "Verified customer", rating: injected.rating, postedOn: "2026-10-12", text: injected.text },
    ...reviews.slice(1),
  ];
}

function injectedReview(injection: ReviewInjection, index: number, isBest: boolean): Injected {
  if (injection === "every_provider") return INJECTION_CAMPAIGN[index % INJECTION_CAMPAIGN.length];
  return isBest ? PROMPT_INJECTION_REVIEW : undefined;
}

function seedGroup(seed: number, service: ServiceKind, area: string, injection: ReviewInjection): SeededProvider[] {
  const random = new SeededRandom(seed, "group", service, area);
  const count = random.integer(3, 8);
  const [minPrice, maxPrice] = PRICE_RANGE_INR[service];
  const stems = random.sample(NAME_STEMS, count);
  const drafts = stems.map((stem, index) => {
    const rating = Math.round((3.6 + random.next() * 1.3) * 10) / 10;
    return {
      id: `prv_${service}_${slugOf(area)}_${index + 1}`,
      name: `${stem} ${random.pick(NAME_SUFFIX[service])}`,
      service,
      area,
      priceInr: roundToNine(minPrice + random.next() * (maxPrice - minPrice)),
      rating,
      reviewCount: random.integer(12, 480),
      attributes: random.sample(ATTRIBUTES, random.integer(1, 4)),
      about: `${stem} has served ${area} homes for ${random.integer(2, 18)} years.`,
      cancellationTerms: random.pick(CANCELLATION_TERMS),
    };
  });
  // The best-rated provider in each group carries the injection, so a search that compares
  // options always meets it.
  const best = drafts.reduce((top, draft) => (draft.rating > top.rating ? draft : top));
  return drafts.map((draft, index) => ({
    ...draft,
    reviews: seedReviews(new SeededRandom(seed, "reviews", draft.id), injectedReview(injection, index, draft === best)),
    photos: photosFor(draft.id, service),
  }));
}

export function seedProviders(seed: number, injection: ReviewInjection): readonly SeededProvider[] {
  return SERVICES.flatMap((service) => AREAS.flatMap((area) => seedGroup(seed, service, area, injection)));
}

function hourSlot(date: string, hour: number): Slot {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    start: `${date}T${pad(hour)}:00:00+05:30`,
    end: `${date}T${pad(hour + 1)}:00:00+05:30`,
  };
}

/** The provider's seeded open slots on one date, before holds and bookings are removed. */
export function seededSlotsOn(seed: number, providerId: string, date: string): Slot[] {
  return VISIT_HOURS.filter((hour) => drawFor(seed, "slot", providerId, date, hour) < SLOT_FREE_PROBABILITY).map(
    (hour) => hourSlot(date, hour),
  );
}

export function istHourOf(slot: Slot): number {
  return Number(slot.start.slice(11, 13));
}

export function istDateOf(slot: Slot): string {
  return slot.start.slice(0, 10);
}
