import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

export type LayoutSize = 'narrow' | 'normal' | 'wide'

/** Window breakpoints for the shell: narrow → sidebar floats, editor takes the workspace. */
export const BREAKPOINTS = { normal: 1000, wide: 1320 } as const

function sizeFor(width: number): LayoutSize {
  if (width < BREAKPOINTS.normal) return 'narrow'
  if (width < BREAKPOINTS.wide) return 'normal'
  return 'wide'
}

export function useLayoutSize(): LayoutSize {
  const [size, setSize] = useState<LayoutSize>(() => sizeFor(window.innerWidth))
  useEffect(() => {
    const onResize = (): void => setSize(sizeFor(window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/** Content width of an element, tracked with ResizeObserver (masonry columns follow the container, not the window). */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    setWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w !== undefined) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}
