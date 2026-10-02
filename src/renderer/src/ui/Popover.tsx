import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { computePosition, rectOf, type Placement, type Rect } from './position'
import { cn, motionPresets } from './cn'

export type PopoverAnchor = HTMLElement | { x: number; y: number } | null

interface PopoverProps {
  open: boolean
  onClose: () => void
  anchor: PopoverAnchor
  placement?: Placement
  offset?: number
  className?: string
  children: ReactNode
  role?: string
  'aria-label'?: string
  /** Close when the pointer leaves both the anchor and the panel (hover cards). */
  hoverCard?: boolean
  /** Return focus to the anchor element when closed via Escape. */
  restoreFocus?: boolean
}

function anchorRect(anchor: PopoverAnchor): Rect | null {
  if (!anchor) return null
  if (anchor instanceof HTMLElement) return rectOf(anchor)
  return { left: anchor.x, top: anchor.y, width: 0, height: 0 }
}

/**
 * The single elevated surface every floating UI is built on (menus, pickers, hover cards).
 * Portalled, positioned against an element or a point, closes on outside click / Escape / scroll / resize.
 */
export function Popover({
  open,
  onClose,
  anchor,
  placement = 'bottom-start',
  offset = 6,
  className,
  children,
  role = 'dialog',
  hoverCard,
  restoreFocus = true,
  ...aria
}: PopoverProps): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const rect = anchorRect(anchor)
    const panel = panelRef.current
    if (!rect || !panel) return
    const p = computePosition(rect, { width: panel.offsetWidth, height: panel.offsetHeight }, placement, offset)
    setPos({ x: p.x, y: p.y })
  }, [open, anchor, placement, offset])

  useEffect(() => {
    if (!open) return undefined
    const anchorEl = anchor instanceof HTMLElement ? anchor : null
    const onPointerDown = (e: PointerEvent): void => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || anchorEl?.contains(t)) return
      onCloseRef.current()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        if (restoreFocus) anchorEl?.focus()
      }
    }
    const onScroll = (e: Event): void => {
      if (panelRef.current?.contains(e.target as Node)) return
      onCloseRef.current()
    }
    const onResize = (): void => onCloseRef.current()
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onResize)
    }
  }, [open, anchor, restoreFocus])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role={role}
          {...aria}
          {...motionPresets.popover}
          style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
          onMouseLeave={hoverCard ? () => onCloseRef.current() : undefined}
          className={cn(
            'fixed z-[300] rounded-xl border border-[var(--border-card)] bg-elevated text-fg shadow-popover outline-none',
            className
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
