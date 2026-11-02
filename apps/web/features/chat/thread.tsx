"use client";

import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { ArrowUp, Square } from "lucide-react";

import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";

import { ProviderResults } from "./provider-results";

const AssistantText: TextMessagePartComponent = ({ text, status }) => (
  <Markdown isAnimating={status.type === "running"}>{text}</Markdown>
);

const ToolActivity: ToolCallMessagePartComponent = ({ toolName, status }) => (
  <p className="my-1 text-sm text-muted-foreground">
    {status.type === "running" ? "Working: " : "Done: "}
    {toolName.replaceAll("_", " ")}
  </p>
);

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end py-2">
      <div className="max-w-[80%] rounded-2xl bg-secondary px-4 py-2 text-secondary-foreground">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="py-2">
      <MessagePrimitive.Parts
        components={{
          Text: AssistantText,
          tools: { by_name: { search_providers: ProviderResults }, Fallback: ToolActivity },
        }}
      />
    </MessagePrimitive.Root>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2">
      <ComposerPrimitive.Input
        aria-label="Message the errand agent"
        autoFocus
        className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 outline-none placeholder:text-muted-foreground"
        placeholder="Find a plumber in Koramangala this week…"
        rows={1}
      />
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <Button aria-label="Send" size="icon">
            <ArrowUp />
          </Button>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <Button aria-label="Stop" size="icon" variant="secondary">
            <Square />
          </Button>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </ComposerPrimitive.Root>
  );
}

export function Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-dvh flex-col bg-background">
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col overflow-y-auto px-4">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col pt-8">
          <ThreadPrimitive.Empty>
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <h1 className="text-2xl font-medium">What do you need done?</h1>
              <p className="text-muted-foreground">Ask for a plumber, an electrician, AC servicing and more.</p>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </div>
        <div className="sticky bottom-0 mx-auto w-full max-w-2xl bg-background pt-2 pb-4">
          <Composer />
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
