import type { Note } from './types'
import { noteText } from './noteStats'

/**
 * Full-text search over notes: title, body text (paragraphs, lists, OCR, table cells, code) and tags.
 * Each note is turned into lowercase text once and cached by its content, so typing a query never
 * re-parses the whole collection. All query words must match (in any field).
 */

export interface Range {
  start: number
  end: number
}

export interface SearchResult {
  id: string
  score: number
  matchedIn: ('title' | 'text' | 'tags')[]
  titleRanges: Range[]
  snippet: string
  snippetRanges: Range[]
}

interface Entry {
  key: string
  title: string
  titleLower: string
  text: string
  textLower: string
  tags: string
}

/** ё → е keeps string length, so ranges found in the folded text index the original text. */
export function fold(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е')
}

export function queryWords(query: string): string[] {
  return fold(query)
    .split(/\s+/)
    .map((w) => w.replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 8)
}

export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Range[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  return merged
}

function findAll(haystackFolded: string, words: string[], limit = 50): Range[] {
  const ranges: Range[] = []
  for (const word of words) {
    let from = 0
    let count = 0
    while (count < limit) {
      const index = haystackFolded.indexOf(word, from)
      if (index === -1) break
      ranges.push({ start: index, end: index + word.length })
      from = index + word.length
      count++
    }
  }
  return mergeRanges(ranges)
}

const SNIPPET_BEFORE = 36
const SNIPPET_LENGTH = 130

function makeSnippet(text: string, textFolded: string, words: string[]): { snippet: string; ranges: Range[] } {
  const hits = findAll(textFolded, words, 5)
  if (hits.length === 0) return { snippet: '', ranges: [] }
  let start = Math.max(0, hits[0].start - SNIPPET_BEFORE)
  if (start > 0) {
    // Begin at a word boundary when one is close enough.
    const space = text.indexOf(' ', start)
    if (space !== -1 && space < hits[0].start) start = space + 1
  }
  const end = Math.min(text.length, start + SNIPPET_LENGTH)
  const body = text.slice(start, end).replace(/\s+/g, ' ')
  const snippet = `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
  // Ranges are recomputed on the final snippet because whitespace collapsing can shift offsets.
  return { snippet, ranges: findAll(fold(snippet), words, 10) }
}

export class SearchIndex {
  private readonly entries = new Map<string, Entry>()

  /** Rebuilds only the notes whose content changed; forgets deleted ones. */
  update(notes: readonly Note[]): void {
    const alive = new Set<string>()
    for (const note of notes) {
      alive.add(note.id)
      const key = `${note.updatedAt}|${note.title}|${note.body.length}|${note.tags.join(',')}`
      if (this.entries.get(note.id)?.key === key) continue
      const text = noteText(note.body)
      this.entries.set(note.id, {
        key,
        title: note.title,
        titleLower: fold(note.title),
        text,
        textLower: fold(text),
        tags: fold(note.tags.join(' '))
      })
    }
    for (const id of [...this.entries.keys()]) if (!alive.has(id)) this.entries.delete(id)
  }

  size(): number {
    return this.entries.size
  }

  /** `scope` limits the search to a subset (the current collection) without copying the index. */
  search(query: string, scope?: ReadonlySet<string>, limit = 200): SearchResult[] {
    const words = queryWords(query)
    if (words.length === 0) return []
    const results: SearchResult[] = []
    for (const [id, entry] of this.entries) {
      if (scope && !scope.has(id)) continue
      let score = 0
      const matchedIn = new Set<'title' | 'text' | 'tags'>()
      let allMatch = true
      for (const word of words) {
        const inTitle = entry.titleLower.indexOf(word)
        const inTags = entry.tags.includes(word)
        const inText = entry.textLower.includes(word)
        if (inTitle === -1 && !inTags && !inText) {
          allMatch = false
          break
        }
        if (inTitle !== -1) {
          matchedIn.add('title')
          score += inTitle === 0 ? 15 : 10
        }
        if (inTags) {
          matchedIn.add('tags')
          score += 6
        }
        if (inText) {
          matchedIn.add('text')
          score += 1
        }
      }
      if (!allMatch) continue
      const snippetInfo = matchedIn.has('text') ? makeSnippet(entry.text, entry.textLower, words) : { snippet: '', ranges: [] }
      results.push({
        id,
        score,
        matchedIn: [...matchedIn],
        titleRanges: matchedIn.has('title') ? findAll(entry.titleLower, words, 10) : [],
        snippet: snippetInfo.snippet,
        snippetRanges: snippetInfo.ranges
      })
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit)
  }
}

/** Splits text into plain / highlighted pieces for rendering (no innerHTML). */
export function highlightParts(text: string, ranges: Range[]): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start >= text.length) break
    if (range.start > cursor) parts.push({ text: text.slice(cursor, range.start), hit: false })
    const end = Math.min(range.end, text.length)
    if (end > range.start) parts.push({ text: text.slice(Math.max(cursor, range.start), end), hit: true })
    cursor = Math.max(cursor, end)
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false })
  return parts
}
