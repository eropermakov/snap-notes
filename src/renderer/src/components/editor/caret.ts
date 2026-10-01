/**
 * Caret bookkeeping for the note editor (contentEditable). Positions are stored logically —
 * (top-level block index, text offset) — because the editor's HTML is re-rendered when the note
 * changes on disk, which would invalidate a DOM Range.
 */

export interface CaretPosition {
  blockIndex: number
  offset: number
}

/** Top-level child of `root` that contains `node`. */
export function topLevelBlock(root: HTMLElement, node: Node | null): HTMLElement | null {
  let current: Node | null = node
  while (current && current.parentNode !== root) current = current.parentNode
  return current instanceof HTMLElement ? current : null
}

/** OCR source a top-level block belongs to (images carry it on the <img> inside a <p>). */
export function sourceOfBlock(el: Element): string | null {
  const own = (el as HTMLElement).dataset?.src
  if (own) return own
  const img = el.querySelector(':scope > img[data-src]') as HTMLElement | null
  return img?.dataset.src ?? null
}

export function readCaret(root: HTMLElement): CaretPosition | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.endContainer)) return null
  const block = topLevelBlock(root, range.endContainer)
  if (!block) return null
  const before = document.createRange()
  before.setStart(block, 0)
  before.setEnd(range.endContainer, range.endOffset)
  return { blockIndex: Array.prototype.indexOf.call(root.children, block), offset: before.toString().length }
}

/** Resolves a text offset inside `block` to a DOM point. */
function pointAt(block: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode()
  let last: Node | null = null
  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) return { node, offset: remaining }
    remaining -= length
    last = node
    node = walker.nextNode()
  }
  if (last) return { node: last, offset: last.textContent?.length ?? 0 }
  return { node: block, offset: block.childNodes.length }
}

export function placeCaret(root: HTMLElement, position: CaretPosition): void {
  const block = root.children[position.blockIndex] as HTMLElement | undefined
  if (!block) return
  const point = pointAt(block, position.offset)
  const range = document.createRange()
  range.setStart(point.node, point.offset)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const SPLITTABLE = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE'])

function isEmptyBlock(el: Element): boolean {
  return !el.textContent?.trim() && !el.querySelector('img')
}

/**
 * Moves a capture's blocks (appended at the end of the note) to the saved caret position (§1):
 * inside a paragraph the paragraph is split at the caret; in a list, table or code block the
 * fragment goes right after it. Returns the new caret position (end of the moved fragment), or
 * null when nothing was moved.
 */
export function moveSourceToCaret(root: HTMLElement, sourceId: string, caret: CaretPosition): CaretPosition | null {
  const moved = Array.from(root.children).filter((el) => sourceOfBlock(el) === sourceId) as HTMLElement[]
  if (moved.length === 0) return null
  const target = root.children[caret.blockIndex] as HTMLElement | undefined
  if (!target || moved.includes(target)) return null

  const textLength = target.textContent?.length ?? 0
  let anchor: Element = target
  let before = false
  if (isEmptyBlock(target)) {
    // An empty line where the caret sits is replaced by the fragment.
    anchor = target
  } else if (SPLITTABLE.has(target.tagName) && caret.offset <= 0) {
    before = true
  } else if (SPLITTABLE.has(target.tagName) && caret.offset < textLength) {
    const point = pointAt(target, caret.offset)
    const tail = document.createRange()
    tail.setStart(point.node, point.offset)
    tail.setEnd(target, target.childNodes.length)
    const clone = target.cloneNode(false) as HTMLElement
    clone.removeAttribute('data-block')
    clone.appendChild(tail.extractContents())
    target.after(clone)
  }

  const fragment = document.createDocumentFragment()
  for (const el of moved) fragment.appendChild(el)
  if (before) anchor.before(fragment)
  else anchor.after(fragment)
  if (isEmptyBlock(target) && anchor === target && !before) target.remove()

  // Soft flash so the user sees where the capture landed (Web Animations: no attributes change).
  for (const el of moved) {
    el.animate?.([{ backgroundColor: 'var(--accent-soft)' }, { backgroundColor: 'transparent' }], { duration: 1400, easing: 'ease-out' })
  }

  const last = moved[moved.length - 1]
  return { blockIndex: Array.prototype.indexOf.call(root.children, last), offset: last.textContent?.length ?? 0 }
}
