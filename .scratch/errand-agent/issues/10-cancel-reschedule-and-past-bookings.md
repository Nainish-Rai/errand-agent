# 10: Cancel, reschedule and "same as last time", each behind its own approval card

**What to build:** "Move my AC servicing to Saturday" finds the booking through `list_bookings` and shows a reschedule card with the old time next to the new one. "Cancel it" shows a cancellation card that includes any fee. "Book the same electrician as last time, but not before 10 a.m." finds the past provider and applies the time constraint. Cancel and reschedule go through the same proposal, grant and ledger path as booking. A 503 on cancel is retried with the same key, and the agent reports "cancelled" only once the status confirms it. A `slot_conflict` on reschedule gets alternative slots and a fresh card.

**Blocked by:** 05, 07

**Status:** ready-for-agent

- [x] Eval "reschedule happy path": a card with old and new times, the click, then exactly one reschedule
- [x] Eval "reschedule slot conflict": no change, alternatives offered, and a new approval needed
- [x] Eval "cancel 503 then success": the retry uses the same key, there is one cancellation, and the success claim comes only after the status check
- [x] Eval "same electrician as last time": the right provider is proposed and no slot before 10:00 is offered
- [x] No cancel or reschedule happens without a consumed matching grant (global invariant)
