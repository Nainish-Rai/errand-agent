"use client";

import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type TextMessagePartComponent,
} from "@assistant-ui/react";
import { PROVIDER_UPDATE_PREFIX } from "@errand/contracts";
import { ArrowUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GeneratedUiPart } from "@/features/generated-ui";
import { MemoryUpdatedPart } from "@/features/memory-panel/memory-updated-line";
import { ProviderUpdateNotice } from "@/features/trust";

import { ExecutionPart, ProposalCardPart, useHasPendingApproval } from "./approval-card-part";
import { StartedFromLine, useHasOpenNewErrandCard } from "./errand-handoffs";
import { ProviderInsight } from "./provider-insight";
import { ProviderResults } from "./provider-results";
import { QuickReplies } from "./quick-replies";
import { StreamingAnswer } from "./streaming/streaming-answer";
import { ToolStatus } from "./tool-status";

// The chat as v3's Message and Chat input sections draw it: the person's words in a --surface-2 bubble
// on the right, Errand's answers as plain text up to 65ch, the agent's steps as quiet ToolCall rows,
// and every message arriving with a 4px rise over --dur-base.

const AssistantText: TextMessagePartComponent = ({ text, status }) => <StreamingAnswer text={text} isRunning={status.type === "running"} />;

/** The message's text, so a provider update the backend wrote can be told from the person's own words. */
function useMessageText(): string {
  return useAuiState(({ message }) =>
    message.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
  );
}

function UserMessage() {
  const text = useMessageText();
  if (text.startsWith(PROVIDER_UPDATE_PREFIX)) {
    return (
      <MessagePrimitive.Root className="py-2">
        <ProviderUpdateNotice update={text.slice(PROVIDER_UPDATE_PREFIX.length).trim()} />
      </MessagePrimitive.Root>
    );
  }
  return (
    <MessagePrimitive.Root data-slot="message" data-from="user" className="flex animate-rise justify-end">
      <div className="max-w-[85%] rounded-panel rounded-ee-sm bg-surface-2 px-4 py-2.5 text-base leading-normal text-fg [overflow-wrap:break-word]">
        <span className="sr-only">You: </span>
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  // Screen readers get the answer once: the message is busy while it streams, and read when it settles.
  const isRunning = useAuiState(({ message }) => message.status?.type === "running");
  return (
    <MessagePrimitive.Root
      data-slot="message"
      data-from="assistant"
      aria-busy={isRunning || undefined}
      className="flex max-w-[65ch] min-w-0 animate-rise flex-col gap-2 text-base leading-normal"
    >
      <span className="sr-only">Errand: </span>
      <MessagePrimitive.Parts
        components={{
          Text: AssistantText,
          tools: {
            by_name: {
              search_providers: ProviderResults,
              update_errand: QuickReplies,
              propose_action: ProposalCardPart,
              execute_proposal: ExecutionPart,
              get_provider_insight: ProviderInsight,
              present_ui: GeneratedUiPart,
              ask_ui: GeneratedUiPart,
              remember_fact: MemoryUpdatedPart,
              correct_fact: MemoryUpdatedPart,
              confirm_fact: MemoryUpdatedPart,
              forget_fact: MemoryUpdatedPart,
            },
            Fallback: ToolStatus,
          },
        }}
      />
    </MessagePrimitive.Root>
  );
}

/**
 * v3's ChatInput. Send lights lime only once there is text (it is disabled, so unlit, while empty), and
 * stays quiet ink while an approval card waits, so Approve is the view's one lime action. Stop is ink.
 */
function Composer() {
  // An open New errand card's Start in a new chat is the view's one lime action too (ticket 24).
  const newErrandWaiting = useHasOpenNewErrandCard();
  const approvalWaiting = useHasPendingApproval() || newErrandWaiting;
  return (
    <ComposerPrimitive.Root
      data-slot="chat-input"
      data-focus-shell
      className="flex w-full cursor-text items-end gap-1 rounded-sheet border border-line-strong bg-field p-1.5 transition-[border-color] duration-(--dur-instant) ease-out focus-within:border-accent-line"
    >
      <ComposerPrimitive.Input
        aria-label="Message the errand agent"
        autoFocus
        className="block max-h-50 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1 pl-2.5 text-base leading-6 text-fg outline-none placeholder:text-fg-3"
        placeholder="Ask Errand to book, move or cancel"
        rows={1}
      />
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <Button aria-label="Send" size="icon-sm" variant={approvalWaiting ? "solid" : "primary"} className={approvalWaiting ? undefined : "glow-subtle"}>
            <ArrowUp />
          </Button>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <Button aria-label="Stop" size="icon-sm" variant="solid">
            <Square className="fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </ComposerPrimitive.Root>
  );
}

export function Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-dvh flex-col bg-page">
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col overflow-y-auto px-4">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 pt-14">
          <ThreadPrimitive.Empty>
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <h1 className="text-2xl font-medium">What do you need done?</h1>
              <p className="text-fg-3">Ask for a plumber, an electrician, AC servicing and more.</p>
            </div>
          </ThreadPrimitive.Empty>
          <StartedFromLine />
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </div>
        <div className="sticky bottom-0 mx-auto w-full max-w-2xl bg-page pt-2 pb-4">
          <Composer />
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
