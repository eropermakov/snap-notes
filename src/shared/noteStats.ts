import { htmlToPlainText } from './htmlText'
import type { OcrSource } from './blocks'

/** Plain text of a note body for search and statistics: table cells stay separated, no markup. */
export function noteText(html: string): string {
  if (!html) return ''
  return htmlToPlainText(html.replace(/<\/(td|th)>/gi, ' </$1>'))
}

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

export function countWords(text: string): number {
  return text ? (text.match(WORD)?.length ?? 0) : 0
}

/** Characters as the user sees them: runs of whitespace count once, no markup, no metadata. */
export function countChars(text: string): number {
  return text.replace(/\s+/g, ' ').trim().length
}

export interface NoteStats {
  words: number
  chars: number
}

export function noteStats(html: string): NoteStats {
  const text = noteText(html)
  return { words: countWords(text), chars: countChars(text) }
}

/** Russian plural: 1 слово, 2 слова, 5 слов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function formatStats(stats: NoteStats): string {
  return `${stats.words.toLocaleString('ru-RU')} ${plural(stats.words, 'слово', 'слова', 'слов')} · ${stats.chars.toLocaleString('ru-RU')} ${plural(stats.chars, 'символ', 'символа', 'символов')}`
}

/** Short badge text for a recognition method: Tesseract is shown as "Offline". */
export function providerBadgeLabel(method: string | undefined): string | null {
  const name = method?.trim()
  if (!name) return null
  return /tesseract/i.test(name) ? 'Offline' : name
}

export interface OcrProviderSummary {
  /** Single provider name, or null when none / several. */
  label: string | null
  mixed: boolean
  count: number
}

/** Which recognition providers contributed to a note. Several → "mixed", never a guessed single one. */
export function ocrProviderSummary(sources: Record<string, OcrSource> | undefined): OcrProviderSummary {
  const labels = new Set<string>()
  for (const source of Object.values(sources ?? {})) {
    const label = providerBadgeLabel(source.method)
    if (label) labels.add(label)
  }
  if (labels.size === 0) return { label: null, mixed: false, count: 0 }
  if (labels.size === 1) return { label: [...labels][0], mixed: false, count: 1 }
  return { label: null, mixed: true, count: labels.size }
}
