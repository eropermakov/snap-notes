import { useEffect, useRef, useState } from 'react'

/**
 * Renders a long list in chunks: the first `step` items at once, more as the user scrolls near the
 * end. Keeps big collections fast without changing how the list looks.
 */
export function useProgressive<T>(items: T[], step = 120): { visible: T[]; sentinel: (el: HTMLElement | null) => void; hasMore: boolean } {
  const [count, setCount] = useState(step)
  const observer = useRef<IntersectionObserver | null>(null)
  const total = items.length

  // A different list (filter / search / sort) starts from the top again.
  useEffect(() => setCount(step), [items, step])

  const sentinel = (el: HTMLElement | null): void => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    observer.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(total, c + step))
      },
      { rootMargin: '600px' }
    )
    observer.current.observe(el)
  }

  return { visible: count >= total ? items : items.slice(0, count), sentinel, hasMore: count < total }
}
