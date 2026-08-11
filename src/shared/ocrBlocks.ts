export type OcrBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'button'; text: string }
  | { type: 'label'; text: string }

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseOcrBlocks(raw: string): OcrBlock[] {
  let text = raw.trim()
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) text = fenceMatch[1].trim()

  const jsonStart = text.indexOf('[')
  const jsonEnd = text.lastIndexOf(']')
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    return text ? [{ type: 'paragraph', text }] : []
  }

  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as unknown
    if (!Array.isArray(parsed)) return text ? [{ type: 'paragraph', text }] : []

    const blocks: OcrBlock[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const block = item as Record<string, unknown>
      switch (block.type) {
        case 'heading':
          if (isNonEmptyString(block.text)) blocks.push({ type: 'heading', text: block.text.trim() })
          break
        case 'paragraph':
          if (isNonEmptyString(block.text)) blocks.push({ type: 'paragraph', text: block.text.trim() })
          break
        case 'button':
          if (isNonEmptyString(block.text)) blocks.push({ type: 'button', text: block.text.trim() })
          break
        case 'label':
          if (isNonEmptyString(block.text)) blocks.push({ type: 'label', text: block.text.trim() })
          break
        case 'list':
          if (Array.isArray(block.items)) {
            const items = block.items.filter(isNonEmptyString).map((i) => i.trim())
            if (items.length > 0) blocks.push({ type: 'list', ordered: block.ordered === true, items })
          }
          break
        case 'table':
          if (Array.isArray(block.rows)) {
            const rows = block.rows
              .filter((row): row is unknown[] => Array.isArray(row))
              .map((row) => row.filter(isNonEmptyString).map((c) => c.trim()))
              .filter((row) => row.length > 0)
            if (rows.length > 0) blocks.push({ type: 'table', rows })
          }
          break
        default:
          break
      }
    }
    return blocks
  } catch {
    return text ? [{ type: 'paragraph', text }] : []
  }
}

export function renderBlocksToHtml(blocks: OcrBlock[]): string {
  const parts: string[] = []
  let pendingButtons: string[] = []

  const flushButtons = (): void => {
    if (pendingButtons.length === 0) return
    parts.push(`<p>${pendingButtons.map((b) => `<span class="ui-chip">${escapeHtml(b)}</span>`).join(' ')}</p>`)
    pendingButtons = []
  }

  for (const block of blocks) {
    if (block.type !== 'button' && pendingButtons.length > 0) flushButtons()

    switch (block.type) {
      case 'heading':
        parts.push(`<p><strong>${escapeHtml(block.text)}</strong></p>`)
        break
      case 'paragraph':
        parts.push(`<p>${escapeHtml(block.text)}</p>`)
        break
      case 'label':
        parts.push(`<p>${escapeHtml(block.text)}</p>`)
        break
      case 'button':
        pendingButtons.push(block.text)
        break
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul'
        const items = block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
        parts.push(`<${tag}>${items}</${tag}>`)
        break
      }
      case 'table': {
        const rows = block.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
          .join('')
        parts.push(`<table>${rows}</table>`)
        break
      }
      default:
        break
    }
  }
  flushButtons()

  return parts.join('')
}

export function blocksToPlainText(blocks: OcrBlock[]): string {
  const lines: string[] = []
  for (const block of blocks) {
    if (block.type === 'list') {
      lines.push(...block.items)
    } else if (block.type === 'table') {
      lines.push(...block.rows.map((row) => row.join(' | ')))
    } else {
      lines.push(block.text)
    }
  }
  return lines.join('\n')
}
