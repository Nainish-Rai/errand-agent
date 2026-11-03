"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { registeredPhoto } from "./registry";

// A photo by image key, as v3's Images section draws it. The box holds its aspect ratio from the
// first paint, on a still --surface-2 placeholder of the same size, so nothing moves when the photo
// lands; the photo fades in over --dur-base (no fade under reduced motion, where tokens.css zeroes
// the durations). A key the registry doesn't ship, or a file that fails, shows the fallback —
// initials or a line icon on --surface — and the browser fetches nothing for an unknown key.

export type PhotoRatio = "square" | "landscape" | "wide";

const RATIO_CLASS: Readonly<Record<PhotoRatio, string>> = {
  square: "aspect-square",
  landscape: "aspect-[4/3]",
  wide: "aspect-video",
};

type PhotoProps = {
  /** An image key from the provider world. Untrusted: only registered keys draw a photo. */
  readonly imageKey: unknown;
  /** 1:1 for a provider or team, 4:3 for a service tile or option, 16:9 for a hero or a job photo. */
  readonly ratio: PhotoRatio;
  /** Shown when there is no photo: the provider's initials or the service's line icon. */
  readonly fallback: ReactNode;
  /** Width and corner radius, e.g. "w-10 rounded-sm". */
  readonly className?: string;
};

type Load = "loading" | "loaded" | "failed";

export function Photo({ imageKey, ratio, fallback, className }: PhotoProps) {
  const photo = registeredPhoto(imageKey);
  const file = photo === undefined ? undefined : (photo.files[ratio] ?? photo.files.landscape ?? photo.files.square ?? photo.files.wide);
  const [load, setLoad] = useState<{ readonly src: string | undefined; readonly state: Load }>({ src: file?.src, state: "loading" });
  const state: Load = load.src === file?.src ? load.state : "loading";
  const image = useRef<HTMLImageElement>(null);

  // A cached photo can finish before React attaches onLoad; read the element once it mounts.
  useEffect(() => {
    const element = image.current;
    if (element?.complete === true) setLoad({ src: file?.src, state: element.naturalWidth > 0 ? "loaded" : "failed" });
  }, [file?.src]);

  const failed = file === undefined || state === "failed";
  return (
    <span
      data-slot="image"
      data-image-state={failed ? "fallback" : state}
      className={cn("relative block flex-none overflow-hidden bg-surface-2", RATIO_CLASS[ratio], className)}
    >
      {failed ? (
        <span aria-hidden className="absolute inset-0 grid place-items-center bg-surface text-sm font-medium text-fg-2">
          {fallback}
        </span>
      ) : (
        <img
          ref={image}
          src={file.src}
          width={file.width}
          height={file.height}
          alt={photo?.alt ?? ""}
          decoding="async"
          loading="lazy"
          draggable={false}
          onLoad={() => setLoad({ src: file.src, state: "loaded" })}
          onError={() => setLoad({ src: file.src, state: "failed" })}
          className={cn(
            "absolute inset-0 size-full object-cover opacity-0 [transition:opacity_var(--dur-base)_var(--ease-out)]",
            state === "loaded" && "opacity-100",
          )}
        />
      )}
    </span>
  );
}
