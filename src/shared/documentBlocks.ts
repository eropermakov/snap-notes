export type DocumentBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'label'; text: string }
  | { type: 'image'; bbox: [number, number, number, number] }

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

function isValidBbox(value: unknown): value is [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) return false
  return value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000)
}

export function parseDocumentBlocks(raw: string): DocumentBlock[] {
  let text = raw.trim()
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) text = fenceMatch[1].trim()

  const jsonStart = text.indexOf('[')
  const jsonEnd = text.lastIndexOf(']')
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) return []

  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as unknown
    if (!Array.isArray(parsed)) return []

    const blocks: DocumentBlock[] = []
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
        case 'image':
          if (isValidBbox(block.bbox)) blocks.push({ type: 'image', bbox: block.bbox })
          break
        default:
          break
      }
    }
    return blocks
  } catch {
    return []
  }
}

export function renderDocumentBlocksToHtml(blocks: DocumentBlock[], imageSrcByIndex: Map<number, string>): string {
  const parts: string[] = []

  blocks.forEach((block, index) => {
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
      case 'image': {
        const src = imageSrcByIndex.get(index)
        if (src) parts.push(`<p><img class="doc-image" src="${escapeHtml(src)}" alt="" /></p>`)
        break
      }
      default:
        break
    }
  })

  return parts.join('')
}
