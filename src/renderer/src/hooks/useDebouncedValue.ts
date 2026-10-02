import { useEffect, useState } from 'react'

/** The value, but only after it stopped changing for `delay` ms (search input → heavy work). */
export function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    if (value === debounced) return undefined
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay, debounced])
  return debounced
}
