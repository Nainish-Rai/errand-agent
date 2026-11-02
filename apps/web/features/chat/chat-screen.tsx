"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { ChatClient, DEFAULT_BACKEND_URL, type ClientSession } from "@errand/client";
import { Activity } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TracePanel } from "@/features/trace-panel/trace-panel";

import { Thread } from "./thread";
import { useEveAssistantRuntime } from "./use-eve-assistant-runtime";

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL;

function BoundThread({ session }: { readonly session: ClientSession }) {
  const { runtime, error } = useEveAssistantRuntime(session);
  const [traceOpen, setTraceOpen] = useState(true);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
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
        {traceOpen && <TracePanel backendUrl={backendUrl} session={session} onClose={() => setTraceOpen(false)} />}
      </div>
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
