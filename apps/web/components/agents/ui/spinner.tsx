import * as React from 'react'
import { cva } from 'class-variance-authority'
import { useReducedMotion } from 'motion/react'

import { cn } from '@/lib/utils'

/*
 * Measured on the original (light | dark):
 * - default: a 22-unit arc (r 9.75, stroke 2.5, round caps) that spins 900ms linear. With `dynamic`, the arc
 *   also breathes: Web Animations on stroke-dasharray (18-72 of 100) and rotate (+60..190deg) chained back to back,
 *   640-1200ms each, on one of three ease-in-out curves. Rest pose (and reduced motion): 25 of 100 at -45deg.
 * - gradient: a comet ring whose tail fades to nothing, spinning 1000ms linear.
 * - bars: 12 rounded bars every 30deg, each fading 1 -> 0.15 over 1200ms linear, offset 100ms clockwise.
 * - prefers-reduced-motion: every animation stops (the original renders the static pose).
 * Colour is currentColor; StatusBadge sets it to muted-foreground (measured #7a7a7a | #9a9a9a).
 */
const KEYFRAMES = `
@keyframes spinner-spin { to { transform: rotate(360deg) } }
@keyframes spinner-bars { from { opacity: 1 } to { opacity: 0.15 } }
@keyframes status-badge-blur { 0% { filter: blur(0) } 33% { filter: blur(0.5px) } 100% { filter: blur(0) } }
`

function SpinnerKeyframes() {
  return (
    <style href="agents-ui-spinner" precedence="default">
      {KEYFRAMES}
    </style>
  )
}

export type SpinnerVariant = 'default' | 'gradient' | 'bars'

export const spinnerVariants = cva('pointer-events-none block size-4 shrink-0', {
  variants: {
    variant: {
      default: 'animate-[spinner-spin_900ms_linear_infinite] motion-reduce:animate-none',
      gradient: 'animate-[spinner-spin_1000ms_linear_infinite] motion-reduce:animate-none',
      bars: '',
    },
  },
  defaultVariants: { variant: 'default' },
})

export type SpinnerProps = Omit<React.ComponentProps<'svg'>, 'children'> & {
  /** Glyph: a breathing arc, a fading comet, or twelve bars. */
  variant?: SpinnerVariant
  /** Default variant only: let the arc grow and shrink as it turns. Turn off for a constant quarter arc. */
  dynamic?: boolean
  /** Accessible name. Pass `aria-hidden` instead when a label next to it already says what is loading. */
  label?: string
}

const ARC_EASINGS = [
  'cubic-bezier(0.65, 0, 0.35, 1)',
  'cubic-bezier(0.45, 0, 0.55, 1)',
  'cubic-bezier(0.37, 0, 0.63, 1)',
]

/** Chains random Web Animations on the arc, as the original does, until unmounted. */
function useBreathingArc(ref: React.RefObject<SVGCircleElement | null>, enabled: boolean) {
  React.useEffect(() => {
    const el = ref.current
    if (!enabled || !el || typeof el.animate !== 'function') return
    let dash = 25
    let rotation = -45
    let current: Animation | null = null
    let stopped = false
    const step = () => {
      if (stopped) return
      const from = rotation > 180 ? rotation - 360 : rotation
      const nextDash = 18 + Math.random() * 54
      const to = from + 60 + Math.random() * 130
      current = el.animate(
        [
          { strokeDasharray: `${dash}, 100`, rotate: `${from}deg` },
          { strokeDasharray: `${nextDash}, 100`, rotate: `${to}deg` },
        ],
        {
          duration: 640 + Math.random() * 560,
          easing: ARC_EASINGS[Math.floor(Math.random() * ARC_EASINGS.length)],
          fill: 'forwards',
        },
      )
      dash = nextDash
      rotation = to
      current.onfinish = step
    }
    step()
    return () => {
      stopped = true
      current?.cancel()
    }
  }, [ref, enabled])
}

const BARS = Array.from({ length: 12 }, (_, i) => i)

