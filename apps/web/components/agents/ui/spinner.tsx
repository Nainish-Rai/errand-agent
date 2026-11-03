import * as React from 'react'

import { cn } from '@/lib/utils'

/*
 * Errand: restyled on Lime (design-system-v3.html). The spinner is the only loop Lime allows: a quarter arc
 * that turns once per --dur-spin, linear, and keeps turning under reduced motion because it is the one sign that
 * work is running. The upstream breathing arc, comet and fading bars, and the StatusBadge's overshoot pop, blur
 * pulse and check draw, are gone (v3 "Motion removed because Lime rejects it").
 */
export type SpinnerVariant = 'default'

export type SpinnerProps = Omit<React.ComponentProps<'svg'>, 'children'> & {
  /** Kept for upstream callers; there is one glyph. */
  variant?: SpinnerVariant
  /** Kept for upstream callers; the arc no longer breathes. */
  dynamic?: boolean
  /** Accessible name. Pass `aria-hidden` instead when a label next to it already says what is loading. */
  label?: string
}

/** An indeterminate loading indicator. Accepts native `<svg>` props; size it with `size-*` and colour it with `text-*`. */
function Spinner({ variant = 'default', dynamic: _dynamic, label = 'Loading', className, ...props }: SpinnerProps) {
  return (
    <svg
      data-slot="spinner"
      data-variant={variant}
      role="status"
      aria-label={label}
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className={cn('pointer-events-none block size-4 shrink-0 animate-spin', className)}
      {...props}
    >
      <circle cx="11" cy="11" r="9.75" pathLength={100} strokeDasharray="25, 100" />
    </svg>
  )
}

export { Spinner }
