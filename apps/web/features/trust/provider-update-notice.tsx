import { TrustCard } from "./trust-surface";

type ProviderUpdateNoticeProps = {
  /** What the provider network told us, as the backend worded it from the world's booking. */
  readonly update: string;
};

/**
 * A provider update in the chat: the backend wrote it, not the person, so it is never drawn as
 * their message. Fixed, never generated.
 */
export function ProviderUpdateNotice({ update }: ProviderUpdateNoticeProps) {
  return (
    <TrustCard label="Provider update" tone="alert">
      <div role="status" className="grid gap-0.5 px-3 py-2">
        <p className="m-0 flex items-center gap-1.5 text-label font-medium text-err">
          <span aria-hidden>✕</span> Provider update
        </p>
        <p className="m-0 text-fg-body">{update}</p>
      </div>
    </TrustCard>
  );
}
