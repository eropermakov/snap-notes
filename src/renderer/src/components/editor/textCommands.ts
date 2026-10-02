import { linesToItems, removeLineBreaks } from '@shared/textTools'
import { escapeHtml, textToInline } from '@shared/blocks'

/**
 * DOM operations behind the editor's text commands. They work on the live contentEditable and return
 * whether anything changed; the caller then re-reads the editor (handleInput). The text rules live in
 * shared/textTools.ts (pure and tested); this file only moves text in and out of the DOM.
 */

const PROTECTED = 'PRE, TABLE, UL, OL, H1, H2, H3, H4, IMG, BLOCKQUOTE'
const PARAGRAPH_TAGS = new Set(['P', 'DIV'])

function rangeOf(root: HTMLElement): Range | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  return root.contains(range.commonAncestorContainer) ? range : null
}

export function selectedText(root: HTMLElement): string {
  const range = rangeOf(root)
  return range && !range.collapsed ? (window.getSelection()?.toString() ?? '') : ''
}

function closest(node: Node | null, selector: string): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  return el ? (el.closest(selector) as HTMLElement | null) : null
}

/** Plain text → editor paragraphs; single line breaks inside a paragraph stay as <br>. */
export function textToParagraphHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${textToInline(p)}</p>`)
    .join('')
}

/** Removes bold / italic / underline / strike / colour / highlight / font styling from the selection; text, links and structure stay. */
export function clearFormatting(root: HTMLElement): boolean {
  const range = rangeOf(root)
  if (!range || range.collapsed) return false
  root.focus()
  document.execCommand('removeFormat')
  const intersects = (el: Element): boolean => {
    try {
      return range.intersectsNode(el)
    } catch {
      return false
    }
  }
  // execCommand leaves colour / highlight spans; remove those too, but keep chips and OCR marks.
  for (const el of Array.from(root.querySelectorAll('span[style], font, mark, b, i, u, s, strike, strong, em'))) {
    if (!intersects(el) || el.classList.contains('ui-chip') || el.classList.contains('ocr-uncertain')) continue
    if (el instanceof HTMLElement && el.tagName === 'SPAN') {
      el.removeAttribute('style')
      if (!el.getAttribute('class')) el.replaceWith(...Array.from(el.childNodes))
    } else {
      el.replaceWith(...Array.from(el.childNodes))
    }
  }
  return true
}

/**
 * Selected lines → a list. Inside an existing list the whole list is converted instead, so structure
 * is never duplicated. `kind` 'todo' makes a checklist (☐ / ☑ items, ticked ones struck through).
 */
export function convertToList(root: HTMLElement, kind: 'ul' | 'ol' | 'todo'): 'converted' | 'empty' {
  const range = rangeOf(root)
  if (!range) return 'empty'

  const existing = closest(range.startContainer, 'ul, ol')
  if (existing && root.contains(existing)) {
    const items = Array.from(existing.children).filter((c) => c.tagName === 'LI') as HTMLElement[]
    const replacement = document.createElement(kind === 'ol' ? 'ol' : 'ul')
    if (kind === 'todo') replacement.className = 'todo-list'
    for (const li of items) {
      const next = document.createElement('li')
      next.innerHTML = li.innerHTML
      const wasDone = li.classList.contains('done')
      if (kind === 'todo') next.className = wasDone ? 'todo-item done' : 'todo-item'
      replacement.appendChild(next)
    }
    const source = existing.getAttribute('data-src')
    if (source) replacement.setAttribute('data-src', source)
    existing.replaceWith(replacement)
    return 'converted'
  }

  const text = range.collapsed ? '' : (window.getSelection()?.toString() ?? '')
  const items = linesToItems(text)
  if (items.length === 0) return 'empty'
  const li = items
    .map((item) => `<li${kind === 'todo' ? ` class="todo-item${item.checked ? ' done' : ''}"` : ''}>${escapeHtml(item.text)}</li>`)
    .join('')
  const html = kind === 'ol' ? `<ol>${li}</ol>` : kind === 'todo' ? `<ul class="todo-list">${li}</ul>` : `<ul>${li}</ul>`
  root.focus()
  document.execCommand('insertHTML', false, html)
  return 'converted'
}

function blockText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  const text = clone.textContent ?? ''
  return text.replace(/ /g, ' ').replace(/\n+$/, '')
}

/**
 * "Remove unnecessary line breaks" for PDF / OCR text: the paragraph-like blocks touched by the
 * selection are joined into real paragraphs. Lists, tables, code, headings and images are never
 * touched. Returns the number of paragraph runs rewritten (0 = nothing to do).
 */
export function unwrapSelectedParagraphs(root: HTMLElement): number {
  const range = rangeOf(root)
  if (!range || range.collapsed) return 0
  const touched = (Array.from(root.children) as HTMLElement[]).filter((el) => range.intersectsNode(el))

  const runs: HTMLElement[][] = []
  let run: HTMLElement[] = []
  for (const el of touched) {
    if (PARAGRAPH_TAGS.has(el.tagName) && !el.matches(PROTECTED) && !el.querySelector(PROTECTED)) run.push(el)
    else if (run.length) {
      runs.push(run)
      run = []
    }
  }
  if (run.length) runs.push(run)

  let rewritten = 0
  for (const group of runs) {
    const original = group.map(blockText).join('\n')
    const joined = removeLineBreaks(original)
    if (joined === original.trim()) continue
    const fragment = document.createElement('div')
    fragment.innerHTML = textToParagraphHtml(joined)
    const source = group[0].getAttribute('data-src')
    for (const child of Array.from(fragment.children)) if (source) child.setAttribute('data-src', source)
    group[0].before(...Array.from(fragment.childNodes))
    for (const el of group) el.remove()
    rewritten++
  }
  return rewritten
}

/** Replaces the selection with cleaned text (paragraphs). */
export function replaceSelectionWithText(root: HTMLElement, text: string): void {
  root.focus()
  document.execCommand('insertHTML', false, textToParagraphHtml(text) || escapeHtml(text))
}

/** Plain text of the editor's selection for the AI cleanup call. */
export function selectionForCleanup(root: HTMLElement): string {
  const range = rangeOf(root)
  if (!range || range.collapsed) return ''
  if (closest(range.commonAncestorContainer, 'pre')) return ''
  return window.getSelection()?.toString() ?? ''
}
