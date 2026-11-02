import * as React from 'react'

export type SetStateFn<T> = (next: T | ((prev: T) => T)) => void

export interface UseControllableStateParams<T> {
  /** Controlled value. When not `undefined`, the hook reflects it and never stores its own copy. */
  value?: T | undefined
  /** Initial value when uncontrolled. */
  defaultValue: T
  /** Called with the next value whenever it changes, controlled or not. Not called when the value is unchanged. */
  onChange?: ((value: T) => void) | undefined
}

/**
 * State that can be controlled (`value` + `onChange`) or uncontrolled (`defaultValue`),
 * with the same semantics as Radix's `useControllableState`.
 *
 * ```tsx
 * const [open, setOpen] = useControllableState({ value: props.open, defaultValue: props.defaultOpen ?? false, onChange: props.onOpenChange })
 * ```
 *
 * - The setter accepts a value or an updater `(prev) => next`.
 * - `onChange` fires only when the value actually changes (`Object.is`).
 * - The setter is stable across renders.
 * - Switching between controlled and uncontrolled warns in development.
 */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: UseControllableStateParams<T>): [T, SetStateFn<T>] {
  const [uncontrolled, setUncontrolled] = React.useState<T>(defaultValue)
  const isControlled = value !== undefined
  const current = isControlled ? (value as T) : uncontrolled

  // Keep the latest values in refs so the setter can stay stable.
  const onChangeRef = React.useRef(onChange)
  const currentRef = React.useRef(current)
  const controlledRef = React.useRef(isControlled)
  React.useInsertionEffect(() => {
    onChangeRef.current = onChange
  })
  currentRef.current = current

  if (import.meta.env?.DEV && controlledRef.current !== isControlled) {
    const from = controlledRef.current ? 'controlled' : 'uncontrolled'
    const to = isControlled ? 'controlled' : 'uncontrolled'
    console.warn(
      `useControllableState: a component is changing from ${from} to ${to}. Decide between a controlled and an uncontrolled value for its lifetime.`,
    )
  }
  controlledRef.current = isControlled

  const setValue = React.useCallback<SetStateFn<T>>((next) => {
    const prev = currentRef.current
    const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next
    if (Object.is(resolved, prev)) return
    currentRef.current = resolved
    if (!controlledRef.current) setUncontrolled(resolved)
    onChangeRef.current?.(resolved)
  }, [])

  return [current, setValue]
}
