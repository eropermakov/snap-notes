/**
 * Block → Markdown / plain text / rich HTML. Pure functions shared by clipboard copy, "Copy for AI",
 * file export (TXT/MD/PDF) and the renderer. Output never contains block ids, source ids or other
 * Snap Notes metadata.
 */
import { parseDocument } from 'htmlparser2'
import { isTag, isText, type AnyNode } from 'domhandler'
import { escapeHtml, inlineToText, type Block } from './blocks'

// ---------------------------------------------------------------------------------------------
// Markdown

function mdEscapeText(text: string): string {
  // Minimal escaping: enough to keep literal text literal, readable for people and AI chats.
  return text.replace(/\\/g, '\\\\').replace(/([*`[\]<])/g, '\\$1').replace(/ /g, ' ')
}

function inlineToMarkdown(html: string): string {
  if (!html) return ''
  const doc = parseDocument(html)
  const walk = (nodes: AnyNode[]): string =>
    nodes
      .map((node) => {
        if (isText(node)) return mdEscapeText(node.data)
        if (!isTag(node)) return ''
        const inner = walk(node.children)
        switch (node.name) {
          case 'br':
            return '\n'
          case 'strong':
          case 'b':
            return inner.trim() ? `**${inner}**` : inner
          case 'em':
          case 'i':
            return inner.trim() ? `*${inner}*` : inner
          case 's':
            return inner.trim() ? `~~${inner}~~` : inner
          case 'code': {
            // Already entity-decoded by the parser: take the text as is (code may contain "<b>").
            const raw = node.children.map((c) => (isText(c) ? c.data : '')).join('')
            const ticks = '`'.repeat(Math.max(1, ...(raw.match(/`+/g) ?? []).map((m) => m.length + 1)))
            return `${ticks}${raw}${ticks}`
          }
          case 'a': {
            const href = node.attribs.href ?? ''
            const label = inner || href
            if (href.startsWith('mailto:') && label === href.slice(7)) return label
            if (label === href) return `<${href}>`
            return `[${label}](${href})`
          }
          default:
            return inner
        }
      })
      .join('')
  return walk(doc.children)
}

function mdCell(html: string): string {
  return inlineToMarkdown(html).replace(/\|/g, '\\|').replace(/\n/g, '<br>').trim()
}

export function tableToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const line = (r: string[]): string => `| ${Array.from({ length: width }, (_, i) => mdCell(r[i] ?? '')).join(' | ')} |`
  const [head, ...body] = rows
  return [line(head), `|${Array(width).fill('---').join('|')}|`, ...body.map(line)].join('\n')
}

function codeFence(code: string, language?: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((m) => m.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${language ?? ''}\n${code.replace(/\n$/, '')}\n${fence}`
}

function indentContinuation(text: string, indent: string): string {
  return text.split('\n').join(`\n${indent}`)
}

export interface MarkdownOptions {
  /** Note title as a top-level "# " heading. */
  title?: string
  /** Called for image blocks; return a Markdown image/link or null to drop the image. */
  image?: (src: string, alt: string) => string | null
}

export function blocksToMarkdown(blocks: Block[], options: MarkdownOptions = {}): string {
  const parts: string[] = []
  if (options.title?.trim()) parts.push(`# ${mdEscapeText(options.title.trim())}`)
  // With a title, content headings shift down one level so the document keeps a single "#".
  const shift = options.title?.trim() ? 1 : 0
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        parts.push(`${'#'.repeat(Math.min(6, block.level + shift))} ${inlineToMarkdown(block.html).replace(/\n/g, ' ')}`)
        break
      case 'paragraph':
        parts.push(inlineToMarkdown(block.html).replace(/\n/g, '  \n'))
        break
      case 'quote':
        parts.push(inlineToMarkdown(block.html).split('\n').map((l) => `> ${l}`).join('\n'))
        break
      case 'bullet_list':
        parts.push(block.items.map((i) => `- ${indentContinuation(inlineToMarkdown(i), '  ')}`).join('\n'))
        break
      case 'numbered_list': {
        const start = block.start ?? 1
        parts.push(block.items.map((i, n) => `${start + n}. ${indentContinuation(inlineToMarkdown(i), '   ')}`).join('\n'))
        break
      }
      case 'checklist':
        parts.push(block.items.map((i) => `- [${i.done ? 'x' : ' '}] ${inlineToMarkdown(i.html)}`).join('\n'))
        break
      case 'table':
        parts.push(tableToMarkdown(block.rows))
        break
      case 'code':
        parts.push(codeFence(block.code, block.language))
        break
      case 'image': {
        const rendered = options.image?.(block.src, block.alt ?? '')
        if (rendered) parts.push(rendered)
        break
      }
      default:
        break
    }
  }
  return parts.filter((p) => p.trim()).join('\n\n') + '\n'
}

/**
 * "Copy for AI": clean Markdown for ChatGPT/Claude/Gemini. No Snap Notes metadata; images are
 * mentioned as a placeholder because a chat cannot load local snap-media:// files.
 */
export function blocksToAiMarkdown(blocks: Block[], title?: string): string {
  return blocksToMarkdown(blocks, { title, image: (_src, alt) => `[Изображение${alt ? `: ${alt}` : ''}]` })
}

