/**
 * Markdown (the output of dedicated OCR engines such as Mistral OCR or a Modal OCR endpoint) →
 * the block items of OCR_SCHEMA (see ocrPrompts.ts / aiBlocks.ts). Deterministic and local: no
 * second AI request is needed to turn an OCR engine's result into note blocks.
 */

type Item = Record<string, unknown>

/** Inline Markdown → plain text; the editor adds its own formatting later. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, url: string) => (label.trim() === url.trim() ? url : `${label} (${url})`))
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function splitTableRow(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  return row.split(/(?<!\\)\|/).map((cell) => stripInlineMarkdown(cell.replace(/\\\|/g, '|')))
}

const SEPARATOR_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

/** Cells of a simple HTML table (<tr><td>/<th>), as returned by OCR engines for complex tables. */
export function htmlTableToRows(html: string): { rows: string[][]; header: boolean } | null {
  const rows: string[][] = []
  let header = false
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi)]
    if (cells.length === 0) continue
    if (rows.length === 0 && cells.every((c) => c[1].toLowerCase() === 'th')) header = true
    rows.push(cells.map((c) => stripInlineMarkdown(c[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))))
  }
  return rows.length ? { rows, header } : null
}

const BULLET = /^\s{0,3}[-*+•]\s+(.*)$/
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/
const CHECK = /^\s{0,3}[-*+]\s+\[( |x|X)\]\s+(.*)$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/

export function markdownToItems(markdown: string): Item[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const items: Item[] = []
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    const text = stripInlineMarkdown(paragraph.join(' '))
    if (text) items.push({ type: 'paragraph', text })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      continue
    }

    // Fenced code: copied verbatim, never cleaned.
    const fence = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(line)
    if (fence) {
      flushParagraph()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++])
      items.push({ type: 'code', language: fence[2] ?? '', code: code.join('\n') })
      continue
    }

    // HTML table (possibly spanning several lines).
    if (/^\s*<table/i.test(line)) {
      flushParagraph()
      let html = line
      while (!/<\/table>/i.test(html) && i + 1 < lines.length) html += `\n${lines[++i]}`
      const table = htmlTableToRows(html)
      if (table) items.push({ type: 'table', header: table.header, rows: table.rows })
      continue
    }

    // Markdown pipe table: needs a separator row right after the header.
    if (trimmed.includes('|') && i + 1 < lines.length && SEPARATOR_ROW.test(lines[i + 1])) {
      flushParagraph()
      const rows = [splitTableRow(line)]
      i += 2
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) rows.push(splitTableRow(lines[i++]))
      i--
      items.push({ type: 'table', header: true, rows })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      const text = stripInlineMarkdown(heading[2])
      if (text) items.push({ type: 'heading', level: Math.min(3, heading[1].length), text })
      continue
    }

    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) {
      flushParagraph()
      continue // an image reference carries no text
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph()
      const quote: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''))
      i--
      const text = stripInlineMarkdown(quote.join(' '))
      if (text) items.push({ type: 'quote', text })
      continue
    }

    if (CHECK.test(line)) {
      flushParagraph()
      const list: { text: string; done: boolean }[] = []
      while (i < lines.length && CHECK.test(lines[i])) {
        const m = CHECK.exec(lines[i++])!
        list.push({ text: stripInlineMarkdown(m[2]), done: m[1].toLowerCase() === 'x' })
      }
      i--
      items.push({ type: 'checklist', items: list })
      continue
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      flushParagraph()
      const numbered = NUMBERED.test(line)
      const pattern = numbered ? NUMBERED : BULLET
      const start = numbered ? Number(NUMBERED.exec(line)![1]) : undefined
      const list: string[] = []
      while (i < lines.length && pattern.test(lines[i]) && !(!numbered && CHECK.test(lines[i]))) {
        const m = pattern.exec(lines[i++])!
        list.push(stripInlineMarkdown(numbered ? m[2] : m[1]))
      }
      i--
      items.push(numbered ? { type: 'numbered_list', ...(start && start > 1 ? { start } : {}), items: list } : { type: 'bullet_list', items: list })
      continue
    }

    paragraph.push(trimmed)
  }
  flushParagraph()
  return items
}

/** Markdown → the JSON text the recognition pipeline expects from a vision model. */
export function markdownToBlockJson(markdown: string): string {
  return JSON.stringify({ blocks: markdownToItems(markdown) })
}
