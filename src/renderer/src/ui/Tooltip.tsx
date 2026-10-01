import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { computePosition, rectOf, type Side } from './position'
import { Kbd } from './Badge'

interface Props {
  label: string
  shortcut?: string
  side?: Side
  children: ReactNode
  /** Delay before showing on hover, ms. Keyboard focus shows it immediately. */
  delay?: number
}

/** Small, quiet label for icon-only controls. Wraps its child in an inline-flex span it measures. */
export function Tooltip({ label, shortcut, side = 'bottom', children, delay = 450 }: Props): ReactElement {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const show = (immediate = false): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), immediate ? 0 : delay)
  }
  const hide = (): void => {
    clearTimeout(timer.current)
    setOpen(false)
    setPos(null)
  }

  useEffect(() => () => clearTimeout(timer.current), [])

  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !tipRef.current) return
    const size = { width: tipRef.current.offsetWidth, height: tipRef.current.offsetHeight }
    const p = computePosition(rectOf(wrapRef.current), size, side, 6)
    setPos({ x: p.x, y: p.y })
  }, [open, side, label])

  return (
    <span
      ref={wrapRef}
      className="inline-flex"
      onMouseEnter={() => show()}
      onMouseLeave={hide}
      onMouseDown={hide}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(':focus-visible')) show(true)
      }}
      onBlur={hide}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, opacity: pos ? 1 : 0 }}
            className="pointer-events-none fixed z-[400] flex items-center gap-2 whitespace-nowrap rounded-md bg-fg px-2 py-1 text-xs font-medium text-canvas shadow-popover transition-opacity duration-fast"
          >
            {label}
            {shortcut && <Kbd inverted>{shortcut}</Kbd>}
          </div>,
          document.body
        )}
    </span>
  )
}
