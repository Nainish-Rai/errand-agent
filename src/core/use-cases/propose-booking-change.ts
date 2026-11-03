import { fingerprintOf } from "../approval/fingerprint";
import {
  cancellationTermsOf,
  isAwaitingApproval,
  isBookingChangeProposal,
  proposeChange,
  rescheduleTermsOf,
  type BookingChangeProposal,
  type BookingChangeTerms,
} from "../approval/proposal";
import { isChangeable, isSameSlot } from "../booking/booking-change";
import { istDayOf } from "../calendar/ist-day";
import type { TracePlace } from "../errand/errand-workflow";
import type { Booking, ProviderDetails, Slot } from "../ports/provider-world";
import { alternativesTo, bookingOf, freeSlotsOf } from "./booking-change-session";
import type { ProposalDependencies } from "./proposal-session";

// ProposeCancellation and ProposeReschedule: the approval card for changing a booking the person
// already has. Like a booking's card, every term comes from the world: the booking from
// `list_bookings`, the fee from the provider's own cancellation rule at this moment, and the new
// slot only if the provider has it free. The model names the booking and the slot it wants; it
// can't name a price, a fee or a time the world doesn't have. Nothing changes until the person taps
// Approve on the card.

export type ProposeBookingChangeOutcome =
  | { readonly kind: "proposed"; readonly proposal: BookingChangeProposal }
  /** The person has no booking with that ID. */
  | { readonly kind: "booking_not_found" }
  /** Completed, cancelled, or already started: only an upcoming booking can be cancelled or moved. */
  | { readonly kind: "not_changeable"; readonly booking: Booking }
  /** The booking is already at that slot. */
  | { readonly kind: "same_slot"; readonly booking: Booking }
  /** The provider doesn't have that slot free; these are its free slots closest to it that day. */
  | { readonly kind: "slot_unavailable"; readonly booking: Booking; readonly alternatives: readonly Slot[] }
  | { readonly kind: "provider_not_found"; readonly booking: Booking };

interface ChangeRequest {
  readonly place: TracePlace;
  readonly userId: string;
  readonly bookingId: string;
}

type Readiness =
  | { readonly kind: "ready"; readonly booking: Booking; readonly provider: ProviderDetails }
  | Exclude<ProposeBookingChangeOutcome, { readonly kind: "proposed" | "same_slot" | "slot_unavailable" }>;

async function changeable(deps: ProposalDependencies, request: ChangeRequest): Promise<Readiness> {
  const booking = await bookingOf(deps.world, request.userId, request.bookingId);
  if (booking === undefined) return { kind: "booking_not_found" };
  if (!isChangeable(booking, deps.worldClock.now().getTime())) return { kind: "not_changeable", booking };
  const provider = await deps.world.getProvider(booking.providerId);
  if (provider.kind !== "found") return { kind: "provider_not_found", booking };
  return { kind: "ready", booking, provider: provider.provider };
}

/** The same card again while it is still up, rather than a second card for the same change. */
async function shownAgain(terms: BookingChangeTerms, place: TracePlace, deps: ProposalDependencies): Promise<BookingChangeProposal | undefined> {
  const latest = await deps.proposals.latestProposalOf(place.sessionId);
  if (latest === undefined || !isBookingChangeProposal(latest) || !isAwaitingApproval(latest, deps.worldClock.now().getTime())) return undefined;
  return latest.fingerprint === fingerprintOf(terms, deps.hasher) ? latest : undefined;
}

async function proposed(terms: BookingChangeTerms, request: ChangeRequest, deps: ProposalDependencies): Promise<ProposeBookingChangeOutcome> {
  const again = await shownAgain(terms, request.place, deps);
  if (again !== undefined) return { kind: "proposed", proposal: again };
  const who = { proposalId: deps.ids.next("prp"), sessionId: request.place.sessionId, userId: request.userId };
  const proposal = proposeChange(terms, who, deps.hasher, deps.worldClock.now().getTime());
  await deps.proposals.saveProposal(proposal);
  return { kind: "proposed", proposal };
}

export async function proposeCancellation(deps: ProposalDependencies, request: ChangeRequest): Promise<ProposeBookingChangeOutcome> {
  const ready = await changeable(deps, request);
  if (ready.kind !== "ready") return ready;
  return proposed(cancellationTermsOf(ready.booking, ready.provider, deps.worldClock.now().getTime()), request, deps);
}

export async function proposeReschedule(
  deps: ProposalDependencies,
  request: ChangeRequest & { readonly slot: Slot },
): Promise<ProposeBookingChangeOutcome> {
  const ready = await changeable(deps, request);
  if (ready.kind !== "ready") return ready;
  const { booking, provider } = ready;
  if (isSameSlot(booking.slot, request.slot)) return { kind: "same_slot", booking };

  const day = istDayOf(Date.parse(request.slot.start));
  const free = await freeSlotsOf(deps.world, provider, { from: day, to: day });
  // The provider's own copy of the slot, so the card shows exactly what the provider offers.
  const offered = free.kind === "slots" ? free.slots.find((slot) => isSameSlot(slot, request.slot)) : undefined;
  if (offered === undefined) {
    return { kind: "slot_unavailable", booking, alternatives: await alternativesTo(deps.world, provider, request.slot) };
  }
  return proposed(rescheduleTermsOf(booking, provider, offered, deps.worldClock.now().getTime()), request, deps);
}
