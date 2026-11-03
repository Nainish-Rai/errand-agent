"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { ChatClient, DEFAULT_BACKEND_URL, type ClientSession } from "@errand/client";
import { Activity, Brain } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MemoryPanel } from "@/features/memory-panel/memory-panel";
import { TracePanel } from "@/features/trace-panel/trace-panel";

import { backendUrl } from "./backend";
import { SendTextProvider } from "./send-text";
import { Thread } from "./thread";
import { useEveAssistantRuntime } from "./use-eve-assistant-runtime";

function BoundThread({ session }: { readonly session: ClientSession }) {
  const { runtime, error, sendText, sessionId, activity } = useEveAssistantRuntime(session);
  const [traceOpen, setTraceOpen] = useState(true);
  const [memoryOpen, setMemoryOpen] = useState(false);
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
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
            <ThemeToggle />
            <Button
              aria-pressed={memoryOpen}
              size="sm"
              variant="outline"
              onClick={() => setMemoryOpen((open) => !open)}
            >
              <Brain />
              {memoryOpen ? "Hide memory" : "Show memory"}
            </Button>
            <Button
              aria-pressed={traceOpen}
              size="sm"
              variant="outline"
              onClick={() => setTraceOpen((open) => !open)}
            >
              <Activity />
              {traceOpen ? "Hide trace" : "Show trace"}
            </Button>
          </div>
          <Thread />
        </div>
        {memoryOpen && <MemoryPanel backendUrl={backendUrl} activity={activity} onClose={() => setMemoryOpen(false)} />}
        {traceOpen && (
          <TracePanel backendUrl={backendUrl} sessionId={sessionId} activity={activity} onClose={() => setTraceOpen(false)} />
        )}
      </div>
      </SendTextProvider>
    </AssistantRuntimeProvider>
  );
}

export function ChatScreen() {
  const [session, setSession] = useState<ClientSession>();
  const [failure, setFailure] = useState<string>();
  // Strict Mode runs effects twice in development; one chat must get one session.
  const starting = useRef<Promise<ClientSession> | undefined>(undefined);

  useEffect(() => {
    starting.current ??= new ChatClient({ baseUrl: backendUrl }).startSession();
    starting.current.then(setSession, (error: unknown) =>
      setFailure(`Can't reach the backend at ${backendUrl}: ${error instanceof Error ? error.message : String(error)}`),
    );
  }, []);

  if (failure !== undefined) {
    return (
      <p className="p-8 text-center text-muted-foreground" role="alert">
        {failure}
      </p>
    );
  }
  if (session === undefined) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  return <BoundThread session={session} />;
}
