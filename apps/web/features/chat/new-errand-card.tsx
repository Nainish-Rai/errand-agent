"use client";

import { useAuiState } from "@assistant-ui/react";
import { ApiRequestError, ChatClient } from "@errand/client";
import { PROVIDER_UPDATE_PREFIX, type ErrandView, type SearchProvidersInput } from "@errand/contracts";
import { motion as limeMotion } from "@errand/design-tokens";
import { MessageSquarePlus } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { appApi, backendUrl } from "./backend";
import { HandoffLine, useErrandHandoffs } from "./errand-handoffs";

// The New errand card (ticket 24). This chat's errand is booked, so a search for a different job
// was refused (`not_editable`); the card offers to carry that job to a new chat. Its fields are the
// refused search's arguments and the booked errand, never the model's text, and a tool result
// can't add a link or an action to it. Starting a new errand books and spends nothing, so the card
// needs no approval. "Start in a new chat" starts a session, saves the job as its errand before the
// first turn (as the home composer does), sends the person's own last message and moves there.

const chat = new ChatClient({ baseUrl: backendUrl });

const SERVICE_LABELS: Readonly<Record<NonNullable<ErrandView["service"]>, string>> = {
  plumber: "Plumber",
  electrician: "Electrician",
  ac_servicing: "AC servicing",
  carpenter: "Carpenter",
  cleaner: "Cleaning",
};

/** The search names the service in the model's words; the catalog's ones read as labels. */
function serviceLabel(service: string): string {
  const known = SERVICE_LABELS[service as keyof typeof SERVICE_LABELS] as string | undefined;
  return known ?? service.replaceAll("_", " ");
}

const dayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function dayLabel(date: string): string {
  return dayFormat.format(new Date(`${date}T00:00:00Z`)).replace(",", "");
}

/** "Wed 4 Nov – Tue 10 Nov", or one day. */
function whenLabel(range: SearchProvidersInput["date_range"]): string {
  return range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
}

/** "Your plumber booking in Indiranagar stays as it is." */
function bookingNote(errand: ErrandView): string {
  const what = errand.service === null ? "booking" : `${SERVICE_LABELS[errand.service].toLowerCase()} booking`;
  return `Your ${what}${errand.area === null ? "" : ` in ${errand.area}`} stays as it is.`;
}

/** The person's own words that led to this card: the last message they typed before it. */
function usePersonsRequest(): string {
  return useAuiState(({ thread, message }) => {
    const at = thread.messages.findIndex((candidate) => candidate.id === message.id);
    const before = (at < 0 ? thread.messages : thread.messages.slice(0, at)).toReversed();
    for (const candidate of before) {
      if (candidate.role !== "user") continue;
      const text = candidate.content.map((part) => (part.type === "text" ? part.text : "")).join("").trim();
      // A provider update is the system's, never the person's words.
      if (text !== "" && !text.startsWith(PROVIDER_UPDATE_PREFIX)) return text;
    }
    return "";
  });
}

/** Lime's layout motion; reduced motion makes every change instant. */
function useCardTransition() {
  const reduced = useReducedMotion() === true;
  return {
    arrive: { duration: reduced ? 0 : limeMotion.base / 1_000, ease: limeMotion.easeOut },
    leave: { duration: reduced ? 0 : limeMotion.fast / 1_000, ease: limeMotion.easeIn },
  };
}

interface NewErrandCardProps {
  readonly toolCallId: string;
  readonly search: SearchProvidersInput;
  readonly errand: ErrandView;
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="contents">
      <dt className="text-fg-3">{label}</dt>
      <dd className="m-0 text-fg">{value}</dd>
    </div>
  );
}

export function NewErrandCard({ toolCallId, search, errand }: NewErrandCardProps) {
  const { sessionId, loaded, settled, record } = useErrandHandoffs();
  const request = usePersonsRequest();
  const router = useRouter();
  const transition = useCardTransition();
  const [busy, setBusy] = useState<"start" | "dismiss">();
  const [problem, setProblem] = useState<string>();
  const handoff = settled.get(toolCallId);

  async function start() {
    setBusy("start");
    setProblem(undefined);
    try {
      const session = await chat.startSession();
      // Awaited before the first message: the new chat's first turn must already see the job.
      const moved = await appApi.startNewErrand(sessionId, { toolCallId, toSessionId: session.id, search });
      if (moved.handoff.kind === "moved" && moved.handoff.toSessionId === session.id && request !== "") await session.send(request);
      record(moved.handoff);
      if (moved.handoff.kind === "moved") router.push(`/chat/${encodeURIComponent(moved.handoff.toSessionId)}`);
    } catch (error) {
      setProblem(error instanceof ApiRequestError ? error.message : "Couldn't start the new chat. Try again.");
      setBusy(undefined);
    }
  }

  async function dismiss() {
    setBusy("dismiss");
    setProblem(undefined);
    try {
      record(await appApi.dismissNewErrand(sessionId, { toolCallId }));
    } catch (error) {
      setProblem(error instanceof ApiRequestError ? error.message : "That didn't go through. Try again.");
    } finally {
      setBusy(undefined);
    }
  }

  // Until the chat's hand-offs are read, a card that already moved must not flash up.
  if (!loaded) return null;
  return (
    <motion.div layout transition={transition.arrive} className="my-2">
      <AnimatePresence initial={false} mode="popLayout">
        {handoff?.kind === "moved" ? (
          <motion.div key="moved" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transition.arrive }}>
            <HandoffLine href={`/chat/${encodeURIComponent(handoff.toSessionId)}`} label="Open the new chat">
              Moved to a new chat
            </HandoffLine>
          </motion.div>
        ) : handoff?.kind === "dismissed" ? (
          <motion.p key="dismissed" className="m-0 text-xs text-fg-3" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transition.arrive }}>
            New errand not started.
          </motion.p>
        ) : (
          <motion.section
            key="card"
            aria-labelledby={`new-errand-${toolCallId}`}
            aria-busy={busy !== undefined || undefined}
            className="overflow-hidden rounded-panel border border-line bg-surface text-sm"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: transition.arrive }}
            exit={{ opacity: 0, transition: transition.leave }}
          >
            <header className="flex items-center gap-2 px-3 pt-3">
              <MessageSquarePlus aria-hidden className="size-4 text-fg-3" />
              <h3 id={`new-errand-${toolCallId}`} className="m-0 text-sm font-semibold text-fg">
                New errand
              </h3>
            </header>
            <p className="m-0 px-3 pt-1 text-xs text-fg-3">{bookingNote(errand)} This one starts in its own chat.</p>
            <dl className="m-0 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 px-3 pt-3">
              <Field label="Job" value={serviceLabel(search.service)} />
              <Field label="Where" value={search.area} />
              <Field label="When" value={whenLabel(search.date_range)} />
            </dl>
            <div className="flex flex-wrap gap-2 px-3 pt-3 pb-3">
              <Button variant="primary" loading={busy === "start"} disabled={busy !== undefined} onClick={() => void start()}>
                {busy === "start" ? "Starting…" : "Start in a new chat"}
              </Button>
              <Button variant="ghost" loading={busy === "dismiss"} disabled={busy !== undefined} onClick={() => void dismiss()}>
                Not now
              </Button>
            </div>
            {problem !== undefined && (
              <p role="alert" className="m-0 px-3 pb-3 text-xs text-danger-text">
                {problem}
              </p>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
