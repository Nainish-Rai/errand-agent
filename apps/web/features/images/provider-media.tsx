import type { ReactNode } from "react";

import { ProviderThumbnail } from "./provider-thumbnail";
import { isRegisteredKey } from "./registry";

/**
 * What goes in the `media` slot of the approval card and the receipts: the provider's square
 * thumbnail when the world names a key the app ships, and nothing otherwise, so the card draws its
 * own initials. A registered file that fails to load falls back to the same initials in place.
 */
export function providerMedia(imageKey: unknown, name: string): ReactNode | undefined {
  if (!isRegisteredKey(imageKey)) return undefined;
  return <ProviderThumbnail imageKey={imageKey} name={name} size={40} className="size-full" />;
}
