/**
 * Block document model (note format v2).
 *
 * A note is an ordered list of independent blocks. Text-bearing fields hold *inline HTML* restricted
 * to a small allowlist (bold/italic/underline/strike/link/code/highlight/UI chip/uncertain-OCR mark),
 * rebuilt by `sanitizeInline` — so a block is always safe to render, export or copy.
 *
 * The same blocks feed the editor, DOCX/PDF/Markdown export, "Copy for AI" and clipboard copies.
 * Parsing uses htmlparser2 (no DOM), so this module runs in both the main and renderer processes.
 */
import { parseDocument } from 'htmlparser2'
import { isTag, isText, type AnyNode, type Element as DomElement } from 'domhandler'

export const NOTE_FORMAT_VERSION = 2

export interface BlockBase {
  id: string
  /** OCR capture this block came from (see Note.sources). */
  sourceId?: string
  /** 0–1 overall recognition confidence, when a recognizer reported one. */
  confidence?: number
}

export interface ChecklistItem {
  html: string
  done: boolean
}

export type Block =
  | (BlockBase & { type: 'heading'; level: 1 | 2 | 3; html: string })
  | (BlockBase & { type: 'paragraph'; html: string; tone?: 'warning' })
  | (BlockBase & { type: 'bullet_list'; items: string[] })
  | (BlockBase & { type: 'numbered_list'; items: string[]; start?: number })
  | (BlockBase & { type: 'checklist'; items: ChecklistItem[] })
  | (BlockBase & { type: 'table'; rows: string[][]; header: boolean })
  | (BlockBase & { type: 'code'; code: string; language?: string })
  | (BlockBase & { type: 'quote'; html: string })
  | (BlockBase & { type: 'image'; src: string; alt?: string })

export type BlockType = Block['type']

/** Metadata of one screen capture (§7, §17). Stored with the note, never shown inline. */
export interface OcrSource {
  id: string
  capturedAt: number
  /** Image id of the original screenshot in the note's image folder (snap-media://noteId/imageId.png). */
  imageId?: string
  imageWidth?: number
  imageHeight?: number
  appName?: string
  windowTitle?: string
  url?: string
  /** Provider that produced the result, e.g. "Gemini", "Tesseract". */
  method?: string
  model?: string
  mode?: string
  /** Normalized recognition quality, present only when the recognizer reported real confidences. */
  quality?: 'HIGH' | 'MEDIUM' | 'LOW'
  /** The OCR queue job that produced (or is going to produce) this fragment. */
  jobId?: string
  /** Recognition failed for this capture: the fragment is a placeholder with a "Retry" button. */
  failed?: boolean
}

// ---------------------------------------------------------------------------------------------
// ids

