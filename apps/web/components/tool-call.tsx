import { Check, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

import { Spinner } from "./ui/spinner";

// v3's ToolCall row: one real step the agent is taking, as a quiet row with a mark, a label and a
// detail. Running steps are present tense, finished ones past tense, and a failed step says why. A row
// arrives with a 4px rise over --dur-base; when its state changes the mark pops in at --scale-enter and
// the label and detail cross-fade. Each row is its own role="status", so a change is announced.

export type ToolCallState = "running" | "done" | "failed";

const stateWords: Readonly<Record<ToolCallState, string>> = { running: "Running", done: "Done", failed: "Failed" };

function Mark({ state }: { readonly state: ToolCallState }) {
  if (state === "running") return <Spinner aria-hidden role={undefined} aria-label={undefined} className="size-3.5 border-fg-2 border-r-transparent" />;
  if (state === "done") return <Check aria-hidden className="size-4 text-success-text" />;
  return <TriangleAlert aria-hidden className="size-4 text-danger-text" />;
}

type ToolCallProps = {
  readonly state: ToolCallState;
  readonly label: string;
  /** A step count, a booking ID or why it failed. */
  readonly detail?: string;
  readonly className?: string;
};

export function ToolCall({ state, label, detail, className }: ToolCallProps) {
  return (
    <div
      data-slot="tool-call"
      data-status={state}
      role="status"
      className={cn("flex min-h-9 animate-rise items-center gap-2.5 rounded-field bg-surface px-3 py-1.5 text-sm", className)}
    >
      <span key={state} className="flex size-4 shrink-0 animate-pop items-center justify-center">
        <Mark state={state} />
      </span>
      <span className="sr-only">{stateWords[state]}: </span>
      <span key={label} className={cn("min-w-0 animate-fade truncate font-medium", state === "failed" ? "text-danger-text" : "text-fg")}>
        {label}
      </span>
      {detail !== undefined && (
        <span key={detail} className="min-w-0 flex-1 animate-fade truncate text-end text-fg-3 tabular-nums">
          {detail}
        </span>
      )}
    </div>
  );
}

/** Rows in order, in a polite live region. */
export function ToolCallList({ children, label }: { readonly children: React.ReactNode; readonly label?: string }) {
  return (
    <div aria-live="polite" aria-label={label} className="flex flex-col gap-1.5">
      {children}
    </div>
  );
}
