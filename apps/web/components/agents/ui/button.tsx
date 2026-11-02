import * as React from 'react'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { cn } from '@/lib/utils'
import { Spinner } from '@/components/agents/ui/spinner'

/*
 * Measured from the reference (light / dark):
 * - The visible surface is a ::before layer. Hover brightens it (filter) and press scales it to 0.985
 *   over 200ms on cubic-bezier(0.6, 0.6, 0, 1); the label never moves.
 * - Ghost and link use 150ms on the ease-out curve. Push lifts 1px on hover (190ms, overshooting curve)
 *   and sinks 4px on press (110ms ease-out) instead of scaling.
 * - Heights 24 / 28 / 32 / 36, radius 8px up to sm and 10px from default, text inset 8 / 10 / 10 / 16px.
 */
const buttonVariants = cva(
  [
    'group/button relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap font-normal outline-none select-none',
    'transition-[color,box-shadow,translate] duration-200 ease-[cubic-bezier(0.6,0.6,0,1)]',
    'focus-visible:ring-3 focus-visible:ring-ring/50',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    // The surface layer.
    'before:absolute before:inset-0 before:-z-10 before:rounded-[inherit]',
    'before:transition-[filter,scale,box-shadow,background-color] before:duration-200 before:ease-[cubic-bezier(0.6,0.6,0,1)]',
    'active:before:scale-[0.985] motion-reduce:before:transition-none',
  ],
  {
    variants: {
      variant: {
        default: [
          'text-primary-foreground',
          'before:bg-primary before:bg-linear-to-b before:from-white/7 before:to-white/2',
          'before:shadow-[0_0_0_1px_rgb(0_0_0/0.95),inset_0_1px_0_0_rgb(255_255_255/0.14),inset_0_0_3px_0_rgb(255_255_255/0.08),0_1px_2px_0_rgb(0_0_0/0.2),0_4px_10px_-2px_rgb(0_0_0/0.14)]',
          'hover:before:brightness-125',
          'dark:before:bg-linear-to-b dark:before:from-white/30 dark:before:via-transparent dark:before:via-45% dark:before:to-black/17',
          'dark:before:shadow-[0_0_0_1px_rgb(0_0_0/0.95),inset_0_1px_0_0_rgb(255_255_255/0.8),0_1px_2px_0_rgb(0_0_0/0.3)]',
          'dark:hover:before:brightness-[1.06]',
        ],
        destructive: [
          'text-primary-foreground dark:text-foreground',
          'before:bg-destructive before:bg-linear-to-b before:from-white/4 before:to-black/2',
          'dark:before:bg-[color-mix(in_oklab,var(--destructive)_78%,black)]',
          'before:shadow-[0_0_0_1px_color-mix(in_oklab,var(--destructive)_60%,black),inset_0_1px_0_0_rgb(255_255_255/0.14),inset_0_0_3px_0_rgb(255_255_255/0.1),0_1px_2px_0_rgb(0_0_0/0.2),0_4px_10px_-2px_rgb(0_0_0/0.14)]',
          'dark:before:shadow-[0_0_0_1px_rgb(0_0_0/0.9),inset_0_1px_0_0_rgb(255_255_255/0.2),0_1px_2px_0_rgb(0_0_0/0.3)]',
          'hover:before:brightness-110 dark:hover:before:brightness-[1.08]',
        ],
        outline: [
          'text-foreground',
          'before:bg-background',
          'before:shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.05),inset_0_-6px_12px_-6px_rgb(0_0_0/0.035),0_0_0_1px_rgb(0_0_0/0.07),0_0.5px_0.5px_0_rgb(0_0_0/0.05),0_2px_2px_-1px_rgb(0_0_0/0.035),0_3px_3px_-1.5px_rgb(0_0_0/0.03),0_5px_5px_-2.5px_rgb(0_0_0/0.024),0_8px_8px_-3px_rgb(0_0_0/0.016),0_12px_12px_-6px_rgb(0_0_0/0.01)]',
          'hover:before:shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.05),inset_0_-6px_12px_-6px_rgb(0_0_0/0.035),0_0_0_1px_rgb(0_0_0/0.09),0_1px_1px_-0.5px_rgb(0_0_0/0.06),0_3px_3px_-1.5px_rgb(0_0_0/0.043),0_5px_5px_-2.5px_rgb(0_0_0/0.04),0_8px_8px_-4px_rgb(0_0_0/0.035),0_12px_12px_-6px_rgb(0_0_0/0.03),0_16px_16px_-8px_rgb(0_0_0/0.02)]',
          'dark:before:bg-background/35',
          'dark:before:shadow-[inset_0_0_0_1px_var(--border),inset_0_1px_0_0_rgb(255_255_255/0.06),0_1px_2px_0_rgb(0_0_0/0.2)]',
          'dark:hover:before:shadow-[inset_0_0_0_1px_var(--border),inset_0_1px_0_0_rgb(255_255_255/0.06),0_1px_2px_0_rgb(0_0_0/0.2)]',
          'dark:hover:before:brightness-[1.3]',
        ],
        secondary: [
          'text-secondary-foreground',
          'before:bg-secondary',
          'before:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.9),inset_0_1px_2px_-0.5px_rgb(255_255_255/0.7),inset_0_-6px_12px_-6px_rgb(0_0_0/0.04),inset_0_-1px_0_0_rgb(0_0_0/0.05),0_0_0_1px_rgb(0_0_0/0.06),0_0.5px_0.5px_0_rgb(0_0_0/0.04),0_2px_2px_-1px_rgb(0_0_0/0.03),0_3px_3px_-1.5px_rgb(0_0_0/0.024),0_5px_5px_-2.5px_rgb(0_0_0/0.02),0_8px_8px_-3px_rgb(0_0_0/0.016),0_12px_12px_-6px_rgb(0_0_0/0.01)]',
          'hover:before:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.9),inset_0_1px_2px_-0.5px_rgb(255_255_255/0.7),inset_0_-6px_12px_-6px_rgb(0_0_0/0.04),inset_0_-1px_0_0_rgb(0_0_0/0.05),0_0_0_1px_rgb(0_0_0/0.08),0_1px_1px_-0.5px_rgb(0_0_0/0.05),0_3px_3px_-1.5px_rgb(0_0_0/0.04),0_5px_5px_-2.5px_rgb(0_0_0/0.035),0_8px_8px_-4px_rgb(0_0_0/0.03),0_12px_12px_-6px_rgb(0_0_0/0.024),0_16px_16px_-8px_rgb(0_0_0/0.02)]',
          'dark:before:bg-linear-to-b dark:before:from-white/4 dark:before:via-white/1 dark:before:to-white/5',
          'dark:before:shadow-[0_0_0_1px_rgb(0_0_0/0.7),inset_0_1px_0_0_rgb(255_255_255/0.1),0_1px_2px_0_rgb(0_0_0/0.3)]',
          'dark:hover:before:shadow-[0_0_0_1px_rgb(0_0_0/0.7),inset_0_1px_0_0_rgb(255_255_255/0.1),0_1px_2px_0_rgb(0_0_0/0.3)]',
          'dark:hover:before:brightness-[1.2]',
        ],
        ghost: [
          'text-foreground',
          'before:duration-150 before:ease-out',
          'hover:before:bg-foreground/7 aria-expanded:before:bg-foreground/7',
        ],
        link: ['text-primary underline-offset-4 hover:underline', 'before:duration-150 before:ease-out'],
        push: [
          'text-foreground',
          'before:bg-background before:shadow-[inset_0_0_0_1px_var(--border)] before:duration-150 before:ease-out',
          'hover:before:bg-secondary active:before:scale-100',
          '[--push-ledge:color-mix(in_oklab,var(--foreground)_15%,var(--background))] [--push-drop:rgb(0_0_0/0.08)]',
          'dark:[--push-ledge:color-mix(in_oklab,var(--foreground)_3%,var(--background))] dark:[--push-drop:rgb(0_0_0/0.5)]',
          'dark:before:bg-[color-mix(in_oklab,var(--foreground)_24%,var(--background))]',
          'dark:hover:before:bg-[color-mix(in_oklab,var(--foreground)_30%,var(--background))]',
          'shadow-[0_5px_0_0_var(--push-ledge),0_7px_8px_-6px_var(--push-drop)]',
          'duration-[190ms] ease-[cubic-bezier(0.22,1.32,0.36,1)]',
          'hover:-translate-y-px hover:shadow-[0_6px_0_0_var(--push-ledge),0_9px_11px_-7px_var(--push-drop)]',
          'active:translate-y-1 active:shadow-[0_1px_0_0_var(--push-ledge),0_2px_3px_-2px_var(--push-drop)] active:duration-[110ms] active:ease-out',
          'motion-reduce:transition-none',
        ],
      },
      size: {
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: 'h-7 gap-1 rounded-md px-2.5 text-[0.8rem]/[1.5]',
        default: 'h-8 gap-1.5 rounded-lg px-2.5 text-sm',
        lg: 'h-9 gap-2 rounded-lg px-4 text-sm',
        icon: 'size-8 rounded-lg text-sm',
        'icon-xs': "size-6 rounded-md text-xs [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': 'size-7 rounded-md text-sm',
        'icon-lg': 'size-9 rounded-lg text-sm',
      },
      rounded: {
        true: 'rounded-full',
        false: '',
      },
      flat: {
        true: 'before:bg-none before:shadow-none hover:before:shadow-none dark:before:bg-none dark:before:shadow-none dark:hover:before:shadow-none',
        false: '',
      },
    },
    compoundVariants: [
      { rounded: true, size: 'xs', className: 'px-2.5' },
      { rounded: true, size: 'sm', className: 'px-3' },
      { rounded: true, size: 'default', className: 'px-3.5' },
      { rounded: true, size: 'lg', className: 'px-5' },
      { flat: true, variant: 'push', className: 'shadow-none hover:shadow-none active:shadow-none hover:translate-y-0 active:translate-y-0' },
      { flat: true, variant: 'outline', className: 'before:shadow-[inset_0_0_0_1px_var(--border)] hover:before:shadow-[inset_0_0_0_1px_var(--border)] dark:before:shadow-[inset_0_0_0_1px_var(--border)] dark:hover:before:shadow-[inset_0_0_0_1px_var(--border)]' },
    ],
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
  /** Height and padding step. @default "lg" (36px) */
  size?: ButtonVariantProps['size']
  /** Fully rounded (pill) ends with a little more side padding. @default false */
  rounded?: boolean
  /** Drops the gradient, ring and shadow for a plain fill. @default false */
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

/** Spinner that turns in while `loading`: opacity in over 200ms after 40ms, out over 130ms. */
function ButtonSpinner({ loading }: { loading: boolean }) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {loading && (
        <motion.span
          key="spinner"
          data-slot="button-spinner"
          className="inline-flex"
          initial={{ opacity: 0, width: reduce ? 'auto' : 0 }}
          animate={{
            opacity: 1,
            width: 'auto',
            transition: {
              opacity: { duration: reduce ? 0 : 0.2, delay: reduce ? 0 : 0.04, ease: [0.33, 1, 0.68, 1] },
              width: { duration: reduce ? 0 : 0.25, ease: [0.23, 1, 0.32, 1] },
            },
          }}
          exit={{
            opacity: 0,
            width: reduce ? 'auto' : 0,
            transition: { duration: reduce ? 0 : 0.13, ease: [0.33, 1, 0.68, 1] },
          }}
        >
          <Spinner aria-hidden />
        </motion.span>
      )}
    </AnimatePresence>
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
