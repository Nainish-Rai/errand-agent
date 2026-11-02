import { Spinner } from "@/components/ui/spinner";

import { Notice, TrustCard } from "./trust-surface";

type VerificationBannerProps = {
  /** Defaults to the standard line. */
  readonly message?: string;
  /** The promised update, e.g. "I'll update you within 2 minutes, and I won't book twice." */
  readonly promise: string;
};

/** Shown while a booking's outcome is unknown and the agent is asking the provider. */
export function VerificationBanner({ message = "Checking with the provider…", promise }: VerificationBannerProps) {
  return (
    <TrustCard label="Checking with the provider" busy>
      <Notice live tone="info" lead={<Spinner aria-hidden />}>
        <span className="font-medium">{message}</span> {promise}
      </Notice>
    </TrustCard>
  );
}
