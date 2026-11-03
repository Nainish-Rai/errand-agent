# 19: Traces, context logs and costs are for operators only; people see only their own sessions

**What to build:** The person using the app no longer sees run traces, the context log, token counts or model costs. Those move to an operator console that only an operator identity can open. The server refuses the data to anyone else, so hiding it in the UI is not the only protection. Every session-scoped route also checks that the session belongs to the caller. Each time an operator opens a session's trace, that access is recorded.

**Blocked by:** None. It touches the chat UI that 10 also edits; rebase onto 10 when it merges.

**Status:** ready-for-agent

- [ ] The person's chat has no trace toggle, waterfall, token count or cost. "Show memory" (inspect, correct, forget) stays.
- [ ] Operator identity comes from the auth context: a configured operator id list or an operator credential read at runtime. It is never taken from the request body, a query flag or the client. Without it, the trace and context routes answer 404 for any session.
- [ ] Every session-scoped route (errand, trace, context, proposals, intents, generated-UI data) answers 404 when the session isn't the caller's. An eval or test proves user A can't read user B's session.
- [ ] An operator console (`/ops`) lists sessions and shows one session read-only: the transcript, the trace waterfall and the context log side by side. This is the view the demo recording uses.
- [ ] Each operator read of a session's trace or context is written to an audit record (operator, session, time) and is visible in the console.
- [ ] The trace-panel and context-budget suites move to the console. A new suite proves the person's chat shows no trace and that the trace API refuses the person.
