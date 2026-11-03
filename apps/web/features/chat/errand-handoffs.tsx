"use client";

import type { ErrandHandoffView, GetErrandHandoffsResponse, HandoffOriginView } from "@errand/contracts";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { appApi } from "./backend";

// The chat's side of its New errand cards (ticket 24), read once from the backend so a reload shows
// the same thing: how each card was settled, and the chat this one was started from. A card's own
// tap answers with its settlement, which is merged in here.

interface ErrandHandoffs {
  readonly sessionId: string;
  /** False until the first read answers: a card must not flash before it turns into its moved line. */
  readonly loaded: boolean;
  readonly settled: ReadonlyMap<string, ErrandHandoffView>;
  readonly startedFrom: HandoffOriginView | null;
  readonly record: (handoff: ErrandHandoffView) => void;
  /** New errand cards still waiting for Start or Not now, so the composer can keep its Send quiet. */
  readonly openCards: number;
  readonly markOpen: (toolCallId: string, open: boolean) => void;
}

const ErrandHandoffsContext = createContext<ErrandHandoffs | undefined>(undefined);

export function ErrandHandoffsProvider({ sessionId, children }: { readonly sessionId: string; readonly children: ReactNode }) {
  const [read, setRead] = useState<GetErrandHandoffsResponse>();
  const [settled, setSettled] = useState<ReadonlyMap<string, ErrandHandoffView>>(new Map());

  useEffect(() => {
    const controller = new AbortController();
    appApi.getErrandHandoffs(sessionId, { signal: controller.signal }).then(
      (body) => {
        setRead(body);
        setSettled((mine) => new Map([...body.settled.map((handoff) => [handoff.toolCallId, handoff] as const), ...mine]));
      },
      // Unreadable reads as "nothing settled yet": the cards stay usable and the backend settles each once.
      () => !controller.signal.aborted && setRead({ settled: [], startedFrom: null }),
    );
    return () => controller.abort();
  }, [sessionId]);

  const [openCards, setOpenCards] = useState<ReadonlySet<string>>(new Set());
  const markOpen = useCallback(
    (toolCallId: string, open: boolean) =>
      setOpenCards((cards) => {
        if (cards.has(toolCallId) === open) return cards;
        const next = new Set(cards);
        if (open) next.add(toolCallId);
        else next.delete(toolCallId);
        return next;
      }),
    [],
  );
  const record = useCallback((handoff: ErrandHandoffView) => setSettled((mine) => new Map(mine).set(handoff.toolCallId, handoff)), []);
  const value = useMemo(
    () => ({ sessionId, loaded: read !== undefined, settled, startedFrom: read?.startedFrom ?? null, record, openCards: openCards.size, markOpen }),
    [sessionId, read, settled, record, openCards, markOpen],
  );
  return <ErrandHandoffsContext.Provider value={value}>{children}</ErrandHandoffsContext.Provider>;
}

export function useErrandHandoffs(): ErrandHandoffs {
  const handoffs = useContext(ErrandHandoffsContext);
  if (handoffs === undefined) throw new Error("useErrandHandoffs needs an ErrandHandoffsProvider above it.");
  return handoffs;
}

const SERVICE_WORDS: Readonly<Record<NonNullable<HandoffOriginView["service"]>, string>> = {
  plumber: "plumber",
  electrician: "electrician",
  ac_servicing: "AC servicing",
  carpenter: "carpenter",
  cleaner: "cleaning",
};

/** "your Indiranagar plumber chat", or "your earlier chat" when its errand wasn't known. */
function originLabel(origin: HandoffOriginView): string {
  const words = [origin.area, origin.service === null ? null : SERVICE_WORDS[origin.service]].filter((word) => word !== null);
  return words.length === 0 ? "your earlier chat" : `your ${words.join(" ")} chat`;
}

/** Whether a New errand card waits on the person: the composer's Send then stays quiet, not lime. */
export function useHasOpenNewErrandCard(): boolean {
  return useErrandHandoffs().openCards > 0;
}

/** A link line in the thread: what happened, then Open. */
export function HandoffLine({ children, href, label }: { readonly children: ReactNode; readonly href: string; readonly label: string }) {
  return (
    <p className="m-0 flex items-center gap-1.5 text-xs text-fg-3">
      <span>{children}</span>
      <span aria-hidden>·</span>
      <Link
        aria-label={label}
        href={href}
        className="rounded-control font-medium text-fg underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Open
      </Link>
    </p>
  );
}

/** At the top of a chat started from a New errand card: where it came from. */
export function StartedFromLine() {
  const { startedFrom } = useErrandHandoffs();
  if (startedFrom === null) return null;
  const label = originLabel(startedFrom);
  return (
    <div className="pb-2">
      <HandoffLine href={`/chat/${encodeURIComponent(startedFrom.sessionId)}`} label={`Open ${label}`}>
        Started from {label}
      </HandoffLine>
    </div>
  );
}