/** An indeterminate loading indicator. Accepts native `<svg>` props; size it with `size-*` and colour it with `text-*`. */
function Spinner({ variant = 'default', dynamic = true, label = 'Loading', className, ...props }: SpinnerProps) {
  const reduced = useReducedMotion() ?? false
  const arcRef = React.useRef<SVGCircleElement>(null)
  const gradientId = React.useId()
  useBreathingArc(arcRef, variant === 'default' && dynamic && !reduced)

  const shared = {
    'data-slot': 'spinner',
    'data-variant': variant,
    role: 'status',
    'aria-label': label,
    fill: 'none',
    className: cn(spinnerVariants({ variant }), className),
    ...props,
  }

  if (variant === 'bars') {
    return (
      <>
        <SpinnerKeyframes />
        <svg viewBox="0 0 24 24" {...shared}>
          {BARS.map((i) => (
            <rect
              key={i}
              x="16.4"
              y="11"
              width="5.6"
              height="2"
              rx="1"
              fill="currentColor"
              transform={`rotate(${i * 30} 12 12)`}
              opacity={0.15 + (0.85 * (i + 1)) / 12}
              style={{ '--spinner-bar-delay': `${(i - 11) * 100}ms` } as React.CSSProperties}
              className="animate-[spinner-bars_1200ms_linear_infinite] [animation-delay:var(--spinner-bar-delay)] motion-reduce:animate-none"
            />
          ))}
        </svg>
      </>
    )
  }

  if (variant === 'gradient') {
    const head = `${gradientId}-head`
    const tail = `${gradientId}-tail`
    return (
      <>
        <SpinnerKeyframes />
        <svg viewBox="0 0 24 24" {...shared}>
          <defs>
            <linearGradient id={head} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id={tail} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.5" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Head: left half, top to bottom. Tail: right half, bottom back up, fading out before it meets the head. */}
          <path d="M12 3.25A8.75 8.75 0 0 0 12 20.75" stroke={`url(#${head})`} strokeWidth="2.5" />
          <path d="M12 20.75A8.75 8.75 0 0 0 13.5 3.38" stroke={`url(#${tail})`} strokeWidth="2.5" />
          <circle cx="12" cy="3.25" r="1.25" fill="currentColor" />
        </svg>
      </>
    )
  }

  return (
    <>
      <SpinnerKeyframes />
      <svg viewBox="0 0 22 22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" {...shared}>
        <circle
          ref={arcRef}
          cx="11"
          cy="11"
          r="9.75"
          pathLength={100}
          strokeDasharray="25, 100"
          className="[transform-box:fill-box] origin-center rotate-[-45deg]"
        />
      </svg>
    </>
  )
}

export type StatusBadgeStatus = 'loading' | 'done'

export type StatusBadgeProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  /** `loading` shows the spinner over a faint track; `done` fills the badge and draws a check. */
  status?: StatusBadgeStatus
  /** Spinner glyph while loading. */
  variant?: SpinnerVariant
  /** Passed to the default spinner. */
  dynamic?: boolean
}

/*
 * Measured: 22px badge, 2px track at black/10 | white/12 (foreground/10 | foreground/12 here). Done: the badge scales to 1.09 on an overshoot
 * (220ms cubic-bezier(0.34,1.96,0.94,1)), the track fades (154ms) and the spinner fades (110ms), a 24px disc
 * fills in (220ms cubic-bezier(0.34,1.35,0.64,1)), a 0.5px blur pulses (0 -> 0.5px in 99ms, back in 200ms) and the
 * check draws after 140ms (300ms cubic-bezier(0.22,1,0.36,1)). Back to loading everything returns in 200ms on
 * cubic-bezier(0.22,1,0.36,1). The disc is #2563eb in both themes: no theme token carries that blue, so it lives
 * in --status-badge-done on the badge and can be overridden there.
 */
