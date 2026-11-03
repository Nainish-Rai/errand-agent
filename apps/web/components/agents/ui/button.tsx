import * as React from 'react'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { motion as limeMotion } from '@errand/design-tokens'

import { cn } from '@/lib/utils'
import { Spinner } from '@/components/agents/ui/spinner'

/*
 * Errand: restyled on Lime (design-system-v3.html). Pills, the lime glow on the primary action, a red glow on a
 * destructive one, quiet grey steps for the rest. Hover and press change colour over --dur-instant on --ease-out,
 * and press scales to --scale-press; reduced motion zeroes both through the tokens. No overshoot, no lift.
 */
const buttonVariants = cva(
  [
    'group/button relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap font-medium outline-none select-none',
    'transition-[color,background-color,box-shadow,scale] duration-(--dur-instant) ease-out active:scale-(--scale-press)',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:bg-surface-2 disabled:text-fg-disabled aria-disabled:pointer-events-none aria-disabled:text-fg-disabled',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: 'glow glow-accent text-on-accent',
        destructive: 'glow glow-danger text-on-danger',
        outline: 'border border-line-strong bg-page text-fg hover:bg-surface-2',
        secondary: 'bg-surface-2 text-fg hover:bg-surface-3',
        ghost: 'text-fg hover:bg-surface-2 aria-expanded:bg-surface-2',
        link: 'text-fg underline-offset-4 hover:underline',
        push: 'bg-surface-2 text-fg hover:bg-surface-3',
      },
      size: {
        xs: "h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: 'h-7 gap-1 px-2.5 text-xs',
        default: 'h-8 gap-1.5 px-3 text-sm',
        lg: 'h-10 gap-2 px-4 text-sm',
        icon: 'size-8 text-sm',
        'icon-xs': "size-6 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': 'size-7 text-sm',
        'icon-lg': 'size-10 text-sm',
      },
      // Lime's controls are pills either way; `rounded` is kept so callers need no change.
      rounded: {
        true: 'rounded-control',
        false: 'rounded-control',
      },
      flat: {
        true: 'glow-still',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'lg',
      rounded: false,
      flat: false,
    },
  },
)

type ButtonVariantProps = VariantProps<typeof buttonVariants>

type ButtonProps = Omit<React.ComponentProps<typeof ButtonPrimitive>, 'className'> & {
  className?: string
  /** Surface style. @default "default" */
  variant?: ButtonVariantProps['variant']
  /** Height and padding step. @default "lg" (40px, Lime's default control) */
  size?: ButtonVariantProps['size']
  /** Fully rounded (pill) ends with a little more side padding. @default false */
  rounded?: boolean
  /** Keeps the glow still: no power-up on hover or darker press. @default false */
  flat?: boolean
  /**
   * Busy state: a spinner turns in beside the label. The button stays enabled (it is the state) and
   * reports `aria-busy` and `data-loading`.
   * @default false
   */
  loading?: boolean
}

/** A pressable control. Built on Base UI's Button, so `render` swaps the element (e.g. `render={<a href="…" />}`). */
function Button({
  className,
  variant = 'default',
  size = 'lg',
  rounded = false,
  flat = false,
  loading = false,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading ? '' : undefined}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, rounded, flat }), className)}
      {...props}
    >
      <ButtonSpinner loading={loading} />
      {children}
    </ButtonPrimitive>
  )
}

/** Spinner that fades in while `loading` over --dur-base on --ease-out, and out over --dur-fast on --ease-in. */
function ButtonSpinner({ loading }: { loading: boolean }) {
  const reduce = useReducedMotion()
  const seconds = (ms: number) => (reduce ? 0 : ms / 1000)
  return (
    <AnimatePresence initial={false}>
      {loading && (
        <motion.span
          key="spinner"
          data-slot="button-spinner"
          className="inline-flex"
          initial={{ opacity: 0, width: reduce ? 'auto' : 0 }}
          animate={{ opacity: 1, width: 'auto', transition: { duration: seconds(limeMotion.base), ease: [...limeMotion.easeOut] } }}
          exit={{ opacity: 0, width: reduce ? 'auto' : 0, transition: { duration: seconds(limeMotion.fast), ease: [...limeMotion.easeIn] } }}
        >
          <Spinner aria-hidden />
        </motion.span>
      )}
    </AnimatePresence>
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
