/** Trailing-edge debounce with explicit flush/cancel (search input, autosave). */
export interface Debounced<A extends unknown[]> {
  (...args: A): void
  flush: () => void
  cancel: () => void
  pending: () => boolean
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastArgs: A | undefined
  const run = (): void => {
    timer = undefined
    const args = lastArgs
    lastArgs = undefined
    if (args) fn(...args)
  }
  const debounced = ((...args: A) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, wait)
  }) as Debounced<A>
  debounced.flush = () => {
    if (!timer) return
    clearTimeout(timer)
    run()
  }
  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    lastArgs = undefined
  }
  debounced.pending = () => timer !== undefined
  return debounced
}
