import type { Grant } from "../approval/grant";
import type { Proposal } from "../approval/proposal";
import type { ProposalStore } from "../ports/proposal-store";
import type { Booking, ProviderWorld } from "../ports/provider-world";

// ListBookings: the person's bookings as the world has them, each with the approval that made it.
// A booking made through the agent has its proposal and grant; one with neither was not made by
// an approved proposal (the seeded history, or a bug the evals' invariants would catch).

export interface BookingApproval {
  readonly proposal: Proposal;
  readonly grant?: Grant;
}

export interface ApprovedBooking {
  readonly booking: Booking;
  readonly approval?: BookingApproval;
}

export async function listBookings(
  deps: { readonly world: ProviderWorld; readonly proposals: ProposalStore },
  userId: string,
): Promise<readonly ApprovedBooking[]> {
  const bookings = await deps.world.listBookings(userId);
  return Promise.all(
    bookings.map(async (booking) => {
      const proposal = await deps.proposals.findProposalByBooking(booking.bookingId);
      if (proposal === undefined) return { booking };
      const grant = await deps.proposals.grantOf(proposal.proposalId);
      return { booking, approval: { proposal, ...(grant === undefined ? {} : { grant }) } };
    }),
  );
}
