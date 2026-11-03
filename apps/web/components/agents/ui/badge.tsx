import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/*
 * Errand: restyled on Lime (design-system-v3.html). A pill at --text-xs: neutral on --surface-2, and each status on
 * its own tint with its text step. Lime has no info hue, so info is the accent wash.
 */
const badgeVariants = cva(
  [
    'relative inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-control px-2 text-xs font-medium whitespace-nowrap',
    'transition-[color,background-color] duration-(--dur-instant) ease-out',
    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    "[&>svg]:pointer-events-none [&>svg:not([class*='size-'])]:size-3.5",
  ],
  {
    variants: {
      variant: {
        default: 'bg-accent text-on-accent',
        secondary: 'bg-surface-2 text-fg-2',
        outline: 'border border-line text-fg',
        destructive: 'bg-danger-tint text-danger-text',
        success: 'bg-success-tint text-success-text',
        warning: 'bg-warn-tint text-warn-text',
        info: 'bg-accent-wash text-fg',
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
