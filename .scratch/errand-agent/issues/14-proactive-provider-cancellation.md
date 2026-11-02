# 14: When a provider cancels, the agent notices, tells the user and rebooks only with fresh approval

**What to build:** The mock world can emit a simulated provider-cancelled event. The agent handles it without a user prompt: it decides whether to notify (for example, not for a past or already-cancelled booking). If it notifies, it messages the user in their session and in the bell and Alerts widget. It searches for a replacement within the user's current preferences, excluding the provider who cancelled, and shows a fresh approval card. Each event is processed once, even if it is delivered twice.

**Blocked by:** 07, 11, 13

**Status:** ready-for-agent

- [ ] Eval "proactive cancellation": the user is notified, the replacement fits stored preferences, the cancelling provider isn't offered, and no rebooking happens without a new click
- [ ] Eval: a duplicate event gives one notification and one proposal
- [ ] Eval: a cancellation event for a past booking produces no notification
- [ ] The Alerts widget and the bell show the cancellation and link to the chat
