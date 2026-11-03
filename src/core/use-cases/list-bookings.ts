import type { Grant } from "../approval/grant";
import { isBookingChangeProposal, isExecutionStarted, type BookingChangeProposal, type Proposal } from "../approval/proposal";
import { isChangeable } from "../booking/booking-change";
import type { Clock } from "../ports/clock";
import type { ProposalStore } from "../ports/proposal-store";
import type { Booking, ProviderWorld } from "../ports/provider-world";

// ListBookings: the person's bookings as the world has them, each with the approval that made it
// and the approvals that changed it. A booking made through the agent has its proposal and grant;
// one with neither was not made by an approved proposal (the seeded history, or a bug the evals'
// invariants would catch). Likewise every cancel or reschedule the world carried out should have
// an executed change proposal with its grant.

export interface BookingApproval {
  readonly proposal: Proposal;
  readonly grant?: Grant;
}

/** A cancel or reschedule card for this booking that was carried out (or started), with its grant. */
export interface BookingChangeApproval {
  readonly proposal: BookingChangeProposal;
  readonly grant?: Grant;
}

export interface ApprovedBooking {
  readonly booking: Booking;
  readonly approval?: BookingApproval;
  /** Oldest first. */
  readonly changes: readonly BookingChangeApproval[];
}

type BookingReader = { readonly world: ProviderWorld; readonly proposals: ProposalStore };

async function withGrant<P extends Proposal>(proposals: ProposalStore, proposal: P): Promise<{ readonly proposal: P; readonly grant?: Grant }> {
  const grant = await proposals.grantOf(proposal.proposalId);
  return grant === undefined ? { proposal } : { proposal, grant };
}

export async function listBookings(deps: BookingReader, userId: string): Promise<readonly ApprovedBooking[]> {
  const bookings = await deps.world.listBookings(userId);
  const executedChanges = (await deps.proposals.listProposals({ userId }))
    .filter(isBookingChangeProposal)
    .filter(isExecutionStarted)
    .toReversed();
  return Promise.all(
    bookings.map(async (booking) => {
      const changes = await Promise.all(
        executedChanges.filter((proposal) => proposal.terms.bookingId === booking.bookingId).map((proposal) => withGrant(deps.proposals, proposal)),
      );
      const proposal = await deps.proposals.findProposalByBooking(booking.bookingId);
      if (proposal === undefined) return { booking, changes };
      return { booking, approval: await withGrant(deps.proposals, proposal), changes };
    }),
  );
}

/** A booking with the area its provider serves, so "the same plumber as last time" can be searched for. */
export interface BookingRecord {
  readonly booking: Booking;
  readonly area?: string;
}

export interface BookingHistory {
  /** Bookings that can still be cancelled or moved, soonest first. */
  readonly upcoming: readonly BookingRecord[];
  /** Completed, cancelled or already started, most recent first: "the same as last time" is the first match. */
  readonly past: readonly BookingRecord[];
}

/** The person's bookings split into what is coming up and what is past, as the agent's list_bookings returns them. */
export async function listBookingHistory(deps: { readonly world: ProviderWorld; readonly worldClock: Clock }, userId: string): Promise<BookingHistory> {
  const nowMs = deps.worldClock.now().getTime();
  const bookings = await deps.world.listBookings(userId);
  const areas = new Map<string, string>();
  for (const providerId of new Set(bookings.map((booking) => booking.providerId))) {
    const provider = await deps.world.getProvider(providerId);
    if (provider.kind === "found") areas.set(providerId, provider.provider.area);
  }
  const recordOf = (booking: Booking): BookingRecord => {
    const area = areas.get(booking.providerId);
    return area === undefined ? { booking } : { booking, area };
  };
  const bySlot = (a: Booking, b: Booking) => Date.parse(a.slot.start) - Date.parse(b.slot.start);
  return {
    upcoming: bookings.filter((booking) => isChangeable(booking, nowMs)).toSorted(bySlot).map(recordOf),
    past: bookings.filter((booking) => !isChangeable(booking, nowMs)).toSorted((a, b) => bySlot(b, a)).map(recordOf),
  };
}
