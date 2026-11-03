import { cn } from "@/lib/utils";

/** A ring in the olive line step: the only loop Lime allows. It turns once per --dur-spin and keeps turning under
 * reduced motion, because it is the one sign that work is running. */
function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block size-2.5 shrink-0 animate-spin rounded-full border-2 border-accent-line border-r-transparent",
        className,
      )}
      {...props}
    />
  );
}

export { Spinner };
