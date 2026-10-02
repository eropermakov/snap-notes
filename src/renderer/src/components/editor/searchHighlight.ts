import { fold, queryWords } from '@shared/noteSearch'

interface HighlightRegistryLike {
  set: (name: string, value: unknown) => void
  delete: (name: string) => void
}

const NAME = 'snap-search'

function registry(): HighlightRegistryLike | null {
  const css = CSS as unknown as { highlights?: HighlightRegistryLike }
  return css.highlights ?? null
}

/**
 * Marks the searched words inside the open note with the CSS Custom Highlight API, so the editor DOM
 * (and the user's caret and undo history) stays untouched. Scrolls to the first match once.
 * Returns a function that removes the marks.
 */
export function applySearchHighlight(root: HTMLElement, query: string, scroll: boolean): () => void {
  const reg = registry()
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  const words = queryWords(query)
  if (!reg || !HighlightCtor || words.length === 0) return () => undefined

  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = fold(node.nodeValue ?? '')
    for (const word of words) {
      let from = 0
      let guard = 0
      while (guard++ < 200) {
        const at = text.indexOf(word, from)
        if (at === -1) break
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + word.length)
        ranges.push(range)
        from = at + word.length
      }
    }
  }
  if (ranges.length === 0) return () => undefined
  reg.set(NAME, new HighlightCtor(...ranges))
  if (scroll) ranges[0].startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return () => reg.delete(NAME)
}
