"use client";

import { useAuiState } from "@assistant-ui/react";
import { ApiRequestError } from "@errand/client";
import { PROVIDER_UPDATE_PREFIX, type ErrandView, type SearchProvidersInput } from "@errand/contracts";
import { MessageSquarePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { appApi, chatBackend } from "./backend";
import { HandoffLine, useErrandHandoffs } from "./errand-handoffs";

// The New errand card (ticket 24). This chat's errand is booked, so a search for a different job
// was refused (`not_editable`); the card offers to carry that job to a new chat. Its fields are the
// refused search's arguments and the booked errand, never the model's text, and a tool result
// can't add a link or an action to it. Starting a new errand books and spends nothing, so the card
// needs no approval. "Start in a new chat" starts a session, saves the job as its errand before the
// first turn (as the home composer does), sends the person's own last message and moves there.

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

/**
 * Whether the refused search asks for another job than the booked one: another service, area or
 * dates. The agent re-searching the booked job itself gets the plain "already booked" line, not a card.
 */
export function isDifferentJob(search: SearchProvidersInput, errand: ErrandView): boolean {
  const service = search.service.trim().toLowerCase().replaceAll(/[\s-]+/g, "_");
  const area = search.area.trim().toLowerCase();
  const window = errand.timeWindow;
  return (
    service !== errand.service ||
    area !== errand.area?.toLowerCase() ||
    window === null ||
    search.date_range.from !== window.from ||
    search.date_range.to !== window.to
  );
}

/**
 * The card's place once it is settled: the line opens its height where the card was (Lime's layout motion,
 * `animate-open` on --dur-base), so the thread below moves smoothly. Reduced motion zeroes the token: instant.
 */
function SettledLine({ children }: { readonly children: ReactNode }) {
  return (
    <div data-slot="new-errand-settled" className="grid animate-open grid-rows-[1fr]">
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
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
  const { sessionId, loaded, settled, record, markOpen } = useErrandHandoffs();
  const request = usePersonsRequest();
  const router = useRouter();
  const [busy, setBusy] = useState<"start" | "dismiss">();
  const [problem, setProblem] = useState<string>();
  const handoff = settled.get(toolCallId);
  const open = loaded && handoff === undefined;

  // While the card waits, Start in a new chat is the view's one lime action: the composer's Send stays quiet.
  useEffect(() => {
    if (!open) return;
    markOpen(toolCallId, true);
    return () => markOpen(toolCallId, false);
  }, [open, toolCallId, markOpen]);

  async function start() {
    setBusy("start");
    setProblem(undefined);
    try {
      const session = await chatBackend.startSession();
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
    <div className="my-2">
      {handoff?.kind === "moved" ? (
        <SettledLine>
          <HandoffLine href={`/chat/${encodeURIComponent(handoff.toSessionId)}`} label="Open the new chat">
            Moved to a new chat
          </HandoffLine>
        </SettledLine>
      ) : handoff?.kind === "dismissed" ? (
        <SettledLine>
          <p className="m-0 text-xs text-fg-3">New errand not started.</p>
        </SettledLine>
      ) : (
        <section
          aria-labelledby={`new-errand-${toolCallId}`}
          aria-busy={busy !== undefined || undefined}
          data-slot="new-errand"
          className="flex w-full min-w-0 animate-rise flex-col gap-3 rounded-panel bg-surface p-4 text-sm text-fg"
        >
          <header className="flex flex-col gap-1">
            <h3 id={`new-errand-${toolCallId}`} className="m-0 flex items-center gap-2 text-sm font-semibold text-fg">
              <MessageSquarePlus aria-hidden className="size-4 text-fg-3" />
              New errand
            </h3>
            <p className="m-0 text-xs text-fg-3">{bookingNote(errand)} This one starts in its own chat.</p>
          </header>
          <dl className="m-0 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5">
            <Field label="Job" value={serviceLabel(search.service)} />
            <Field label="Where" value={search.area} />
            <Field label="When" value={whenLabel(search.date_range)} />
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === "start"} disabled={busy !== undefined} onClick={() => void start()}>
              {busy === "start" ? "Starting…" : "Start in a new chat"}
            </Button>
            <Button variant="ghost" loading={busy === "dismiss"} disabled={busy !== undefined} onClick={() => void dismiss()}>
              Not now
            </Button>
          </div>
          {problem !== undefined && (
            <p role="alert" className="m-0 text-xs text-danger-text">
              {problem}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
