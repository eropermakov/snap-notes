import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode, type RefObject } from 'react'
import { motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { clampEditorPosition, floatingEditorSize, type EditorPosition } from '@shared/editorWorkspace'
import type { LayoutSize } from '../../hooks/useLayout'
import { cn, EASE_OUT, IconButton } from '../../ui'
import { GripIcon, PanelLeftIcon } from '../icons'

/** Dragging belongs to the frame, so changing notes never moves the workspace or remounts the editor. */
export default function EditorFrame({ workspace, layout, children }: {
  workspace: RefObject<HTMLDivElement | null>; layout: LayoutSize; children: ReactNode
}): ReactElement {
  const frame = useRef<HTMLDivElement>(null)
  const [floating, setFloating] = useState(false)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const pointer = useRef<{ id: number; clientX: number; clientY: number; origin: EditorPosition } | null>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const reduced = useReducedMotion()
  const narrow = layout === 'narrow'
  const detached = floating && !narrow
  const width = layout === 'wide' ? 520 : 440
  const size = useMemo(() => floatingEditorSize(bounds, width), [bounds, width])

  useEffect(() => {
    const el = workspace.current
    if (!el) return
    const measure = (): void => setBounds({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [workspace])

  useLayoutEffect(() => {
    if (narrow) {
      setFloating(false)
      pointer.current = null
      x.set(0)
      y.set(0)
    } else if (detached) {
      const next = clampEditorPosition({ x: x.get(), y: y.get() }, bounds, size)
      x.set(next.x)
      y.set(next.y)
    }
  }, [bounds, detached, narrow, size, x, y])

  const move = (position: EditorPosition): void => {
    const next = clampEditorPosition(position, bounds, size)
    x.set(next.x)
    y.set(next.y)
  }
  const detach = (): EditorPosition => {
    if (detached) return { x: x.get(), y: y.get() }
    const panel = frame.current!.getBoundingClientRect()
    const area = workspace.current!.getBoundingClientRect()
    const position = clampEditorPosition({ x: panel.left - area.left, y: panel.top - area.top }, bounds, size)
    setFloating(true)
    move(position)
    return position
  }
  const dock = (): void => {
    pointer.current = null
    setFloating(false)
    x.set(0)
    y.set(0)
  }
  const start = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const origin = detach()
    pointer.current = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, origin }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const drag = (event: PointerEvent<HTMLButtonElement>): void => {
    const active = pointer.current
    if (!active || active.id !== event.pointerId) return
    move({ x: active.origin.x + event.clientX - active.clientX, y: active.origin.y + event.clientY - active.clientY })
  }
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const direction = directions[event.key]
    if (!direction) return
    event.preventDefault()
    const origin = detach()
    const step = event.shiftKey ? 40 : 12
    move({ x: origin.x + direction[0] * step, y: origin.y + direction[1] * step })
  }

  return (
    <motion.div
      ref={frame}
      data-editor-floating={detached}
      initial={{ opacity: 0, scale: reduced ? 1 : 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: reduced ? 1 : 0.985 }}
      transition={{ duration: reduced ? 0 : 0.22, ease: EASE_OUT }}
      style={detached ? { x, y, width: size.width, height: size.height } : { x, y, width: narrow ? undefined : width }}
      className={cn('editor-frame flex min-h-0 shrink-0 flex-col bg-canvas',
        detached ? 'absolute left-0 top-0 z-20 overflow-hidden rounded-2xl border border-line-strong shadow-modal' : narrow ? 'absolute inset-0 z-20' : 'h-full border-l border-line')}
    >
      {!narrow && (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
          <button
            type="button"
            className="editor-drag-handle flex h-7 min-w-0 flex-1 touch-none items-center gap-2 rounded-md px-2 text-xs text-fg-muted hover:bg-hover hover:text-fg"
            aria-label="Переместить редактор: перетащите или используйте стрелки"
            title="Перетащите редактор или перемещайте стрелками с клавиатуры"
            onPointerDown={start}
            onPointerMove={drag}
            onPointerUp={() => { pointer.current = null }}
            onPointerCancel={() => { pointer.current = null }}
            onLostPointerCapture={() => { pointer.current = null }}
            onKeyDown={keyboard}
            onClick={(event) => { if (event.detail === 0) detach() }}
          >
            <GripIcon className="h-3.5 w-3.5" />
            <span className="truncate">{detached ? 'Переместить заметку' : 'Потяните, чтобы переместить'}</span>
          </button>
          {detached && <IconButton size="sm" label="Вернуть редактор вправо" icon={<PanelLeftIcon />} onClick={dock} />}
        </div>
      )}
      {children}
    </motion.div>
  )
}
