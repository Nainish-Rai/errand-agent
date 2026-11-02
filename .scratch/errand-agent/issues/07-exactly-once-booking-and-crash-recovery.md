# 07: Exactly-once bookings across retries, timeouts, repeated confirmations and restarts

**What to build:** Core's action ledger records each intent, keyed by the grant-derived idempotency key, before calling `book`. If the call times out, the agent checks `get_booking_status`. If that shows a booking, the agent reports success. If not, it retries with the same key, up to a limit. If the outcome is still unknown, the chat shows a "verifying" state and promises an update. `slot_taken` gets a plain explanation plus the next options. At startup and at the start of every turn, a reconciler resolves any pending intents. The mock world enforces idempotency too: the same key with the same request returns the original result, and the same key with different parameters is a conflict.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Eval "timeout after success (booked)": no retry happens, `get_booking_status` confirms the booking, and exactly one booking exists
- [ ] Eval "timeout after success (not booked)": the retry uses the same key and exactly one booking exists
- [ ] Eval "slot taken": no booking, alternatives are offered, and a new approval is needed for the alternative
- [ ] Eval "repeated confirmation": two clicks and two "yes" messages still give one booking
- [ ] Eval "restart mid-booking": the process is really killed between sending `book` and recording its response. After restart, reconciliation leaves exactly one booking and the user gets the right message
- [ ] The global invariants "at most one booking per grant" and "no booked claim without verification" are now real
