# 05: Book a provider through an approval card that only a user click can authorise

**What to build:** The user picks an option. The agent holds the slot and calls *propose*. Core snapshots the live held quote, not the model's arguments, into a proposal with a fingerprint covering action, provider, slot, price and hold. The chat renders an approval card with provider, date and time in IST, address, price and cancellation terms, and buttons for Approve (showing the price), Other options and Decline. Clicking Approve calls the approval endpoint, which mints a single-use grant for that fingerprint. That endpoint is the only place a grant can be created. The agent then calls *execute proposal*. Core checks the grant, calls `book` with an idempotency key derived from the grant, verifies the outcome with `get_booking_status`, and only then does the agent say "Booked" with the booking ID. The model never has direct access to `book`.

**Blocked by:** 04, 18

**Status:** done (PR #10)

- [x] Eval "happy booking": exactly one booking exists in the world, it matches the approved fingerprint, and its grant is consumed
- [x] Eval: a user who types "yes" without clicking gets the card shown again, and no booking is made
- [x] Eval: Decline creates no booking and releases the hold
- [x] Core tests: a grant is single-use, expires no later than the hold, and can't be created from model output
- [x] The global invariant "no side effect without a consumed matching grant" is now real and passes on every scenario
- [ ] The approval card is the design system's fixed Approval card (pending, approving, approved, voided and expired states, built on the agents-ui question-card), shown inside the assistant-ui thread

Not met as written: the card is ticket 18's fixed `ApprovalCard` (on `features/trust/trust-surface`), shown inside the assistant-ui thread with all its states; there is no agents-ui question-card in the repo to build it on. The voided state renders but is first reached in ticket 06.
