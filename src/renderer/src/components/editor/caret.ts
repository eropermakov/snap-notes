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