let counter = 0
export function newBlockId(): string {
  counter = (counter + 1) % 1_000_000
  return `b${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/

// ---------------------------------------------------------------------------------------------
// escaping / inline sanitizing

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const INLINE_TAGS: Record<string, string> = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
  u: 'u',
  s: 's',
  strike: 's',
  del: 's',
  code: 'code',
  mark: 'mark',
  sub: 'sub',
  sup: 'sup'
}
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0?\.\d+|1(\.0+)?)\s*\))$/
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:)[^\s"'<>]+$/i

function attr(el: DomElement, name: string): string {
  return el.attribs?.[name] ?? ''
}

function classes(el: DomElement): string[] {
  return attr(el, 'class').split(/\s+/).filter(Boolean)
}

function highlightColor(el: DomElement): string | null {
  const match = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(attr(el, 'style'))
  if (!match) return null
  const value = match[1].trim()
  if (!SAFE_COLOR.test(value)) return null
  if (/rgba\([^)]*,\s*0(\.0+)?\s*\)$/.test(value)) return null
  return value
}

function serializeInlineNodes(nodes: AnyNode[]): string {
  let out = ''
  for (const node of nodes) out += serializeInline(node)
  return out
}

function serializeInline(node: AnyNode): string {
  if (isText(node)) return escapeHtml(decodeEntities(node.data))
  if (!isTag(node)) return ''
  const tag = node.name.toLowerCase()
  const inner = (): string => serializeInlineNodes(node.children)
  if (tag === 'br') return '<br>'
  if (tag in INLINE_TAGS) {
    const content = inner()
    return content ? `<${INLINE_TAGS[tag]}>${content}</${INLINE_TAGS[tag]}>` : ''
  }
  if (tag === 'a') {
    const href = attr(node, 'href').trim()
    const content = inner()
    if (!content) return ''
    return SAFE_HREF.test(href) ? `<a href="${escapeHtml(href)}">${content}</a>` : content
  }
  if (tag === 'span') {
    const cls = classes(node)
    const content = inner()
    if (!content) return ''
    if (cls.includes('ui-chip')) return `<span class="ui-chip">${content}</span>`
    if (cls.includes('ocr-uncertain')) {
      const conf = Number(attr(node, 'data-conf'))
      const confAttr = Number.isFinite(conf) && conf >= 0 && conf <= 1 ? ` data-conf="${conf}"` : ''
      const bbox = attr(node, 'data-bbox')
      const bboxAttr = /^\d+(\.\d+)?(,\d+(\.\d+)?){3}$/.test(bbox) ? ` data-bbox="${bbox}"` : ''
      return `<span class="ocr-uncertain"${confAttr}${bboxAttr}>${content}</span>`
    }
    const color = highlightColor(node)
    return color ? `<span style="background-color:${color}">${content}</span>` : content
  }
  // Unknown inline wrapper (font, label, …): keep its text, drop the tag.
  return inner()
}

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    const known = ENTITY_MAP[m.toLowerCase()]
    if (known) return known
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (Number.isFinite(code) && code > 0 && code < 0x110000) return String.fromCodePoint(code)
    }
    return m
  })
}

/** Rebuilds inline HTML from an allowlist. Anything else is reduced to its text. */
export function sanitizeInline(html: string): string {
  if (!html) return ''
  const doc = parseDocument(html, { decodeEntities: false })
  return trimBreaks(serializeInlineNodes(doc.children))
}

function trimBreaks(html: string): string {
  return html.replace(/^(\s|<br>)+/, '').replace(/(\s|<br>)+$/, '')
}

/** Plain text → inline HTML, with URLs and e-mails turned into links (text itself unchanged). */
export function textToInline(text: string): string {
  const pattern = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g
  let out = ''
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, match.index))
    const value = match[0]
    const href = match[1] ? value : `mailto:${value}`
    out += `<a href="${escapeHtml(href)}">${escapeHtml(value)}</a>`
    last = match.index + value.length
  }
  out += escapeHtml(text.slice(last))
  return out.replace(/\n/g, '<br>')
}

/** Inline HTML → plain text. */
export function inlineToText(html: string): string {
  if (!html) return ''
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  ).replace(/ /g, ' ')
}

/**
 * Marks fragments a recognizer was unsure about. `fragments` are exact substrings of the plain text;
 * each first occurrence (outside tags) is wrapped in <span class="ocr-uncertain">.
 */
export function markUncertain(inlineHtml: string, fragments: string[] | undefined): string {
  if (!fragments || fragments.length === 0) return inlineHtml
  let html = inlineHtml
  for (const fragment of fragments) {
    const needle = escapeHtml(fragment.trim())
    if (needle.length < 1 || needle.length > 200) continue
    // Only replace text outside tags and not already inside an uncertain span.
    const parts = html.split(/(<[^>]+>)/)
    let done = false
    let insideUncertain = 0
    for (let i = 0; i < parts.length && !done; i++) {
      const part = parts[i]
      if (part.startsWith('<')) {
        if (/^<span class="ocr-uncertain"/.test(part)) insideUncertain++
        else if (part === '</span>' && insideUncertain > 0) insideUncertain--
        continue
      }
      if (insideUncertain > 0) continue
      const index = part.indexOf(needle)
      if (index === -1) continue
      parts[i] = `${part.slice(0, index)}<span class="ocr-uncertain">${needle}</span>${part.slice(index + needle.length)}`
      done = true
    }
    html = parts.join('')
  }
  return html
}

// ---------------------------------------------------------------------------------------------
// validation of untrusted blocks (IPC, disk)

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Validates and re-sanitizes blocks from any untrusted source. Invalid entries are dropped. */
export function normalizeBlocks(value: unknown): Block[] {
  if (!Array.isArray(value)) return []
  const result: Block[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const b = raw as Record<string, unknown>
    const base: BlockBase = {
      id: typeof b.id === 'string' && SAFE_ID.test(b.id) ? b.id : newBlockId(),
      ...(typeof b.sourceId === 'string' && SAFE_ID.test(b.sourceId) ? { sourceId: b.sourceId } : {}),
      ...(typeof b.confidence === 'number' && b.confidence >= 0 && b.confidence <= 1 ? { confidence: b.confidence } : {})
    }
    switch (b.type) {
      case 'heading': {
        const level = b.level === 1 || b.level === 2 || b.level === 3 ? b.level : 2
        const html = sanitizeInline(str(b.html))
        if (html) result.push({ ...base, type: 'heading', level, html })
        break
      }
      case 'paragraph': {
        const html = sanitizeInline(str(b.html))
        if (html) result.push({ ...base, type: 'paragraph', html, ...(b.tone === 'warning' ? { tone: 'warning' as const } : {}) })
        break
      }
      case 'quote': {
        const html = sanitizeInline(str(b.html))
        if (html) result.push({ ...base, type: 'quote', html })
        break
      }
      case 'bullet_list':
      case 'numbered_list': {
        const items = Array.isArray(b.items) ? b.items.map((i) => sanitizeInline(str(i))).filter(Boolean) : []
        if (items.length === 0) break
        if (b.type === 'bullet_list') result.push({ ...base, type: 'bullet_list', items })
        else {
          const start = typeof b.start === 'number' && Number.isInteger(b.start) && b.start > 1 ? b.start : undefined
          result.push({ ...base, type: 'numbered_list', items, ...(start ? { start } : {}) })
        }
        break
      }
      case 'checklist': {
        const items = Array.isArray(b.items)
          ? b.items
              .map((i) => (i && typeof i === 'object' ? (i as Record<string, unknown>) : {}))
              .map((i) => ({ html: sanitizeInline(str(i.html)), done: i.done === true }))
              .filter((i) => i.html)
          : []
        if (items.length) result.push({ ...base, type: 'checklist', items })
        break
      }
      case 'table': {
        const rows = Array.isArray(b.rows)
          ? b.rows.filter(Array.isArray).map((row) => (row as unknown[]).map((c) => sanitizeInline(str(c))))
          : []
        const width = Math.max(0, ...rows.map((r) => r.length))
        const padded = rows.filter((r) => r.some(Boolean)).map((r) => [...r, ...Array(width - r.length).fill('')])
        if (padded.length) result.push({ ...base, type: 'table', rows: padded, header: b.header !== false })
        break
      }
      case 'code': {
        const code = str(b.code).replace(/\r\n?/g, '\n')
        const language = str(b.language).trim().toLowerCase().replace(/[^a-z0-9+#._-]/g, '').slice(0, 32)
        if (code.trim()) result.push({ ...base, type: 'code', code, ...(language ? { language } : {}) })
        break
      }
      case 'image': {
        const src = str(b.src)
        if (/^snap-media:\/\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.png$/.test(src)) {
          result.push({ ...base, type: 'image', src, ...(typeof b.alt === 'string' ? { alt: b.alt.slice(0, 300) } : {}) })
        }
        break
      }
      default:
        break
    }
  }
  return result
}

// ---------------------------------------------------------------------------------------------
// HTML (editor / legacy v1 body) → blocks

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'pre', 'blockquote', 'figure', 'img', 'hr', 'section', 'article'])

function sourceOf(el: DomElement): Pick<BlockBase, 'sourceId'> {
  const id = attr(el, 'data-src')
  return SAFE_ID.test(id) ? { sourceId: id } : {}
}

function idOf(el: DomElement): string {
  const id = attr(el, 'data-block')
  return SAFE_ID.test(id) ? id : newBlockId()
}

/** Has a block-level child other than <img> (images inside paragraphs are split out in place). */
function hasBlockChild(el: DomElement): boolean {
  return el.children.some((c) => isTag(c) && c.name.toLowerCase() !== 'img' && BLOCK_TAGS.has(c.name.toLowerCase()))
}

function textContent(node: AnyNode): string {
  if (isText(node)) return decodeEntities(node.data)
  if (!isTag(node)) return ''
  if (node.name.toLowerCase() === 'br') return '\n'
  return node.children.map(textContent).join('')
}

function findTags(el: DomElement, name: string, stopAt?: string): DomElement[] {
  const found: DomElement[] = []
  for (const child of el.children) {
    if (!isTag(child)) continue
    const tag = child.name.toLowerCase()
    if (tag === name) found.push(child)
    if (stopAt && tag === stopAt) continue
    found.push(...findTags(child, name, stopAt))
  }
  return found
}

function imageBlock(el: DomElement, extra: Pick<BlockBase, 'sourceId'>): Block | null {
  const src = attr(el, 'src')
  if (!/^snap-media:\/\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.png$/.test(src)) return null
  const alt = attr(el, 'alt')
  const own = sourceOf(el)
  return { id: idOf(el), ...extra, ...own, type: 'image', src, ...(alt ? { alt } : {}) }
}

/** Splits a paragraph-like element around embedded <img>s, so images become their own blocks. */
function paragraphLike(el: DomElement, out: Block[], make: (html: string, first: boolean) => Block | null): void {
  const extra = sourceOf(el)
  let buffer: AnyNode[] = []
  let first = true
  const flush = (): void => {
    const html = trimBreaks(serializeInlineNodes(buffer))
    buffer = []
    if (!html || !inlineToText(html).trim()) return
    const block = make(html, first)
    first = false
    if (block) out.push(block)
  }
  const walk = (nodes: AnyNode[]): void => {
    for (const node of nodes) {
      if (isTag(node) && node.name.toLowerCase() === 'img') {
        flush()
        const img = imageBlock(node, extra)
        if (img) out.push(img)
      } else if (isTag(node) && !(node.name.toLowerCase() in INLINE_TAGS) && node.children.some((c) => isTag(c) && c.name.toLowerCase() === 'img')) {
        walk(node.children)
      } else {
        buffer.push(node)
      }
    }
  }
  walk(el.children)
  flush()
}

function listItems(el: DomElement): DomElement[] {
  // Nested lists are flattened into the parent list (items keep their text).
  return findTags(el, 'li')
}

function liInline(li: DomElement): string {
  const own = li.children.filter((c) => !(isTag(c) && (c.name === 'ul' || c.name === 'ol')))
  return trimBreaks(serializeInlineNodes(own))
}

function blockFromElement(el: DomElement, out: Block[]): void {
  const tag = el.name.toLowerCase()
  const extra = sourceOf(el)
  const cls = classes(el)

  if (tag === 'img') {
    const img = imageBlock(el, extra)
    if (img) out.push(img)
    return
  }
  if (tag === 'hr') return
  if (/^h[1-6]$/.test(tag)) {
    const level = Math.min(3, Number(tag[1])) as 1 | 2 | 3
    paragraphLike(el, out, (html, first) => ({ id: first ? idOf(el) : newBlockId(), ...extra, type: 'heading', level, html }))
    return
  }
  if (tag === 'pre') {
    const codeEl = findTags(el, 'code')[0]
    const langClass = (codeEl ? classes(codeEl) : cls).find((c) => c.startsWith('language-'))
    const language = attr(el, 'data-lang') || (langClass ? langClass.slice('language-'.length) : '')
    const code = textContent(el).replace(/ /g, ' ').replace(/\n$/, '')
    if (code.trim()) out.push({ id: idOf(el), ...extra, type: 'code', code, ...(language ? { language: language.toLowerCase() } : {}) })
    return
  }
  if (tag === 'blockquote') {
    if (hasBlockChild(el)) {
      for (const child of el.children) if (isTag(child)) blockFromElement(child, out)
      return
    }
    paragraphLike(el, out, (html, first) => ({ id: first ? idOf(el) : newBlockId(), ...extra, type: 'quote', html }))
    return
  }
  if (tag === 'ul' || tag === 'ol') {
    const items = listItems(el)
    if (cls.includes('todo-list') || items.some((li) => classes(li).includes('todo-item'))) {
      const list = items
        .map((li) => ({ html: liInline(li), done: classes(li).includes('done') }))
        .filter((i) => inlineToText(i.html).trim())
      if (list.length) out.push({ id: idOf(el), ...extra, type: 'checklist', items: list })
      return
    }
    const htmlItems = items.map(liInline).filter((h) => inlineToText(h).trim())
    if (!htmlItems.length) return
    if (tag === 'ul') out.push({ id: idOf(el), ...extra, type: 'bullet_list', items: htmlItems })
    else {
      const start = Number(attr(el, 'start'))
      out.push({ id: idOf(el), ...extra, type: 'numbered_list', items: htmlItems, ...(Number.isInteger(start) && start > 1 ? { start } : {}) })
    }
    // Images inside list items are kept as blocks after the list.
    for (const img of findTags(el, 'img')) {
      const block = imageBlock(img, extra)
      if (block) out.push(block)
    }
    return
  }
  if (tag === 'table') {
    const rows: string[][] = []
    let header = false
    for (const tr of findTags(el, 'tr', 'table')) {
      const cells = tr.children.filter((c): c is DomElement => isTag(c) && (c.name === 'td' || c.name === 'th'))
      if (rows.length === 0 && cells.length > 0 && cells.every((c) => c.name === 'th')) header = true
      if (rows.length === 0 && tr.parent && isTag(tr.parent) && tr.parent.name === 'thead') header = true
      const row: string[] = []
      for (const cell of cells) {
        row.push(trimBreaks(serializeInlineNodes(cell.children)))
        const span = Number(attr(cell, 'colspan'))
        for (let i = 1; Number.isInteger(span) && i < Math.min(span, 20); i++) row.push('')
      }
      rows.push(row)
    }
    const width = Math.max(0, ...rows.map((r) => r.length))
    const padded = rows.filter((r) => r.some((c) => inlineToText(c).trim())).map((r) => [...r, ...Array(width - r.length).fill('')])
    if (padded.length) out.push({ id: idOf(el), ...extra, type: 'table', rows: padded, header: header || attr(el, 'data-header') === 'true' })
    return
  }
  if (hasBlockChild(el)) {
    // Wrapper (div/section/figure with blocks inside): walk children, grouping loose inline runs.
    walkContainer(el.children, out, extra)
    return
  }
  const tone = cls.includes('ocr-flag') ? ({ tone: 'warning' } as const) : {}
  paragraphLike(el, out, (html, first) => ({ id: first ? idOf(el) : newBlockId(), ...extra, type: 'paragraph', html, ...tone }))
}

function walkContainer(nodes: AnyNode[], out: Block[], inherited: Pick<BlockBase, 'sourceId'> = {}): void {
  let loose: AnyNode[] = []
  const flushLoose = (): void => {
    if (loose.length === 0) return
    const wrapper = { name: 'p', attribs: {}, children: loose } as unknown as DomElement
    const before = out.length
    paragraphLike(wrapper, out, (html) => ({ id: newBlockId(), ...inherited, type: 'paragraph', html }))
    for (let i = before; i < out.length; i++) if (inherited.sourceId && !out[i].sourceId) out[i].sourceId = inherited.sourceId
    loose = []
  }
  for (const node of nodes) {
    if (isTag(node) && BLOCK_TAGS.has(node.name.toLowerCase())) {
      flushLoose()
      const before = out.length
      blockFromElement(node, out)
      for (let i = before; i < out.length; i++) if (inherited.sourceId && !out[i].sourceId) out[i].sourceId = inherited.sourceId
    } else if (isTag(node) && node.name.toLowerCase() === 'br' && loose.length === 0) {
      continue
    } else {
      loose.push(node)
    }
  }
  flushLoose()
}

/** Any note HTML (legacy v1 body or the editor's contentEditable) → blocks. */
export function htmlToBlocks(html: string): Block[] {
  if (!html || !html.trim()) return []
  const doc = parseDocument(html, { decodeEntities: false })
  const out: Block[] = []
  walkContainer(doc.children, out)
  return out
}

// ---------------------------------------------------------------------------------------------
// blocks → editor HTML

function dataAttrs(block: Block): string {
  return ` data-block="${block.id}"${block.sourceId ? ` data-src="${block.sourceId}"` : ''}`
}

/**
 * Blocks → HTML for the note editor (and the v1-compatible `body` field). Round-trips through
 * htmlToBlocks: ids and OCR source links survive as data-block / data-src attributes.
 */
export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((block) => {
      const a = dataAttrs(block)
      switch (block.type) {
        case 'heading':
          return `<h${block.level}${a}>${block.html}</h${block.level}>`
        case 'paragraph':
          return `<p${a}${block.tone === 'warning' ? ' class="ocr-flag"' : ''}>${block.html}</p>`
        case 'quote':
          return `<blockquote${a}>${block.html}</blockquote>`
        case 'bullet_list':
          return `<ul${a}>${block.items.map((i) => `<li>${i}</li>`).join('')}</ul>`
        case 'numbered_list':
          return `<ol${a}${block.start ? ` start="${block.start}"` : ''}>${block.items.map((i) => `<li>${i}</li>`).join('')}</ol>`
        case 'checklist':
          return `<ul${a} class="todo-list">${block.items
            .map((i) => `<li class="todo-item${i.done ? ' done' : ''}">${i.html}</li>`)
            .join('')}</ul>`
        case 'table': {
          const [first, ...rest] = block.rows
          const cell = (tag: 'td' | 'th', c: string): string => `<${tag}>${c}</${tag}>`
          const head = block.header && first ? `<thead><tr>${first.map((c) => cell('th', c)).join('')}</tr></thead>` : ''
          const bodyRows = (block.header ? rest : block.rows).map((r) => `<tr>${r.map((c) => cell('td', c)).join('')}</tr>`).join('')
          return `<table${a}>${head}<tbody>${bodyRows}</tbody></table>`
        }
        case 'code':
          return `<pre${a}${block.language ? ` data-lang="${escapeHtml(block.language)}"` : ''}><code>${escapeHtml(block.code)}</code></pre>`
        case 'image':
          return `<p><img${a} class="doc-image" src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt ?? '')}"></p>`
        default:
          return ''
      }
    })
    .join('')
}

/** Plain text of one block (search, previews, dedupe). */
export function blockText(block: Block): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return inlineToText(block.html)
    case 'bullet_list':
    case 'numbered_list':
      return block.items.map(inlineToText).join('\n')
    case 'checklist':
      return block.items.map((i) => inlineToText(i.html)).join('\n')
    case 'table':
      return block.rows.map((r) => r.map(inlineToText).join(' | ')).join('\n')
    case 'code':
      return block.code
    case 'image':
      return ''
    default:
      return ''
  }
}

export function blocksToText(blocks: Block[]): string {
  return blocks.map(blockText).filter(Boolean).join('\n')
}
