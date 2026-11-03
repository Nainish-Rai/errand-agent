import { cn } from "@/lib/utils";

import { Photo } from "./photo";

// A provider's square thumbnail, with its initials on --surface where the photo is missing: 40px
// on cards and receipts, 56px in lists, 24px inside a suggestion (v3 Images).

const SIZE = { 24: "w-6 rounded-full text-xs", 40: "w-10 rounded-sm", 56: "w-14 rounded-field" } as const;

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function ProviderThumbnail({
  imageKey,
  name,
  size = 40,
  className,
}: {
  /** The provider's image key from the world, or undefined while it isn't known. */
  readonly imageKey: unknown;
  readonly name: string;
  readonly size?: keyof typeof SIZE;
  readonly className?: string;
}) {
  return (
    <Photo
      imageKey={imageKey}
      ratio="square"
      fallback={initialsOf(name)}
      className={cn(SIZE[size], "border border-line", className)}
    />
  );
}
