"use client";

import { useEffect, useState, type ReactNode } from "react";

import { providerMedia } from "@/features/images";

import { appApi } from "./backend";

// The image key the world names for a provider, for the thumbnail in the `media` slot of the approval
// card and the receipts. Read once per provider and shared; until it arrives, when the read fails or
// when the key isn't one the app ships, there is no media and the card shows the initials at the same
// size, so nothing moves.

const reads = new Map<string, Promise<string | undefined>>();

function readImage(providerId: string): Promise<string | undefined> {
  let read = reads.get(providerId);
  if (read === undefined) {
    read = appApi.getProviders([providerId]).then(
      ([provider]) => provider?.image,
      () => {
        reads.delete(providerId);
        return undefined;
      },
    );
    reads.set(providerId, read);
  }
  return read;
}

function useProviderImage(providerId: string | undefined): string | undefined {
  const [image, setImage] = useState<{ readonly providerId: string; readonly key: string | undefined }>();
  useEffect(() => {
    if (providerId === undefined) return;
    let live = true;
    void readImage(providerId).then((key) => live && setImage({ providerId, key }));
    return () => {
      live = false;
    };
  }, [providerId]);
  return image !== undefined && image.providerId === providerId ? image.key : undefined;
}

/** The provider's thumbnail for a card's `media` slot, or undefined so the card shows the initials. */
export function useProviderMedia(providerId: string | undefined, name: string | undefined): ReactNode | undefined {
  const key = useProviderImage(providerId);
  return name === undefined ? undefined : providerMedia(key, name);
}
