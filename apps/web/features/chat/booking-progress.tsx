"use client";

import { VERIFYING_PROMISE, type ActionIntentView, type ErrandOption, type ExecuteProposalOutput } from "@errand/contracts";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { ToolCall } from "@/components/tool-call";
import { ProviderChoiceCards } from "@/features/generated-ui";
import { BookingReceipt, VerificationBanner, type ReceiptBooking } from "@/features/trust";

import { appApi } from "./backend";
import { choiceFromOption } from "./provider-results";
import { useSendText } from "./send-text";

// A booking's progress from the action ledger (GET /sessions/:id/action-intents): while `book` is
// in flight and after it timed out, the chat shows "Checking with the provider…" until the world's
// status settles the intent, then the receipt. The ledger is the only source: nothing here decides
// that something is booked.

const POLL_MS = 700;

const BookingSessionContext = createContext<string | undefined>(undefined);

/** The chat session whose booking intents the execution parts follow. */
export function BookingSessionProvider({ sessionId, children }: { readonly sessionId: string; readonly children: ReactNode }) {
  return <BookingSessionContext.Provider value={sessionId}>{children}</BookingSessionContext.Provider>;
}

/** The session's intents, read every POLL_MS while `follow` is true. */
function useSessionIntents(follow: boolean): readonly ActionIntentView[] | undefined {
  const sessionId = useContext(BookingSessionContext);
  const [intents, setIntents] = useState<readonly ActionIntentView[]>();
  useEffect(() => {
    if (sessionId === undefined) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        setIntents(await appApi.listSessionActionIntents(sessionId, { signal: controller.signal }));
      } catch {
        // A missed read is retried on the next tick.
      }
      if (follow && !controller.signal.aborted) timer = setTimeout(() => void read(), POLL_MS);
    };
    void read();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [sessionId, follow]);
  return intents;
}

function isUnresolved(intent: ActionIntentView): boolean {
  return intent.state === "pending" || intent.state === "unknown";
}

/** The book the provider hasn't answered: a timeout on record, or a retry with the same key under way. */
function isBeingChecked(intent: ActionIntentView): boolean {
  return intent.state === "unknown" || (intent.state === "pending" && intent.attempts > 1);
}

/**
 * A booking cannot be undone; the receipt's Reschedule and Cancel booking ask the agent, which answers
 * with a fresh approval card. Neither changes anything by itself.
 */
export function receiptActions(send: (text: string) => Promise<void> | void, bookingId: string) {
  return {
    onReschedule: () => void send(`I'd like to move booking ${bookingId} to another time.`),
    onCancelBooking: () => void send(`Please cancel booking ${bookingId}.`),
  };
}

/** The tracker's steps after Approve (v3 "After approval: checking with provider"), present tense while running. */
function ApprovedStep() {
  return <ToolCall state="done" label="Checked your approval" detail="Step 1 of 2" />;
}

/**
 * execute_proposal while it runs: the tracker's rows, the approval checked and the provider being
 * asked; once `book` timed out, the verification banner with the same steps, taking longer.
 */
export function RunningExecution() {
  const intents = useSessionIntents(true);
  const inFlight = intents?.filter(isUnresolved).at(-1);
  if (inFlight !== undefined && isBeingChecked(inFlight)) {
    return (
      <div className="my-3">
        <VerificationBanner
          promise={VERIFYING_PROMISE}
          steps={
            <>
              <ApprovedStep />
              <ToolCall state="running" label="Checking with provider" detail="Taking longer than usual" />
            </>
          }
        />
      </div>
    );
  }
  return (
    <div className="my-3 flex flex-col gap-1.5" aria-live="polite">
      <ApprovedStep />
      <ToolCall state="running" label="Asking the provider" detail="Step 2 of 2" />
    </div>
  );
}

/**
 * execute_proposal said verifying: the banner stays until the ledger settles the intent (the
 * reconciler asks the world with the same key), then the receipt, or why nothing was booked.
 */
export function VerifyingExecution({ output, booking }: { readonly output: ExecuteProposalOutput; readonly booking: ReceiptBooking }) {
  const send = useSendText();
  const proposalId = output.proposal?.proposalId;
  const [settled, setSettled] = useState(false);
  const intents = useSessionIntents(!settled);
  const intent = intents?.find((candidate) => candidate.proposalId === proposalId);
  const resolved = intent !== undefined && !isUnresolved(intent);
  useEffect(() => {
    if (resolved) setSettled(true);
  }, [resolved]);

  if (intent?.state === "confirmed" && intent.bookingId !== null) {
    return (
      <div className="my-3">
        <BookingReceipt booking={booking} state={{ status: "booked", bookingId: intent.bookingId }} {...receiptActions(send, intent.bookingId)} />
      </div>
    );
  }
  if (intent?.state === "failed") {
    return (
      <div className="my-3">
        <BookingReceipt booking={booking} state={{ status: "failed", reason: intent.notice ?? output.message }} />
      </div>
    );
  }
  return (
    <div className="my-3">
      <VerificationBanner
        promise={VERIFYING_PROMISE}
        steps={
          <>
            <ApprovedStep />
            <ToolCall state="running" label="Checking with provider" detail="Taking longer than usual" />
          </>
        }
      />
    </div>
  );
}

/**
 * After a taken slot: the next options core searched for, minus the slot that went. Picking one
 * is a new hold and a new card that needs its own tap.
 */
export function NextOptions({ options }: { readonly options: readonly ErrandOption[] }) {
  return <ProviderChoiceCards title="Next options" choices={options.map(choiceFromOption)} />;
}
