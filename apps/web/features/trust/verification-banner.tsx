import type { ReactNode } from "react";

import { Status } from "@/components/status";
import { ToolCallList } from "@/components/tool-call";

type VerificationBannerProps = {
  /** Defaults to the standard line. */
  readonly message?: string;
  /** The promised update, e.g. "I'll update you within 2 minutes, and I won't book twice." */
  readonly promise: string;
  /** The real steps so far, as ToolCall rows. */
  readonly steps?: ReactNode;
};

/**
 * Shown while a booking's outcome is unknown and the agent is asking the provider: v3's tracker, a
 * running Status over the steps, then the promise. Booked never appears here: only the receipt, with
 * the provider's booking ID, says that.
 */
export function VerificationBanner({ message = "Checking with the provider…", promise, steps }: VerificationBannerProps) {
  return (
    <section aria-label="Checking with the provider" aria-busy data-trust-surface="" data-slot="tracker" className="flex w-full min-w-0 animate-rise flex-col gap-2">
      <div role="status">
        <Status state="running" label={message} />
      </div>
      {steps !== undefined && <ToolCallList>{steps}</ToolCallList>}
      <p className="m-0 text-sm text-fg-2">{promise}</p>
    </section>
  );
}
