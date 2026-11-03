import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Size steps: height, minimum width and side padding. Errand: Lime's kbd is --radius-sm in --font-mono, and its
 * smallest type is --text-xs.
 */
const kbdSizes = {
  sm: 'h-4 min-w-4 px-1 text-xs',
  md: 'h-5 min-w-5 px-1 text-xs',
  lg: 'h-6 min-w-6 px-1.5 text-xs',
  xl: 'h-7 min-w-7 px-2 text-sm',
} as const

const kbdVariants = cva(
  [
    'pointer-events-none inline-flex w-fit items-center justify-center gap-1 rounded-sm border border-line bg-surface font-mono font-normal text-fg-2 select-none',
    "[&_svg:not([class*='size-'])]:size-3",
  ],
  {
    variants: { size: kbdSizes },
    defaultVariants: { size: 'xl' },
  },
)

type KbdProps = React.ComponentProps<'kbd'> & {
  /** Key cap size. @default "xl" (28px) */
  size?: VariantProps<typeof kbdVariants>['size']
}

/** A single key cap. */
function Kbd({ className, size = 'xl', ...props }: KbdProps) {
  return <kbd data-slot="kbd" data-size={size} className={cn(kbdVariants({ size }), className)} {...props} />
}

/** A row of key caps that make one shortcut, 4px apart. */
function KbdGroup({ className, ...props }: React.ComponentProps<'kbd'>) {
  return <kbd data-slot="kbd-group" className={cn('inline-flex items-center gap-1', className)} {...props} />
}

export { Kbd, KbdGroup, kbdSizes, kbdVariants }
export type { KbdProps }