// ---------------------------------------------------------------------------------------------
// Plain text / TSV / CSV

export function tableToTsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => inlineToText(c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n')
}

export function tableToCsv(rows: string[][]): string {
  const cell = (c: string): string => {
    const text = inlineToText(c)
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n')
}

export function blocksToPlainText(blocks: Block[], title?: string): string {
  const parts: string[] = []
  if (title?.trim()) parts.push(title.trim())
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'quote':
        parts.push(inlineToText(block.html))
        break
      case 'bullet_list':
        parts.push(block.items.map((i) => `• ${inlineToText(i)}`).join('\n'))
        break
      case 'numbered_list':
        parts.push(block.items.map((i, n) => `${(block.start ?? 1) + n}. ${inlineToText(i)}`).join('\n'))
        break
      case 'checklist':
        parts.push(block.items.map((i) => `${i.done ? '☑' : '☐'} ${inlineToText(i.html)}`).join('\n'))
        break
      case 'table':
        parts.push(tableToTsv(block.rows))
        break
      case 'code':
        parts.push(block.code)
        break
      default:
        break
    }
  }
  return parts.filter((p) => p.trim()).join('\n\n') + '\n'
}

// ---------------------------------------------------------------------------------------------
// Rich HTML (clipboard for Word/Docs, PDF)

const FONT = "font-family:'Segoe UI',Calibri,Arial,sans-serif"
const MONO = "font-family:Consolas,'Cascadia Mono','Courier New',monospace"

/** Inline HTML for foreign apps: app-only classes become plain formatting. */
function portableInline(html: string): string {
  return html
    .replace(/<span class="ocr-uncertain"[^>]*>/g, '<span>')
    .replace(/<span class="ui-chip">([\s\S]*?)<\/span>/g, '[$1]')
    .replace(/<code>/g, `<code style="${MONO};font-size:0.95em">`)
}

export interface RichHtmlOptions {
  title?: string
  /** snap-media:// → data: URL, so images survive the trip into Word / a PDF renderer. */
  resolveImage?: (src: string) => string | null
  /** Wrap in a full HTML document (for PDF printing). */
  document?: boolean
}

/** HTML with inline styles that Word, Google Docs and Outlook keep on paste. */
export function blocksToRichHtml(blocks: Block[], options: RichHtmlOptions = {}): string {
  const out: string[] = []
  if (options.title?.trim()) out.push(`<h1 style="${FONT};font-size:20pt;margin:0 0 10pt">${escapeHtml(options.title.trim())}</h1>`)
  const cellStyle = 'border:1px solid #9aa0a6;padding:4pt 6pt;vertical-align:top;text-align:left'
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const size = block.level === 1 ? 16 : block.level === 2 ? 14 : 12
        out.push(`<h${block.level + 1} style="${FONT};font-size:${size}pt;margin:12pt 0 6pt">${portableInline(block.html)}</h${block.level + 1}>`)
        break
      }
      case 'paragraph':
        out.push(`<p style="${FONT};margin:0 0 8pt${block.tone === 'warning' ? ';color:#c5372c;font-style:italic' : ''}">${portableInline(block.html)}</p>`)
        break
      case 'quote':
        out.push(`<blockquote style="${FONT};margin:0 0 8pt 12pt;padding-left:8pt;border-left:3px solid #c0c4c8;color:#444">${portableInline(block.html)}</blockquote>`)
        break
      case 'bullet_list':
        out.push(`<ul style="${FONT};margin:0 0 8pt">${block.items.map((i) => `<li>${portableInline(i)}</li>`).join('')}</ul>`)
        break
      case 'numbered_list':
        out.push(`<ol style="${FONT};margin:0 0 8pt"${block.start ? ` start="${block.start}"` : ''}>${block.items.map((i) => `<li>${portableInline(i)}</li>`).join('')}</ol>`)
        break
      case 'checklist':
        out.push(block.items.map((i) => `<p style="${FONT};margin:0 0 2pt">${i.done ? '☑' : '☐'} ${portableInline(i.html)}</p>`).join(''))
        break
      case 'table': {
        const rows = block.rows
          .map((r, n) => {
            const tag = block.header && n === 0 ? 'th' : 'td'
            const extra = tag === 'th' ? ';font-weight:bold;background:#f1f3f4' : ''
            return `<tr>${r.map((c) => `<${tag} style="${cellStyle}${extra}">${portableInline(c)}</${tag}>`).join('')}</tr>`
          })
          .join('')
        out.push(`<table style="${FONT};border-collapse:collapse;margin:0 0 8pt">${rows}</table>`)
        break
      }
      case 'code':
        out.push(`<pre style="${MONO};font-size:10pt;background:#f5f6f7;border:1px solid #e3e5e8;padding:6pt;white-space:pre-wrap;margin:0 0 8pt">${escapeHtml(block.code)}</pre>`)
        break
      case 'image': {
        const src = options.resolveImage?.(block.src)
        if (src) out.push(`<p style="margin:0 0 8pt"><img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt ?? '')}" style="max-width:100%"></p>`)
        break
      }
      default:
        break
    }
  }
  const body = out.join('')
  if (!options.document) return body
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(options.title ?? '')}</title><style>body{margin:0;padding:0;color:#202124}img{max-width:100%}</style></head><body>${body}</body></html>`
}
