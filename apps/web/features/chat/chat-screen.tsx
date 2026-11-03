"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { ChatClient, type ClientSession } from "@errand/client";
import { Activity, Brain, House } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Spinner } from "@/components/ui/spinner";
import { MemoryPanel } from "@/features/memory-panel/memory-panel";
import { TracePanel } from "@/features/trace-panel/trace-panel";

import { backendUrl } from "./backend";
import { SendTextProvider } from "./send-text";
import { Thread } from "./thread";
import { useEveAssistantRuntime } from "./use-eve-assistant-runtime";

// The chat at /chat/[sessionId]. The side panels share one right rail: the trace or the memory,
// never both, so the conversation keeps its width. Below the lg breakpoint the rail overlays the
// chat instead of squeezing it.

export type Rail = "trace" | "memory";

/** Where a link can open the chat: a side panel, and a proposal's approval card to scroll to. */
export interface ChatEntry {
  readonly rail?: Rail;
  readonly proposalId?: string;
}

/**
 * Scrolls to the proposal's approval card and focuses it once the replayed conversation has
 * rendered it: a link from "Waiting on you" opens the chat at the card.
 */
function useFocusProposal(proposalId: string | undefined) {
  useEffect(() => {
    if (proposalId === undefined) return;
    const selector = `[data-proposal-id="${CSS.escape(proposalId)}"]`;
    const focus = (): boolean => {
      const card = document.querySelector<HTMLElement>(selector);
      if (card === null) return false;
      card.scrollIntoView({ block: "center" });
      card.focus({ preventScroll: true });
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [proposalId]);
}

function RailToggle({ rail, shows, onChange }: { readonly rail: Rail | undefined; readonly shows: Rail; readonly onChange: (rail: Rail | undefined) => void }) {
  const open = rail === shows;
  const noun = shows === "trace" ? "trace" : "memory";
  return (
    <Button aria-pressed={open} size="sm" variant="outline" onClick={() => onChange(open ? undefined : shows)}>
      {shows === "trace" ? <Activity /> : <Brain />}
      {open ? `Hide ${noun}` : `Show ${noun}`}
    </Button>
  );
}

function BoundThread({ session, entry }: { readonly session: ClientSession; readonly entry: ChatEntry }) {
  const { runtime, error, sendText, sessionId, activity } = useEveAssistantRuntime(session);
  const [rail, setRail] = useState<Rail | undefined>(entry.rail ?? "trace");
  useFocusProposal(entry.proposalId);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SendTextProvider value={sendText}>
        <div className="flex h-dvh">
          <div className="relative min-w-0 flex-1">
            {error !== undefined && (
              <p className="bg-destructive/10 px-4 py-2 text-center text-sm" role="alert">
                {error.message}
              </p>
            )}
            <div className="absolute top-3 left-3 z-10">
              <Button asChild size="sm" variant="ghost">
                <Link href="/">
                  <House />
                  Home
                </Link>
              </Button>
            </div>
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
              <ThemeToggle />
              {/* One rail, two views: pressing the other view switches the rail, pressing the open one closes it. */}
              <ButtonGroup aria-label="Side panel">
                <RailToggle rail={rail} shows="memory" onChange={setRail} />
                <RailToggle rail={rail} shows="trace" onChange={setRail} />
              </ButtonGroup>
            </div>
            <Thread />
          </div>
          {rail === "memory" && <MemoryPanel backendUrl={backendUrl} activity={activity} onClose={() => setRail(undefined)} />}
          {rail === "trace" && <TracePanel backendUrl={backendUrl} sessionId={sessionId} activity={activity} onClose={() => setRail(undefined)} />}
        </div>
      </SendTextProvider>
    </AssistantRuntimeProvider>
  );
}

function Unreachable({ failure }: { readonly failure: string }) {
  return (
    <p className="p-8 text-center text-muted-foreground" role="alert">
      {failure}
    </p>
  );
}

function Loading() {
  return (
    <div className="flex h-dvh items-center justify-center text-muted-foreground">
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
  if (session === undefined) return <Loading />;
  return <BoundThread session={session} entry={entry} />;
}
