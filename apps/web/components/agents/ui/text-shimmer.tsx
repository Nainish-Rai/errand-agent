import * as React from 'react'

import { cn } from '@/lib/utils'

/*
 * Measured inside Kobra's reasoning steps: the text is painted by two background layers clipped to the glyphs, a
 * base of the current colour at 45% and a highlight band (transparent -> current colour -> transparent, 2px per
 * character either side of centre: 54px for a 27-character label). The band layer is 250% wide and its
 * background-position runs 100% -> 0% every 700ms, linear, forever, so the highlight sweeps left to right.
 * The original keeps sweeping under prefers-reduced-motion, so this does too.
 */
const KEYFRAMES = `@keyframes text-shimmer { from { background-position: 100% 50%, 0 0 } to { background-position: 0% 50%, 0 0 } }`

type ShimmerElement = 'span' | 'p' | 'div' | 'h2' | 'h3' | 'h4' | 'label'

export type TextShimmerProps = React.ComponentProps<'span'> & {
  /** Element to render. */
  as?: ShimmerElement
  /** Seconds per sweep. */
  duration?: number
  /** Half-width of the highlight in px per character of string children. */
  spread?: number
  /** Turn the shimmer off to show the text plainly (e.g. once a step settles). */
  active?: boolean
}

/** Text with a highlight sweeping across it, for labels of work in progress. Colour it with `text-*`. */
function TextShimmer({
  as = 'span',
  duration = 0.7,
  spread = 2,
  active = true,
  className,
  style,
  children,
  ...props
}: TextShimmerProps) {
  const Comp = as as 'span'
  const length = typeof children === 'string' ? children.length : 27
  const vars = {
    '--shimmer-spread': `${length * spread}px`,
    '--shimmer-duration': `${duration}s`,
    ...style,
  } as React.CSSProperties
  return (
    <>
      <style href="agents-ui-text-shimmer" precedence="default">
        {KEYFRAMES}
      </style>
      <Comp
        data-slot="text-shimmer"
        data-state={active ? 'active' : 'idle'}
        style={vars}
        className={cn(
          'relative inline-block',
          active && [
            'bg-[length:250%_100%,auto] bg-clip-text bg-no-repeat [-webkit-text-fill-color:transparent]',
            '[background-image:linear-gradient(90deg,transparent_calc(50%-var(--shimmer-spread)),currentColor,transparent_calc(50%+var(--shimmer-spread))),linear-gradient(color-mix(in_oklab,currentColor_45%,transparent),color-mix(in_oklab,currentColor_45%,transparent))]',
            'animate-[text-shimmer_var(--shimmer-duration)_linear_infinite]',
          ],
          className,
        )}
        {...props}
      >
        {children}
      </Comp>
    </>
  )
}

export { TextShimmer }
