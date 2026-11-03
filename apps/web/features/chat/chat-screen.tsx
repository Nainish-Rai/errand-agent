"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { ChatClient, type ClientSession } from "@errand/client";
import { Brain, House } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MemoryPanel } from "@/features/memory-panel/memory-panel";
import { GeneratedUiHostProvider, GeneratedUiTheme } from "@/features/generated-ui";

import { appApi, backendUrl } from "./backend";
import { BookingSessionProvider } from "./booking-progress";
import { SendTextProvider } from "./send-text";
import { Thread } from "./thread";
import { useEveAssistantRuntime } from "./use-eve-assistant-runtime";

// The chat at /chat/[sessionId]. The memory panel opens in a right rail; below the lg breakpoint it
// overlays the chat instead of squeezing it. The run trace, the context log, token counts and costs
// are not here: they are for operators, in the console at /ops (ticket 19).

export type Rail = "memory";

/** Where a link can open the chat: a side panel, and a proposal's approval card to scroll to. */
export interface ChatEntry {
  readonly rail?: Rail;
  readonly proposalId?: string;
}

/** How long the card keeps its focus through re-renders before the page settles. */
const SETTLE_MS = 5_000;

/**
 * Scrolls to the proposal's approval card and focuses it once the replayed conversation has
 * rendered it: a link from "Waiting on you" opens the chat at the card. The replay can render the
 * card more than once, so until the page settles (or the person acts) a replaced card is focused again.
 */
function useFocusProposal(proposalId: string | undefined) {
  useEffect(() => {
    if (proposalId === undefined) return;
    const selector = `[data-proposal-id="${CSS.escape(proposalId)}"]`;
    let focused: HTMLElement | null = null;
    const focus = () => {
      const card = document.querySelector<HTMLElement>(selector);
      if (card === null || (card === focused && document.activeElement === card)) return;
      if (focused === null) card.scrollIntoView({ block: "center" });
      card.focus({ preventScroll: true });
      focused = card;
    };
    const observer = new MutationObserver(focus);
    const stop = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", stop, true);
      window.removeEventListener("keydown", stop, true);
    };
    const timer = window.setTimeout(stop, SETTLE_MS);
    window.addEventListener("pointerdown", stop, true);
    window.addEventListener("keydown", stop, true);
    observer.observe(document.body, { childList: true, subtree: true });
    focus();
    return stop;
  }, [proposalId]);
}

function MemoryToggle({ rail, onChange }: { readonly rail: Rail | undefined; readonly onChange: (rail: Rail | undefined) => void }) {
  const open = rail === "memory";
  return (
    <Button aria-pressed={open} size="sm" variant="outline" onClick={() => onChange(open ? undefined : "memory")}>
      <Brain />
      {open ? "Hide memory" : "Show memory"}
    </Button>
  );
}

function BoundThread({ session, entry }: { readonly session: ClientSession; readonly entry: ChatEntry }) {
  const { runtime, error, sendText, sessionId, activity } = useEveAssistantRuntime(session);
  const [rail, setRail] = useState<Rail | undefined>(entry.rail);
  useFocusProposal(entry.proposalId);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SendTextProvider value={sendText}>
        <GeneratedUiHostProvider host={{ api: appApi, send: sendText, sessionId }}>
        <GeneratedUiTheme>
        <div className="flex h-dvh">
          <div className="relative min-w-0 flex-1">
            {error !== undefined && (
              <p className="bg-danger/10 px-4 py-2 text-center text-sm" role="alert">
                {error.message}
              </p>
            )}
            <div className="absolute top-3 left-3 z-10 rounded-md bg-page">
              <Button asChild size="sm" variant="ghost">
                <Link href="/">
                  <House />
                  Home
                </Link>
              </Button>
            </div>
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-md bg-page">
              <ThemeToggle />
              <MemoryToggle rail={rail} onChange={setRail} />
            </div>
            <BookingSessionProvider sessionId={sessionId}>
              <Thread />
            </BookingSessionProvider>
          </div>
          {rail === "memory" && <MemoryPanel backendUrl={backendUrl} activity={activity} onClose={() => setRail(undefined)} />}
        </div>
        </GeneratedUiTheme>
        </GeneratedUiHostProvider>
      </SendTextProvider>
    </AssistantRuntimeProvider>
  );
}

function Unreachable({ failure }: { readonly failure: string }) {
  return (
    <p className="p-8 text-center text-fg-3" role="alert">
      {failure}
    </p>
  );
}

/** The chat's loading frame: the page's Suspense fallback and the wait for a new session, the same size as the chat. */
export function ChatLoading() {
  return (
    <div className="flex h-dvh items-center justify-center text-fg-3">
      <Spinner />
    </div>
  );
}

const chat = new ChatClient({ baseUrl: backendUrl });

/** A chat that already exists: eve replays its conversation and follows a turn still running. */
export function ChatScreen({ sessionId, entry }: { readonly sessionId: string; readonly entry: ChatEntry }) {
  const session = useMemo(() => chat.attachSession(sessionId), [sessionId]);
  return <BoundThread key={sessionId} session={session} entry={entry} />;
}

/** /chat: starts a session, then gives it its own address so a reload or a link returns to it. */
export function NewChatScreen({ entry }: { readonly entry: ChatEntry }) {
  const [session, setSession] = useState<ClientSession>();
  const [failure, setFailure] = useState<string>();
  // Strict Mode runs effects twice in development; one chat must get one session.
  const starting = useRef<Promise<ClientSession> | undefined>(undefined);

  useEffect(() => {
    starting.current ??= chat.startSession();
    starting.current.then(
      (started) => {
        window.history.replaceState(null, "", `/chat/${encodeURIComponent(started.id)}${window.location.search}`);
        setSession(started);
      },
      (error: unknown) => setFailure(`Can't reach the backend at ${backendUrl}: ${error instanceof Error ? error.message : String(error)}`),
    );
  }, []);

  if (failure !== undefined) return <Unreachable failure={failure} />;
  if (session === undefined) return <ChatLoading />;
  return <BoundThread session={session} entry={entry} />;
}
