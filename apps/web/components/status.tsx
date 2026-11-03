import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import { Spinner } from "./ui/spinner";

// v3's Status: a mark and a word for where something stands. Running turns the spinner; done, failed
// and cancelled are a dot in their tone; a provider-confirmed booking gets the solid booked mark. When
// the state changes the new mark pops in from --scale-enter and the word cross-fades (both keyed, so
// they remount and play their arrival once).

export type StatusState = "queued" | "running" | "done" | "failed" | "canceled";

const dots: Readonly<Record<Exclude<StatusState, "running">, string>> = {
  queued: "bg-control",
  done: "bg-success",
  failed: "bg-danger",
  canceled: "bg-fg-disabled",
};

type StatusProps = {
  readonly state: StatusState;
  /** Always shown: a status is never carried by its mark alone. */
  readonly label: string;
  /** Booked, with the provider's booking ID: the solid booked mark. */
  readonly booked?: boolean;
  /** The outcome of a press takes focus, so it can be focused without being a tab stop. */
  readonly focusable?: boolean;
  readonly className?: string;
};

function Mark({ state, booked }: { readonly state: StatusState; readonly booked: boolean }) {
  if (state === "running") return <Spinner aria-hidden role={undefined} aria-label={undefined} className="size-3.5" />;
  if (booked) {
    return (
      <span className="grid size-4 place-items-center rounded-full bg-errand-ok-fill text-errand-on-ok-fill">
        <Check aria-hidden className="size-3" strokeWidth={2.5} />
      </span>
    );
  }
  return <span aria-hidden className={cn("size-2 rounded-full", dots[state])} />;
}

export function Status({ state, label, booked = false, focusable = false, className }: StatusProps) {
  return (
    <span
      data-slot="status"
      data-status={state}
      tabIndex={focusable ? -1 : undefined}
      className={cn("inline-flex items-center gap-2 rounded-sm text-sm text-fg-2", className)}
    >
      <span key={`${state}-${booked}`} className="inline-flex min-w-2 shrink-0 animate-pop items-center justify-center">
        <Mark state={state} booked={booked} />
      </span>
      <span key={label} className="animate-fade">
        {label}
      </span>
    </span>
  );
}
