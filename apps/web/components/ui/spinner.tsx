import { cn } from "@/lib/utils";

/** A ring in the info tone. It turns once per --dur-spin, so reduced motion stops it. */
function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block size-2.5 shrink-0 animate-spin rounded-full border-2 border-info border-r-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Spinner };
