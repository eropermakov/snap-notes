/**
 * AI / local-layout block items (OCR_SCHEMA in ocrPrompts.ts) → note blocks.
 * Input is untrusted: every field is validated, unknown items are dropped, nothing throws.
 */
import { markUncertain, newBlockId, textToInline, type Block } from './blocks'
import { cleanOcrText } from './ocrCleanup'

export interface PendingImage {
  type: 'pending_image'
  id: string
  /** [ymin, xmin, ymax, xmax], 0–1000 of the source image. */
  bbox: [number, number, number, number]
}

export type RecognizedItem = Block | PendingImage

const UI_LABELS: Record<string, [string, string]> = {
  button: ['Кнопка', 'Кнопки'],
  tab: ['Вкладка', 'Вкладки'],
  link: ['Ссылка', 'Ссылки'],
  input: ['Поле', 'Поля'],
  menu: ['Меню', 'Меню']
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function uncertainList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200)
  return list.length ? list : undefined
}

/** Clean + escape + link + uncertainty marks. `clean` is off for code-like content. */
function inline(value: unknown, uncertain?: string[]): string {
  const cleaned = cleanOcrText(text(value))
  return markUncertain(textToInline(cleaned), uncertain)
}

function isBbox(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000) &&
    value[2] > value[0] &&
    value[3] > value[1]
  )
}

function stripListMarker(item: string): string {
  return item.replace(/^\s*(?:[•●▪◦‣∙·*–—-]|\d{1,3}[.)])\s+/, '')
}

/** Converts validated AI items to blocks, in order. `sourceId` links every block to its capture. */
export function itemsToBlocks(items: unknown[], sourceId?: string): RecognizedItem[] {
  const out: RecognizedItem[] = []
  const src = sourceId ? { sourceId } : {}
  let uiRun: { role: string; parts: string[] } | null = null

  const flushUi = (): void => {
    if (!uiRun) return
    const [one, many] = UI_LABELS[uiRun.role] ?? ['', '']
    const chips = uiRun.parts.map((p) => `<span class="ui-chip">${p}</span>`).join(' ')
    const label = uiRun.parts.length > 1 ? many : one
    out.push({ id: newBlockId(), ...src, type: 'paragraph', html: label ? `${label}: ${chips}` : chips })
    uiRun = null
  }

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const b = raw as Record<string, unknown>
    const uncertain = uncertainList(b.uncertain)
    const type = typeof b.type === 'string' ? b.type : ''

    if (type === 'ui' || type === 'button' || type === 'label') {
      const role = type === 'button' ? 'button' : type === 'label' ? 'label' : text(b.role)
      const html = inline(b.text, uncertain)
      if (!html) continue
      if (role === 'label' || !(role in UI_LABELS)) {
        flushUi()
        out.push({ id: newBlockId(), ...src, type: 'paragraph', html })
        continue
      }
      if (uiRun && uiRun.role !== role) flushUi()
      uiRun = uiRun ?? { role, parts: [] }
      uiRun.parts.push(html)
      continue
    }
    flushUi()

    switch (type) {
      case 'heading': {
        const html = inline(b.text, uncertain)
        const level = b.level === 1 || b.level === 2 || b.level === 3 ? b.level : 2
        if (html) out.push({ id: newBlockId(), ...src, type: 'heading', level, html })
        break
      }
      case 'paragraph':
      case 'quote': {
        const html = inline(b.text, uncertain)
        if (html) out.push({ id: newBlockId(), ...src, type: type === 'quote' ? 'quote' : 'paragraph', html })
        break
      }
      case 'bullet_list':
      case 'numbered_list':
      case 'list': {
        const list = Array.isArray(b.items) ? b.items.map((i) => inline(stripListMarker(text(i)), uncertain)).filter(Boolean) : []
        if (!list.length) break
        const numbered = type === 'numbered_list' || (type === 'list' && b.ordered === true)
        if (numbered) {
          const start = typeof b.start === 'number' && Number.isInteger(b.start) && b.start > 1 ? b.start : undefined
          out.push({ id: newBlockId(), ...src, type: 'numbered_list', items: list, ...(start ? { start } : {}) })
        } else {
          out.push({ id: newBlockId(), ...src, type: 'bullet_list', items: list })
        }
        break
      }
      case 'checklist': {
        const list = Array.isArray(b.items)
          ? b.items
              .map((i): Record<string, unknown> => (i && typeof i === 'object' ? (i as Record<string, unknown>) : { text: i }))
              .map((i) => ({ html: inline(i.text, uncertain), done: i.done === true }))
              .filter((i) => i.html)
          : []
        if (list.length) out.push({ id: newBlockId(), ...src, type: 'checklist', items: list })
        break
      }
      case 'table': {
        const rows = Array.isArray(b.rows)
          ? b.rows.filter(Array.isArray).map((row) => (row as unknown[]).map((c) => inline(c, uncertain)))
          : []
        const width = Math.max(0, ...rows.map((r) => r.length))
        const padded = rows.filter((r) => r.some(Boolean)).map((r) => [...r, ...Array(width - r.length).fill('')])
        if (padded.length) out.push({ id: newBlockId(), ...src, type: 'table', rows: padded, header: b.header !== false })
        break
      }
      case 'code': {
        // Code is never cleaned: indentation, symbols and quotes stay exactly as recognized.
        const code = text(b.code ?? b.text).replace(/\r\n?/g, '\n').replace(/\n+$/, '')
        const language = text(b.language).trim().toLowerCase().replace(/[^a-z0-9+#._-]/g, '').slice(0, 32)
        if (code.trim()) out.push({ id: newBlockId(), ...src, type: 'code', code, ...(language ? { language } : {}) })
        break
      }
      case 'image':
        if (isBbox(b.bbox)) out.push({ type: 'pending_image', id: newBlockId(), bbox: b.bbox })
        break
      default:
        break
    }
  }
  flushUi()
  return out
}

/** Plain text (a recognizer without structure) → paragraphs, cleaned. */
export function plainTextToItems(raw: string): unknown[] {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\r\n?/g, '\n').trim()
  if (!cleaned) return []
  return cleaned
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ type: 'paragraph', text: p }))
}
