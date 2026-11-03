# 06: Any change to price, slot or provider voids the approval

**What to build:** Between Approve and execution, core re-reads the live hold and recomputes the fingerprint. If the price, the slot or the provider differs, or the hold has expired, the grant is voided and nothing is booked. The agent tells the user what changed ("The price went from ₹899 to ₹1,050") and shows a fresh card. An expired hold is re-held and re-proposed.

**Blocked by:** 05

**Status:** done (PR #13)

- [x] Eval "price changed on hold": no booking is made against the old grant; a new card shows the new price; a booking happens only after the second click
- [x] Eval "slot changed after approval": same pattern
- [x] Eval "hold expired": `book` returns `hold_expired`, the agent re-holds and re-proposes, and nothing is booked without a fresh approval
- [x] The user-facing message names the old and new values
