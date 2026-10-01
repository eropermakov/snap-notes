/**
 * Structure from local OCR (Tesseract) without any AI: paragraphs, headings (by text height),
 * bullet/numbered lists, side-by-side columns as tables, code (with indentation from x positions)
 * and low-confidence words as "uncertain". Produces the same items as the AI schema, so offline
 * results go through the same block conversion.
 */
import { isJunkLine, joinParagraphLines } from './ocrCleanup'

export interface LayoutWord {
  text: string
  confidence: number
  bbox?: { x0: number; y0: number; x1: number; y1: number }
}

export interface LayoutLine {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
  words?: LayoutWord[]
}

const BULLET = /^\s*([•●▪◦‣∙·*–—-])\s+(.*)$/
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/
const CODE_LINE = /[{};]\s*$|=>|==|!=|&&|\|\||^\s*(def|function|const|let|var|import|from|class|return|if|for|while|public|private|#include|SELECT|FROM|WHERE|<\/?[a-z]+[^>]*>)\b|^\s*[$#>] /i
const UNCERTAIN_CONFIDENCE = 55

interface Row {
  lines: LayoutLine[]
  y0: number
  y1: number
}

function height(line: LayoutLine): number {
  return Math.max(1, line.bbox.y1 - line.bbox.y0)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Groups lines that share a vertical band (side by side) into rows, top to bottom. */
function toRows(lines: LayoutLine[]): Row[] {
  const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
  const rows: Row[] = []
  for (const line of sorted) {
    const row = rows.find((r) => {
      const overlap = Math.min(r.y1, line.bbox.y1) - Math.max(r.y0, line.bbox.y0)
      return overlap > Math.min(r.y1 - r.y0, height(line)) * 0.5
    })
    if (row) {
      row.lines.push(line)
      row.y0 = Math.min(row.y0, line.bbox.y0)
      row.y1 = Math.max(row.y1, line.bbox.y1)
    } else {
      rows.push({ lines: [line], y0: line.bbox.y0, y1: line.bbox.y1 })
    }
  }
  for (const row of rows) row.lines.sort((a, b) => a.bbox.x0 - b.bbox.x0)
  return rows.sort((a, b) => a.y0 - b.y0)
}

function uncertainWords(lines: LayoutLine[]): string[] {
  const words = lines.flatMap((l) => l.words ?? [])
  return Array.from(
    new Set(
      words
        .filter((w) => w.confidence < UNCERTAIN_CONFIDENCE && /[\p{L}\p{N}]/u.test(w.text) && (w.text.length >= 3 || /\d/.test(w.text)))
        .map((w) => w.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(Boolean)
    )
  )
}

function withUncertain(item: Record<string, unknown>, lines: LayoutLine[]): Record<string, unknown> {
  const uncertain = uncertainWords(lines)
  return uncertain.length ? { ...item, uncertain } : item
}

/**
 * Tesseract often returns a whole table row as one line with wide gaps between cells. Splits such a
 * line into segments wherever the gap between words is much wider than a normal space.
 */
export function splitAtColumnGaps(line: LayoutLine): LayoutLine[] {
  const words = (line.words ?? []).filter((w) => w.bbox && w.text.trim())
  if (words.length < 2) return [line]
  const lineHeight = height(line)
  const segments: LayoutWord[][] = [[words[0]]]
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].bbox!.x0 - words[i - 1].bbox!.x1
    if (gap > lineHeight * 1.6) segments.push([])
    segments[segments.length - 1].push(words[i])
  }
  if (segments.length < 2) return [line]
  return segments.map((segment) => ({
    text: segment.map((w) => w.text).join(' '),
    confidence: line.confidence,
    words: segment,
    bbox: {
      x0: segment[0].bbox!.x0,
      x1: segment[segment.length - 1].bbox!.x1,
      y0: line.bbox.y0,
      y1: line.bbox.y1
    }
  }))
}

export function layoutToItems(input: LayoutLine[]): Record<string, unknown>[] {
  const lines = input.filter((l) => !isJunkLine(l.text)).flatMap(splitAtColumnGaps)
  if (lines.length === 0) return []
  const rows = toRows(lines)
  const baseHeight = median(lines.map(height))
  const minX = Math.min(...lines.map((l) => l.bbox.x0))
  const items: Record<string, unknown>[] = []

  let paragraph: LayoutLine[] = []
  let list: { numbered: boolean; start: number; items: string[]; lines: LayoutLine[] } | null = null

  const flushParagraph = (): void => {
    if (!paragraph.length) return
    const text = joinParagraphLines(paragraph.map((l) => l.text))
    if (text) items.push(withUncertain({ type: 'paragraph', text }, paragraph))
    paragraph = []
  }
  const flushList = (): void => {
    if (!list) return
    items.push(
      withUncertain(
        list.numbered
          ? { type: 'numbered_list', items: list.items, ...(list.start > 1 ? { start: list.start } : {}) }
          : { type: 'bullet_list', items: list.items },
        list.lines
      )
    )
    list = null
  }
  const flushAll = (): void => {
    flushParagraph()
    flushList()
  }

  let i = 0
  while (i < rows.length) {
    const row = rows[i]

    // Table: consecutive rows with ≥2 side-by-side segments.
    if (row.lines.length >= 2) {
      let j = i
      while (j < rows.length && rows[j].lines.length >= 2) j++
      if (j - i >= 2) {
        flushAll()
        const tableRows = rows.slice(i, j)
        const width = Math.max(...tableRows.map((r) => r.lines.length))
        items.push(
          withUncertain(
            {
              type: 'table',
              header: true,
              rows: tableRows.map((r) => {
                const cells = r.lines.map((l) => joinParagraphLines([l.text]))
                return [...cells, ...Array(width - cells.length).fill('')]
              })
            },
            tableRows.flatMap((r) => r.lines)
          )
        )
        i = j
        continue
      }
    }

    // Code: ≥2 consecutive code-looking single-segment rows; indentation from x offsets.
    if (row.lines.length === 1 && CODE_LINE.test(row.lines[0].text)) {
      let j = i
      while (j < rows.length && rows[j].lines.length === 1 && (CODE_LINE.test(rows[j].lines[0].text) || rows[j].lines[0].bbox.x0 - minX > baseHeight)) j++
      if (j - i >= 2) {
        flushAll()
        const codeLines = rows.slice(i, j).map((r) => r.lines[0])
        const charWidth = median(codeLines.map((l) => (l.bbox.x1 - l.bbox.x0) / Math.max(1, l.text.trim().length))) || baseHeight / 2
        const left = Math.min(...codeLines.map((l) => l.bbox.x0))
        const code = codeLines
          .map((l) => ' '.repeat(Math.max(0, Math.round((l.bbox.x0 - left) / charWidth))) + l.text.trim())
          .join('\n')
        items.push({ type: 'code', code })
        i = j
        continue
      }
    }

    // Single-segment rows (multi-segment singletons are read left to right as one line).
    const line: LayoutLine =
      row.lines.length === 1
        ? row.lines[0]
        : { ...row.lines[0], text: row.lines.map((l) => l.text.trim()).join(' '), words: row.lines.flatMap((l) => l.words ?? []) }
    const text = line.text.trim()
    const prev = i > 0 ? rows[i - 1] : null
    const gap = prev ? row.y0 - prev.y1 : 0
    const ratio = height(line) / Math.max(1, baseHeight)

    const bullet = BULLET.exec(text)
    const numbered = NUMBERED.exec(text)
    if (bullet || numbered) {
      flushParagraph()
      const isNumbered = Boolean(numbered)
      if (list && list.numbered !== isNumbered) flushList()
      if (!list) list = { numbered: isNumbered, start: numbered ? Number(numbered[1]) : 1, items: [], lines: [] }
      list.items.push(joinParagraphLines([(bullet ?? numbered)![2]]))
      list.lines.push(line)
      i++
      continue
    }
    // Continuation of the previous list item (indented, no marker, tight spacing).
    if (list && gap < baseHeight * 0.8 && line.bbox.x0 > minX + baseHeight * 0.5) {
      list.items[list.items.length - 1] = joinParagraphLines([list.items[list.items.length - 1], text])
      list.lines.push(line)
      i++
      continue
    }
    flushList()

    const headingLike = ratio >= 1.3 && text.length <= 80 && !/[.,;:]$/.test(text)
    if (headingLike) {
      flushParagraph()
      items.push(withUncertain({ type: 'heading', level: ratio >= 1.8 ? 1 : ratio >= 1.5 ? 2 : 3, text: joinParagraphLines([text]) }, [line]))
      i++
      continue
    }

    // A large vertical gap or a clear change of left edge starts a new paragraph.
    const newParagraph =
      paragraph.length > 0 &&
      (gap > baseHeight * 0.8 || Math.abs(line.bbox.x0 - paragraph[paragraph.length - 1].bbox.x0) > baseHeight * 1.5)
    if (newParagraph) flushParagraph()
    paragraph.push(line)
    i++
  }
  flushAll()
  return items
}