function StatusBadge({ status = 'loading', variant = 'default', dynamic = true, className, ...props }: StatusBadgeProps) {
  const done = status === 'done'
  return (
    <span
      data-slot="status-badge"
      data-state={status}
      role="img"
      aria-label={done ? 'Done' : 'Loading'}
      className={cn(
        'group/status-badge relative block size-[22px] shrink-0 [--status-badge-done:#2563eb]',
        'transition-[scale] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'data-[state=done]:scale-[1.09] data-[state=done]:duration-[220ms] data-[state=done]:ease-[cubic-bezier(0.34,1.96,0.94,1)]',
        'data-[state=done]:animate-[status-badge-blur_300ms_linear] motion-reduce:transition-none motion-reduce:animate-none',
        className,
      )}
      {...props}
    >
      <span
        data-slot="status-badge-track"
        className={cn(
          'absolute inset-0 rounded-full border-2 border-foreground/10 dark:border-foreground/12',
          'transition-opacity duration-200 ease-in-out group-data-[state=done]/status-badge:opacity-0 group-data-[state=done]/status-badge:duration-[154ms]',
          variant !== 'default' && 'opacity-0',
        )}
      />
      <Spinner
        aria-hidden
        variant={variant}
        dynamic={dynamic && !done}
        className={cn(
          'absolute text-muted-foreground',
          variant === 'default' ? 'inset-0 size-[22px]' : '-inset-[2.2px] size-[26.4px]',
          'transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          'group-data-[state=done]/status-badge:opacity-0 group-data-[state=done]/status-badge:duration-[110ms] group-data-[state=done]/status-badge:ease-in-out',
        )}
      />
      <span
        data-slot="status-badge-fill"
        className={cn(
          'absolute -inset-px rounded-full bg-(--status-badge-done) opacity-0',
          'shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.05),0_0.5px_0.5px_rgb(0_0_0/0.1),0_0.5px_2px_rgb(0_0_0/0.08),inset_0_-0.5px_0.5px_rgb(0_0_0/0.09)]',
          'transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          'group-data-[state=done]/status-badge:opacity-100 group-data-[state=done]/status-badge:duration-[220ms] group-data-[state=done]/status-badge:ease-[cubic-bezier(0.34,1.35,0.64,1)]',
        )}
      />
      <span data-slot="status-badge-check" className="absolute inset-0 grid">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="block size-full overflow-hidden">
          <path
            d="M8 12.5L10.8 15.5L16.4 9.5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1 2"
            className={cn(
              '[stroke-dashoffset:1] opacity-0',
              'group-data-[state=done]/status-badge:[stroke-dashoffset:0] group-data-[state=done]/status-badge:opacity-100',
              'group-data-[state=done]/status-badge:transition-[stroke-dashoffset] group-data-[state=done]/status-badge:delay-[140ms] group-data-[state=done]/status-badge:duration-300 group-data-[state=done]/status-badge:ease-[cubic-bezier(0.22,1,0.36,1)]',
              'motion-reduce:transition-none',
            )}
          />
        </svg>
      </span>
    </span>
  )
}

export type CheckStateProps = Omit<React.ComponentProps<'span'>, 'title'> & {
  /** What is running, e.g. "Deploy to production". */
  title: React.ReactNode
  /** A quieter second line, e.g. "4 steps". */
  description?: React.ReactNode
  status?: StatusBadgeStatus
  variant?: SpinnerVariant
  dynamic?: boolean
}

/** A StatusBadge with a title and a quieter description: a step that spins while it runs and checks off when done. */
function CheckState({
  title,
  description,
  status = 'loading',
  variant = 'default',
  dynamic = true,
  className,
  ...props
}: CheckStateProps) {
  return (
    <span
      data-slot="check-state"
      data-state={status}
      role="status"
      className={cn('flex items-center gap-4', className)}
      {...props}
    >
      <StatusBadge status={status} variant={variant} dynamic={dynamic} />
      <span data-slot="check-state-texts" className="flex flex-col gap-[3px] text-[13px] leading-[13px]">
        <span data-slot="check-state-title" className="block text-foreground">
          {title}
        </span>
        {description != null && (
          <span data-slot="check-state-description" className="block text-foreground opacity-50">
            {description}
          </span>
        )}
      </span>
    </span>
  )
}

export { Spinner, StatusBadge, CheckState }
