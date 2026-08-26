import { dialog, BrowserWindow, nativeImage } from 'electron'
import { promises as fs } from 'fs'
import { parseDocument } from 'htmlparser2'
import { isTag, isText, type AnyNode, type Element as DomElement } from 'domhandler'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType
} from 'docx'
import { ExportResult, Note } from '../shared/types'
import { readNoteImage } from './imageStore'

type Run = TextRun | ImageRun
type Block = Paragraph | Table

interface InlineStyle {
  bold?: boolean
  italics?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
}

const MAX_IMAGE_WIDTH_PX = 600
const SNAP_MEDIA_SRC = /^snap-media:\/\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\.png$/

function normalizeColor(value: string): string | undefined {
  const hex3 = /^#([0-9a-fA-F]{3})$/.exec(value)
  if (hex3) {
    const [r, g, b] = hex3[1].split('')
    return `${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  const hex6 = /^#([0-9a-fA-F]{6})/.exec(value)
  if (hex6) return hex6[1].toUpperCase()
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value)
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  }
  return undefined
}

async function imageRunFromSrc(src: string): Promise<ImageRun | null> {
  const match = SNAP_MEDIA_SRC.exec(src)
  if (!match) return null
  const buffer = await readNoteImage(match[1], match[2])
  if (!buffer) return null

  const { width, height } = nativeImage.createFromBuffer(buffer).getSize()
  if (!width || !height) return null
  const scale = width > MAX_IMAGE_WIDTH_PX ? MAX_IMAGE_WIDTH_PX / width : 1

  return new ImageRun({
    type: 'png',
    data: buffer,
    transformation: { width: Math.round(width * scale), height: Math.round(height * scale) }
  })
}

async function collectRuns(node: AnyNode, style: InlineStyle, runs: Run[]): Promise<void> {
  if (isText(node)) {
    if (node.data) {
      runs.push(
        new TextRun({
          text: node.data,
          bold: style.bold,
          italics: style.italics,
          underline: style.underline ? {} : undefined,
          strike: style.strike,
          color: style.color
        })
      )
    }
    return
  }
  if (!isTag(node)) return

  const tag = node.name.toLowerCase()

  if (tag === 'img') {
    const src = node.attribs.src ?? ''
    const run = await imageRunFromSrc(src)
    if (run) runs.push(run)
    return
  }
  if (tag === 'br') {
    runs.push(new TextRun({ text: '', break: 1 }))
    return
  }

  const nextStyle: InlineStyle = { ...style }
  if (tag === 'b' || tag === 'strong') nextStyle.bold = true
  if (tag === 'i' || tag === 'em') nextStyle.italics = true
  if (tag === 'u') nextStyle.underline = true
  if (tag === 's' || tag === 'strike') nextStyle.strike = true
  if (tag === 'span') {
    const styleAttr = node.attribs.style ?? ''
    const colorMatch = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(styleAttr)
    if (colorMatch) {
      const normalized = normalizeColor(colorMatch[1].trim())
      if (normalized) nextStyle.color = normalized
    }
  }

  const isChip = tag === 'span' && (node.attribs.class ?? '').split(/\s+/).includes('ui-chip')
  if (isChip) runs.push(new TextRun({ text: '«', bold: style.bold, italics: style.italics }))

  for (const child of node.children) {
    await collectRuns(child, nextStyle, runs)
  }

  if (isChip) runs.push(new TextRun({ text: '»', bold: style.bold, italics: style.italics }))
}

function findDescendantTags(el: DomElement, tagName: string): DomElement[] {
  const found: DomElement[] = []
  for (const child of el.children) {
    if (isTag(child)) {
      if (child.name.toLowerCase() === tagName) found.push(child)
      found.push(...findDescendantTags(child, tagName))
    }
  }
  return found
}

async function blockToDocxElements(el: DomElement): Promise<Block[]> {
  const tag = el.name.toLowerCase()

  if (tag === 'h3') {
    const runs: Run[] = []
    for (const c of el.children) await collectRuns(c, {}, runs)
    return [new Paragraph({ heading: HeadingLevel.HEADING_3, children: runs })]
  }

  if (tag === 'p' || tag === 'div') {
    const isFlag = (el.attribs.class ?? '').split(/\s+/).includes('ocr-flag')
    const runs: Run[] = []
    for (const c of el.children) await collectRuns(c, isFlag ? { italics: true, color: 'CC3333' } : {}, runs)
    return [new Paragraph({ children: runs })]
  }

  if (tag === 'ul' || tag === 'ol') {
    const isTodo = (el.attribs.class ?? '').split(/\s+/).includes('todo-list')
    const paragraphs: Paragraph[] = []
    let index = 1
    for (const li of el.children) {
      if (!isTag(li) || li.name.toLowerCase() !== 'li') continue
      const done = (li.attribs.class ?? '').split(/\s+/).includes('done')
      const prefix = isTodo ? (done ? '☑ ' : '☐ ') : tag === 'ol' ? `${index}. ` : '• '
      const runs: Run[] = [new TextRun({ text: prefix })]
      for (const c of li.children) await collectRuns(c, done ? { strike: true } : {}, runs)
      paragraphs.push(new Paragraph({ children: runs, indent: { left: 360 } }))
      index++
    }
    return paragraphs
  }

  if (tag === 'table') {
    const rows: TableRow[] = []
    for (const tr of findDescendantTags(el, 'tr')) {
      const cells: TableCell[] = []
      for (const cell of tr.children) {
        if (!isTag(cell)) continue
        const cellTag = cell.name.toLowerCase()
        if (cellTag !== 'td' && cellTag !== 'th') continue
        const runs: Run[] = []
        for (const c of cell.children) await collectRuns(c, cellTag === 'th' ? { bold: true } : {}, runs)
        cells.push(new TableCell({ children: [new Paragraph({ children: runs })] }))
      }
      if (cells.length > 0) rows.push(new TableRow({ children: cells }))
    }
    if (rows.length === 0) return []
    return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })]
  }

  // Unknown block-level wrapper (shouldn't happen given the app's own sanitizer, but stay defensive):
  // flatten its text content into a single paragraph rather than dropping it silently.
  const runs: Run[] = []
  for (const c of el.children) await collectRuns(c, {}, runs)
  return runs.length > 0 ? [new Paragraph({ children: runs })] : []
}

async function noteBodyToDocxElements(html: string): Promise<Block[]> {
  const root = parseDocument(html)
  const elements: Block[] = []
  for (const node of root.children) {
    if (isTag(node)) {
      elements.push(...(await blockToDocxElements(node)))
    }
  }
  return elements
}

export async function exportNotesToDocx(win: BrowserWindow, notes: Note[]): Promise<ExportResult> {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Экспорт в Word',
    defaultPath: `snap-notes-export-${new Date().toISOString().slice(0, 10)}.docx`,
    filters: [{ name: 'Документ Word', extensions: ['docx'] }]
  })

  if (canceled || !filePath) {
    return { ok: false, canceled: true }
  }

  try {
    const children: Block[] = []

    for (const note of notes) {
      const title = note.title.trim() || 'Без названия'
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: title })] }))

      const created = new Date(note.createdAt).toLocaleString('ru-RU')
      children.push(
        new Paragraph({ children: [new TextRun({ text: `Создано: ${created}`, italics: true, color: '888888' })] })
      )

      children.push(...(await noteBodyToDocxElements(note.body)))
      children.push(new Paragraph({ children: [], spacing: { after: 400 } }))
    }

    const doc = new Document({ sections: [{ children }] })
    const buffer = await Packer.toBuffer(doc)
    await fs.writeFile(filePath, buffer)
    return { ok: true, path: filePath }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
