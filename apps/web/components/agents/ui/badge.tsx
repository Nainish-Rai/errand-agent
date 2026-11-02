import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/*
 * Measured from the reference: a 24px pill, 8px side padding, 14px text. Each tone is its colour mixed
 * into the page: light fills at ~10% with a ~20% hairline, a 1px white top highlight and a slightly
 * deeper bottom edge, text a shade darker than the hue; dark fills with the hue at L 0.26 and a hairline at L 0.33
 * (relative oklch colours from the token), text in the hue itself. The neutral tone uses muted / border / muted-foreground.
 */
const badgeVariants = cva(
  [
    'relative inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 text-sm font-normal whitespace-nowrap',
    'transition-[color,background-color,box-shadow] duration-150 ease-out',
    'focus-visible:ring-3 focus-visible:ring-ring/50 outline-none',
    "[&>svg]:pointer-events-none [&>svg:not([class*='size-'])]:size-3.5",
    // Tinted tones read their hue from --badge.
    'data-tinted:border-[color-mix(in_oklab,var(--badge)_20%,var(--background))] data-tinted:bg-[color-mix(in_oklab,var(--badge)_9%,var(--background))]',
    'data-tinted:text-[color-mix(in_oklab,var(--badge),black_16%)]',
    'data-tinted:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.6),inset_0_-1px_0_0_color-mix(in_oklab,var(--badge)_14%,transparent)]',
    'dark:data-tinted:border-[oklch(from_var(--badge)_0.33_calc(c*0.32)_h)] dark:data-tinted:bg-[oklch(from_var(--badge)_0.26_calc(c*0.4)_h)]',
    'dark:data-tinted:text-(--badge) dark:data-tinted:shadow-none',
  ],
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary:
          'border-border bg-muted text-muted-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.6),inset_0_-1px_0_0_rgb(0_0_0/0.06)] dark:shadow-none',
        outline: 'border-border bg-transparent text-foreground',
        destructive: '[--badge:var(--destructive)]',
        success: '[--badge:var(--success)]',
        warning: '[--badge:var(--warning)]',
        info: '[--badge:var(--info)]',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
)

const TINTED = new Set(['destructive', 'success', 'warning', 'info'])

type BadgeProps = useRender.ComponentProps<'span'> & {
  /**
   * Tone. `secondary` is the neutral pill; `info` / `success` / `warning` / `destructive` are tinted
   * with their status hue. @default "secondary"
   */
  variant?: VariantProps<typeof badgeVariants>['variant']
}

/** A compact status or category label. `render` swaps the element it draws (e.g. a link). */
function Badge({ className, variant = 'secondary', render, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    state: { slot: 'badge', variant, tinted: TINTED.has(variant ?? '') },
    stateAttributesMapping: {
      slot: (value) => ({ 'data-slot': String(value) }),
      variant: (value) => ({ 'data-variant': String(value) }),
      tinted: (value) => (value ? { 'data-tinted': '' } : null),
    },
  })
}

export { Badge, badgeVariants }
export type { BadgeProps }
