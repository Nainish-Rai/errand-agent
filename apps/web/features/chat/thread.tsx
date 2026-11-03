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

import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";
import { GeneratedUiPart } from "@/features/generated-ui";
import { ProviderUpdateNotice } from "@/features/trust";

import { ExecutionPart, ProposalCardPart } from "./approval-card-part";
import { ProviderInsight } from "./provider-insight";
import { ProviderResults } from "./provider-results";
import { QuickReplies } from "./quick-replies";
import { ToolStatus } from "./tool-status";

const AssistantText: TextMessagePartComponent = ({ text, status }) => (
  <Markdown isAnimating={status.type === "running"}>{text}</Markdown>
);

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
    <MessagePrimitive.Root className="flex justify-end py-2">
      <div className="max-w-[80%] rounded-panel bg-surface-2 px-4 py-2 text-fg">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex flex-col py-2">
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
            },
            Fallback: ToolStatus,
          },
        }}
      />
    </MessagePrimitive.Root>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2 rounded-panel border border-line bg-surface p-2">
      <ComposerPrimitive.Input
        aria-label="Message the errand agent"
        autoFocus
        className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 outline-none placeholder:text-fg-3"
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
    <ThreadPrimitive.Root className="flex h-dvh flex-col bg-page">
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col overflow-y-auto px-4">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col pt-8">
          <ThreadPrimitive.Empty>
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <h1 className="text-2xl font-medium">What do you need done?</h1>
              <p className="text-fg-3">Ask for a plumber, an electrician, AC servicing and more.</p>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </div>
        <div className="sticky bottom-0 mx-auto w-full max-w-2xl bg-page pt-2 pb-4">
          <Composer />
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
