import { defineInstrumentation } from "eve/instrumentation";

import { container } from "../../src/composition/container";
import { reconcilePendingActions } from "../../src/core/use-cases/reconcile-pending-actions";
import { settleInterruptedRuns } from "../../src/core/use-cases/settle-run";
import { presentRunOutcome } from "../lib/run-outcome-presenter";
import { turnSpanId } from "../lib/trace-place";

// Backend startup: before any turn runs, the reconciler settles every booking intent the last
// process left pending or unknown. That covers a backend killed between sending `book` and
// recording its reply: the world kept the booking, the ledger kept the intent, and the status for
// the intent's key says which booking it made. Each settlement waits in the ledger as a booking
// update for its session (see agent/instructions/booking-updates.ts and the chat's intents route).
// Then the runs the last process died in get their typed outcome, which they never reached.
//
// An instrumentation file is the one authored module eve loads only at runtime, and `setup` runs
// once at server start, before any event arrives.

export default defineInstrumentation({
  async setup() {
    try {
      const { resolved, unsettled } = await reconcilePendingActions(container().bookingDependencies, {});
      if (resolved.length + unsettled.length > 0) {
        console.info("booking intents reconciled at startup", { resolved: resolved.length, unsettled: unsettled.length });
      }
    } catch (error) {
      // Startup goes on; the start of the next turn in each session tries again.
      console.error("booking reconciliation failed at startup", { error });
    }
    try {
      const interrupted = await settleInterruptedRuns(container().settleRunDependencies, {
        placeOf: (run) => ({ traceId: run.sessionId, sessionId: run.sessionId, spanId: turnSpanId(run.sessionId, run.turnId) }),
        describe: presentRunOutcome,
      });
      if (interrupted.length > 0) console.info("interrupted runs settled at startup", { runs: interrupted.length });
    } catch (error) {
      console.error("settling interrupted runs failed at startup", { error });
    }
  },
});
