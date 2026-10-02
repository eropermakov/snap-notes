import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { cn } from '../../ui'
import { ChevronDownIcon, ChevronUpIcon } from '../icons'
import { sourceOfBlock } from './caret'

interface Props {
  root: HTMLDivElement | null
  wrapper: HTMLDivElement | null
  noteId?: string
  /** Changes whenever the editor content was replaced (the classes below must be applied again). */
  contentVersion: number
}

/** Blocks taller than this can be folded. */
const MIN_FOLDABLE_PX = 190
/** A recognized fragment made of at least this many blocks can be folded as a whole. */
const MIN_FRAGMENT_BLOCKS = 4
const KEEP_VISIBLE = 2
const STORE_KEY = 'snap-notes:collapsed'

type Target = { kind: 'block'; el: HTMLElement; key: string } | { kind: 'fragment'; els: HTMLElement[]; key: string }

function readCollapsed(noteId: string): Set<string> {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, string[]>
    return new Set(all[noteId] ?? [])
  } catch {
    return new Set()
  }
}

function writeCollapsed(noteId: string, keys: Set<string>): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, string[]>
    if (keys.size) all[noteId] = [...keys]
    else delete all[noteId]
    localStorage.setItem(STORE_KEY, JSON.stringify(all))
  } catch {
    // The folded/unfolded state is a per-window convenience; losing it is harmless.
  }
}

function keyOf(el: HTMLElement, fallback: string): string {
  return el.getAttribute('data-block') ?? fallback
}

function findTargets(root: HTMLElement): Target[] {
  const children = Array.from(root.children) as HTMLElement[]
  const targets: Target[] = []
  const seenSources = new Set<string>()
  children.forEach((el, index) => {
    const source = sourceOfBlock(el)
    if (source) {
      if (seenSources.has(source)) return
      seenSources.add(source)
      const els = children.filter((c) => sourceOfBlock(c) === source)
      if (els.length >= MIN_FRAGMENT_BLOCKS) {
        targets.push({ kind: 'fragment', els, key: `src:${source}` })
        return
      }
    }
    if (['PRE', 'TABLE', 'BLOCKQUOTE', 'UL', 'OL', 'P'].includes(el.tagName)) {
      targets.push({ kind: 'block', el, key: keyOf(el, `i${index}`) })
    }
  })
  return targets
}

function setFolded(target: Target, folded: boolean): void {
  if (target.kind === 'block') {
    target.el.classList.toggle('block-collapsed', folded)
  } else {
    target.els.forEach((el, i) => {
      if (i >= KEEP_VISIBLE) el.style.display = folded ? 'none' : ''
      else el.classList.toggle('block-collapsed', folded && i === KEEP_VISIBLE - 1)
    })
  }
}

function heightOf(target: Target): number {
  return target.kind === 'block' ? target.el.scrollHeight : target.els.reduce((sum, el) => sum + el.offsetHeight, 0)
}

/**
 * Long blocks (code, tables, quotes, recognized fragments) can be folded to their first lines with a
 * "Show more" control. The folded state is only a view setting: it is kept per note in this window
 * and never written into the note itself.
 */
export default function CollapseTools({ root, wrapper, noteId, contentVersion }: Props): ReactElement | null {
  const [hovered, setHovered] = useState<{ key: string; top: number; folded: boolean; hidden: number } | null>(null)
  const targets = useRef<Target[]>([])
  const collapsed = useRef<Set<string>>(new Set())
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reapply = useCallback(() => {
    if (!root || !noteId) return
    collapsed.current = readCollapsed(noteId)
    targets.current = findTargets(root)
    for (const t of targets.current) setFolded(t, collapsed.current.has(t.key))
  }, [root, noteId])

  useEffect(() => {
    // Classes are re-applied after the editor content was replaced from outside.
    const id = requestAnimationFrame(reapply)
    return () => cancelAnimationFrame(id)
  }, [reapply, contentVersion])

  useEffect(() => {
    if (!root || !wrapper) return undefined
    const onMove = (e: MouseEvent): void => {
      const over = (e.target as HTMLElement).closest('[data-fold-button]')
      if (over) {
        if (hideTimer.current) clearTimeout(hideTimer.current)
        return
      }
      const list = findTargets(root)
      targets.current = list
      const hit = list.find((t) => (t.kind === 'block' ? t.el.contains(e.target as Node) : t.els.some((el) => el.contains(e.target as Node))))
      if (hit && (collapsed.current.has(hit.key) || heightOf(hit) > MIN_FOLDABLE_PX)) {
        if (hideTimer.current) clearTimeout(hideTimer.current)
        const first = hit.kind === 'block' ? hit.el : hit.els[0]
        const base = wrapper.getBoundingClientRect().top
        setHovered({
          key: hit.key,
          top: first.getBoundingClientRect().top - base,
          folded: collapsed.current.has(hit.key),
          hidden: hit.kind === 'fragment' ? hit.els.length - KEEP_VISIBLE : 0
        })
      } else if (!hideTimer.current) {
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null
          setHovered(null)
        }, 300)
      }
    }
    root.addEventListener('mousemove', onMove)
    return () => root.removeEventListener('mousemove', onMove)
  }, [root, wrapper])

  if (!hovered || !noteId) return null

  const toggle = (): void => {
    const target = targets.current.find((t) => t.key === hovered.key)
    if (!target) return
    const next = !collapsed.current.has(target.key)
    if (next) collapsed.current.add(target.key)
    else collapsed.current.delete(target.key)
    setFolded(target, next)
    writeCollapsed(noteId, collapsed.current)
    setHovered({ ...hovered, folded: next })
  }

  return (
    <button
      type="button"
      data-fold-button
      aria-expanded={!hovered.folded}
      aria-label={hovered.folded ? 'Показать больше' : 'Свернуть блок'}
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
      className={cn(
        'absolute right-7 z-10 flex h-6 items-center gap-1 rounded-md border border-line bg-elevated px-1.5 text-xs text-fg-secondary shadow-popover transition-colors duration-fast hover:text-fg',
        hovered.folded && 'text-fg'
      )}
      style={{ top: hovered.top }}
    >
      {hovered.folded ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronUpIcon className="h-3 w-3" />}
      {hovered.folded ? 'Показать больше' : 'Свернуть'}
    </button>
  )
}
