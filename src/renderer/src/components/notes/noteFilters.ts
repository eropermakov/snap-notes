import type { Note } from '@shared/types'
import { htmlToPlainText } from '@shared/htmlText'

export function matchesQuery(note: Note, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return note.title.toLowerCase().includes(q) || htmlToPlainText(note.body).toLowerCase().includes(q)
}

export function byRecent(a: Note, b: Note): number {
  return b.updatedAt - a.updatedAt
}

export function noteLabel(note: Note): string {
  if (note.title.trim()) return note.title.trim()
  const text = htmlToPlainText(note.body).trim()
  return text ? text.slice(0, 80) : 'Без названия'
}

/** Plain-text preview: table cells keep a separator, blank lines between blocks collapse. */
export function notePreview(html: string): string {
  return htmlToPlainText(html.replace(/<\/(td|th)>/gi, ' · </$1>'))
    .replace(/ · (\n|$)/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
