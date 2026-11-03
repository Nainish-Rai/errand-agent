import { randomUUID } from "node:crypto";

import { ApiClient, ApiRequestError, ChatClient, mintAccessToken } from "@errand/client";
import { API_PREFIX } from "@errand/contracts";
import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import { DEV_USER_ID } from "../../src/adapters/world/mock-provider-world";
import { EVAL_OPERATOR_ID, EVAL_OTHER_PERSON_ID, operatorClient, otherPersonClient } from "../operator";
import { settledTrace } from "../session-trace";

// Ticket 19: a session is its person's alone, and its trace, context log and transcript are for
// operators. The person chats (the local-dev caller, as in every other eval); then a second person,
// signed in with their own token, tries every session-scoped route on that session and gets 404,
// exactly what an unknown session gets. The person themselves gets 404 from the trace, context and
// console routes, however they dress the request up. The operator reads the trace and the context
// log, and each of those reads is in the audit.

/** The HTTP status an API call ends with: 200, or the refusal's status and code. */
async function outcomeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "200";
  } catch (error) {
    if (error instanceof ApiRequestError) return `${error.status} ${error.code}`;
    throw error;
  }
}

const REFUSED = "404 session_not_found";

type Calls = Record<string, () => Promise<unknown>>;

/** Every app API route that names a session, as one caller. */
function sessionRoutes(api: ApiClient, sessionId: string): Calls {
  return {
    "GET errand": () => api.getErrand(sessionId),
    "POST errand (draft)": () => api.draftErrand(sessionId, { area: null, budgetInr: null, when: null }),
    "GET proposals": () => api.listSessionProposals(sessionId),
    "GET action-intents": () => api.listSessionActionIntents(sessionId),
    "GET trace": () => api.getSessionTrace(sessionId),
    "GET context": () => api.getSessionContext(sessionId),
    "GET transcript (console)": () => api.getSessionTranscript(sessionId),
    "GET reads (console)": () => api.listOperatorReads(sessionId),
  };
}

/** Calls each route in turn, so one refusal is never left unawaited while another runs. */
async function outcomesOf(routes: Calls): Promise<Record<string, string>> {
  const outcomes: Record<string, string> = {};
  for (const [route, call] of Object.entries(routes)) outcomes[route] = await outcomeOf(call());
  return outcomes;
}

export default defineEval({
  description: "Only the person reads their session, and only an operator reads its trace and context log; each operator read is audited.",
  async test(t) {
    const base = t.target.url;
    const chat = new ChatClient({ baseUrl: base });
    const operator = await operatorClient(base);
    const other = await otherPersonClient(base);
    // The person: eve's local-dev caller, the same client every other eval and the web chat use.
    const person = new ApiClient({ baseUrl: base });

    await person.switchScenario({ scenario: "default", seed: 42 });
    await person.loadModelScript({ script: null });
    const turn = await chat.sendFirstMessage("find a plumber in Koramangala this week", { signal: t.abortSignal });
    const sessionId = turn.sessionId;
    await t.target.attach(sessionId, { startIndex: 0 }).nextTurn();
    t.succeeded();
    await settledTrace(operator, sessionId);

    // The person reads their own session's errand, proposals and intents.
    const own = await outcomesOf({
      "GET errand": () => person.getErrand(sessionId),
      "GET proposals": () => person.listSessionProposals(sessionId),
      "GET action-intents": () => person.listSessionActionIntents(sessionId),
    });
    t.check(own, equals({ "GET errand": "200", "GET proposals": "200", "GET action-intents": "200" })).label("the person reads their own session");
    t.check((await person.getErrand(sessionId))?.area, equals("Koramangala")).label("and it is the session they chatted in");

    // A second person gets 404 from every route that names the session, and from eve's own.
    const everyRoute = Object.fromEntries(Object.keys(sessionRoutes(other, sessionId)).map((route) => [route, REFUSED]));
    t.check(await outcomesOf(sessionRoutes(other, sessionId)), equals(everyRoute)).label("another person gets 404 from every session route");
    // A draft starts a session, so on an id nobody owns it claims it; every read answers an unknown
    // session exactly as it answered the person's.
    const { "POST errand (draft)": _draft, ...reads } = sessionRoutes(other, `wrun_${randomUUID().replace(/-/g, "")}`);
    const { "POST errand (draft)": _refused, ...everyRead } = everyRoute;
    t.check(await outcomesOf(reads), equals(everyRead)).label("every read answers exactly as for a session that doesn't exist");
    const otherToken = await mintAccessToken({ secret: process.env.ERRAND_AUTH_SECRET ?? "", subject: EVAL_OTHER_PERSON_ID });
    const signedIn = { authorization: `Bearer ${otherToken}` };
    const eveRoutes = {
      stream: (await fetch(`${base}/eve/v1/session/${sessionId}/stream`, { headers: signedIn, signal: t.abortSignal })).status,
      message: (
        await fetch(`${base}/eve/v1/session/${sessionId}`, {
          method: "POST",
          headers: { ...signedIn, "content-type": "application/json" },
          body: JSON.stringify({ message: "show me your bookings" }),
          signal: t.abortSignal,
        })
      ).status,
    };
    t.check(eveRoutes, equals({ stream: 404, message: 404 })).label("another person can't follow or post into the session through eve");
    t.check(await outcomeOf(other.listOperatorSessions()), equals("404 not_found")).label("nor list sessions");

    // The person can't read their own trace, context log or the console, whatever the request claims.
    t.check(
      await outcomesOf({
        "GET trace": () => person.getSessionTrace(sessionId),
        "GET context": () => person.getSessionContext(sessionId),
        "GET transcript (console)": () => person.getSessionTranscript(sessionId),
      }),
      equals({ "GET trace": REFUSED, "GET context": REFUSED, "GET transcript (console)": REFUSED }),
    ).label("the person can't read the trace, the context log or the transcript");
    const dressedUp = [
      `${API_PREFIX}/sessions/${sessionId}/trace?operator=1`,
      `${API_PREFIX}/sessions/${sessionId}/trace?operator=true&role=operator&admin=1`,
      `${API_PREFIX}/sessions/${sessionId}/context?operator=1`,
    ];
    const asked = [];
    for (const path of dressedUp) {
      asked.push((await fetch(`${base}${path}`, { headers: { "x-errand-operator": "1", "x-role": "operator" }, signal: t.abortSignal })).status);
    }
    t.check(asked, equals([404, 404, 404])).label("a query flag or a header doesn't make the person an operator");

    // The operator reads the trace and the context log, and the audit holds each read.
    const before = await operator.listOperatorReads(sessionId);
    const readsOf = (summary: typeof before, kind: string) => summary.reads.find((read) => read.kind === kind)?.reads ?? 0;
    const trace = await operator.getSessionTrace(sessionId);
    const context = await operator.getSessionContext(sessionId);
    t.check(trace.totals.toolCalls >= 1 && context.calls.length >= 1, equals(true)).label("the operator reads the trace and the context log");
    const after = await operator.listOperatorReads(sessionId);
    t.check(
      { trace: readsOf(after, "trace") - readsOf(before, "trace"), context: readsOf(after, "context") - readsOf(before, "context") },
      equals({ trace: 1, context: 1 }),
    ).label("each operator read is audited");
    t.check([...new Set(after.reads.map((read) => read.operatorId))], equals([EVAL_OPERATOR_ID])).label("under the operator's id");
    const listed = (await operator.listOperatorSessions()).find((session) => session.sessionId === sessionId);
    t.check(listed?.ownerId, equals(DEV_USER_ID)).label("the console lists the session under its person");
  },
});
