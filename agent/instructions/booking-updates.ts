import { defineDynamic, defineInstructions } from "eve/instructions";

import { container } from "../../src/composition/container";
import { reconcilePendingActions, takeBookingNotices } from "../../src/core/use-cases/reconcile-pending-actions";
import { presentBookingNotice } from "../lib/approval-presenter";

// The start of every turn: the reconciler settles the session's booking intents that an earlier
// run left pending or unknown (a timeout, a run cut off at its deadline, a restart), through
// get_booking_status with each intent's own key. Any settlement the person hasn't heard about yet
// is handed to the model here, so the reply tells them first.
//
// The work runs once per turn (a turn-keyed memo), however many model calls the turn makes. It is
// safe to repeat (the ledger and the world's idempotency key make a second pass a no-op), so a cold
// start that runs it again does no harm.

/** How long a turn waits for the reconciler before the model starts; a slower pass finishes in the background. */
const TURN_RECONCILE_WAIT_MS = 5_000;

function waited<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function bookingUpdates(sessionId: string): Promise<string[]> {
  const deps = container().bookingDependencies;
  try {
    await waited(reconcilePendingActions(deps, { sessionId }), TURN_RECONCILE_WAIT_MS);
    return (await takeBookingNotices(deps, { sessionId })).map(presentBookingNotice);
  } catch (error) {
    // A failed pass leaves the intents as they were; the next turn (or a restart) tries again.
    console.error("booking reconciliation failed at the start of a turn", { sessionId, error });
    return [];
  }
}

export default defineDynamic(async (ctx) => {
  if (ctx.turn === null || ctx.session.parent != null) return null;
  const updates = await ctx.memo(["booking-updates", ctx.turn.id], () => bookingUpdates(ctx.session.id));
  if (updates.length === 0) return null;
  return defineInstructions({
    content:
      "Booking updates the person hasn't heard yet (the provider settled them after your last reply). " +
      "Tell them first, in your own words, keeping any booking ID exactly:\n" +
      updates.map((update) => `- ${update}`).join("\n"),
  });
});
