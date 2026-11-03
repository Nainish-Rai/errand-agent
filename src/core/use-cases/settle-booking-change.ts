import { attemptStarted, changeConfirmed, failedWith, isResolved, type BookingChangeIntent, type ResolvedBy } from "../booking/action-intent";
import {
  readCancelReply,
  readRescheduleReply,
  settleChangeFromStatus,
  type ChangeReplyReading,
  type ChangeSettlement,
} from "../booking/booking-change";
import type { Booking } from "../ports/provider-world";
import { advanced, reread, tracedWorldCall, type LedgerDependencies, type LedgerStep, type SettleActionIntentRequest } from "./settle-action-intent";

// Drives one cancel or reschedule intent as far as the world lets it go: confirmed or failed.
// Like a booking, every attempt is counted in the ledger before the call is sent and every call
// uses the intent's one key, and the outcome is read from the world's status, never from the
// reply: here the status is the booking as `list_bookings` has it. A 503 is retried with the same
// key after the status shows the booking unchanged, at most MAX_BOOK_ATTEMPTS times in all. The
// status of a booking is always readable, so unlike a timed-out `book` a change never stays unknown.

type Step = LedgerStep<BookingChangeIntent>;

function nowMs(step: Step): number {
  return step.deps.clock.now().getTime();
}

/** The booking as the world lists it, traced as the `list_bookings` status check. */
async function readBooking(step: Step): Promise<Booking | undefined> {
  const { userId, targetBookingId } = step.intent;
  const read = await tracedWorldCall(step, "list_bookings", { user_id: userId, booking_id: targetBookingId }, async () => {
    const booking = (await step.deps.world.listBookings(userId)).find((listed) => listed.bookingId === targetBookingId);
    return booking === undefined
      ? { kind: "not_found" as const, bookingId: targetBookingId }
      : { kind: booking.status, bookingId: booking.bookingId, slotStart: booking.slot.start, booking };
  });
  return "booking" in read ? read.booking : undefined;
}

/** Sends the change with the intent's key and says what the reply means, and the reply's kind. */
async function sendChange(step: Step): Promise<{ readonly reading: ChangeReplyReading; readonly reply: string }> {
  const { intent, deps } = step;
  const key = intent.idempotencyKey;
  if (intent.action === "cancel") {
    const reply = await tracedWorldCall(step, "cancel", { booking_id: intent.targetBookingId, idempotency_key: key }, () =>
      deps.world.cancel(intent.targetBookingId, key),
    );
    return { reading: readCancelReply(reply), reply: reply.kind };
  }
  const args = { booking_id: intent.targetBookingId, new_slot_start: intent.newSlot.start, idempotency_key: key };
  const reply = await tracedWorldCall(step, "reschedule", args, () => deps.world.reschedule(intent.targetBookingId, intent.newSlot, key));
  return { reading: readRescheduleReply(reply), reply: reply.kind };
}

function resolution(intent: BookingChangeIntent, settlement: ChangeSettlement, by: ResolvedBy, atMs: number): BookingChangeIntent | undefined {
  switch (settlement.kind) {
    case "confirm":
      return changeConfirmed(intent, by, atMs);
    case "fail":
      return failedWith(intent, settlement.reason, by, atMs);
    case "retry":
      return undefined;
  }
}

/** Records the settlement; when another writer got there first, what it stored stands. */
async function recorded(step: Step, settlement: ChangeSettlement): Promise<BookingChangeIntent> {
  const next = resolution(step.intent, settlement, step.request.by, nowMs(step));
  if (next === undefined || (await advanced(step, next))) return step.intent;
  return reread(step);
}

export async function settleBookingChange(
  deps: LedgerDependencies,
  request: SettleActionIntentRequest<BookingChangeIntent>,
): Promise<BookingChangeIntent> {
  const step: Step = { intent: request.intent, deps, request, calls: 0 };
  if (isResolved(step.intent)) return step.intent;

  // A call may already have been sent (by a run that was cut off, or crashed): ask the world first.
  let settlement: ChangeSettlement = step.intent.attempts > 0 ? settleChangeFromStatus(step.intent, await readBooking(step)) : { kind: "retry" };
  while (settlement.kind === "retry") {
    if (!(await advanced(step, attemptStarted(step.intent, nowMs(step))))) return reread(step);
    const { reading, reply } = await sendChange(step);
    settlement = reading.kind === "fail" ? reading : settleChangeFromStatus(step.intent, await readBooking(step), reply);
  }
  return recorded(step, settlement);
}
