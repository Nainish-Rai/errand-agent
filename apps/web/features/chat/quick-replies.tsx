"use client";

import { AuiIf, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { UpdateErrandOutputSchema, type QuickReply, type RequiredField } from "@errand/contracts";

import { SuggestionChip } from "@/components/chip";

import { useSendText } from "./send-text";

// update_errand's question as tap-to-answer chips under the agent's message. The fields and the
// replies come from the backend (core decides what is missing); a tap sends the reply's text as
// the person's next message. Only the latest message offers them, and not while a turn runs.

const FIELD_LABELS: Readonly<Record<RequiredField, string>> = {
  service: "Service",
  area: "Area",
  timeWindow: "When",
};

function ReplyGroup({ field, replies }: { readonly field: RequiredField; readonly replies: readonly QuickReply[] }) {
  const send = useSendText();
  return (
    <div role="group" aria-label={`Quick replies: ${FIELD_LABELS[field]}`} className="flex flex-wrap items-center gap-1.5">
      <span className="text-label text-fg-meta">{FIELD_LABELS[field]}</span>
      {replies.map((reply) => (
        <SuggestionChip key={reply.text} onClick={() => void send(reply.text)}>
          {reply.text}
        </SuggestionChip>
      ))}
    </div>
  );
}

export const QuickReplies: ToolCallMessagePartComponent = ({ result }) => {
  const parsed = UpdateErrandOutputSchema.safeParse(result);
  const question = parsed.success ? parsed.data.errand.question : null;
  if (question === null) return null;
  return (
    <AuiIf condition={(state) => state.message.isLast && !state.thread.isRunning}>
      <div className="order-last my-2 flex flex-col gap-2">
        {question.fields.map((field) => (
          <ReplyGroup key={field} field={field} replies={question.quickReplies.filter((reply) => reply.field === field)} />
        ))}
      </div>
    </AuiIf>
  );
};
