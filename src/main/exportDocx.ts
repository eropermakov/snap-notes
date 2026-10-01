import { dialog, BrowserWindow, nativeImage } from 'electron'
import { promises as fs } from 'fs'
import { parseDocument } from 'htmlparser2'
import { isTag, isText, type AnyNode } from 'domhandler'
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
  WidthType,
  ShadingType,
  BorderStyle
} from 'docx'
import { ExportResult, Note } from '../shared/types'
import { htmlToBlocks, type Block } from '../shared/blocks'
import { readNoteImage } from './imageStore'

type Run = TextRun | ImageRun
type DocxBlock = Paragraph | Table

interface InlineStyle {
  bold?: boolean
  italics?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  highlight?: boolean
  mono?: boolean
}

const MAX_IMAGE_WIDTH_PX = 600
const SNAP_MEDIA_SRC = /^snap-media:\/\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\.png$/
const MONO_FONT = 'Consolas'

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

function textRun(text: string, style: InlineStyle, extra: { break?: number } = {}): TextRun {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    underline: style.underline ? {} : undefined,
    strike: style.strike,
    color: style.color,
    highlight: style.highlight ? 'yellow' : undefined,
    font: style.mono ? MONO_FONT : undefined,
    ...extra
  })
}

function collectRuns(node: AnyNode, style: InlineStyle, runs: Run[]): void {
  if (isText(node)) {
    if (node.data) runs.push(textRun(node.data.replace(/ /g, ' '), style))
    return
  }
  if (!isTag(node)) return
  const tag = node.name.toLowerCase()
  if (tag === 'br') {
    runs.push(new TextRun({ text: '', break: 1 }))
    return
  }
  const next: InlineStyle = { ...style }
  if (tag === 'b' || tag === 'strong') next.bold = true
  if (tag === 'i' || tag === 'em') next.italics = true
  if (tag === 'u') next.underline = true
  if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true
  if (tag === 'code') next.mono = true
  if (tag === 'mark') next.highlight = true
  if (tag === 'a') {
    next.color = '1A73E8'
    next.underline = true
  }
  const classes = (node.attribs.class ?? '').split(/\s+/)
  if (tag === 'span' && /background-color/i.test(node.attribs.style ?? '')) next.highlight = true
  const isChip = tag === 'span' && classes.includes('ui-chip')
  if (isChip) runs.push(textRun('[', style))
  for (const child of node.children) collectRuns(child, next, runs)
  if (isChip) runs.push(textRun(']', style))
}

/** Inline HTML (already sanitized by the block model) → docx runs. */
function inlineRuns(html: string, style: InlineStyle = {}): Run[] {
  const runs: Run[] = []
  for (const node of parseDocument(html).children) collectRuns(node, style, runs)
  return runs
}

const HEADINGS = { 1: HeadingLevel.HEADING_2, 2: HeadingLevel.HEADING_3, 3: HeadingLevel.HEADING_4 } as const
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '9AA0A6' }

async function blockToDocx(block: Block): Promise<DocxBlock[]> {
  switch (block.type) {
    case 'heading':
      // Note titles are Heading 1 in the export, so content headings start one level lower.
      return [new Paragraph({ heading: HEADINGS[block.level], children: inlineRuns(block.html) })]
    case 'paragraph':
      return [
        new Paragraph({
          children: inlineRuns(block.html, block.tone === 'warning' ? { italics: true, color: 'CC3333' } : {}),
          spacing: { after: 120 }
        })
      ]
    case 'quote':
      return [new Paragraph({ children: inlineRuns(block.html, { italics: true }), indent: { left: 480 } })]
    case 'bullet_list':
      return block.items.map((item) => new Paragraph({ children: inlineRuns(item), bullet: { level: 0 } }))
    case 'numbered_list':
      return block.items.map(
        (item, n) =>
          new Paragraph({ children: [new TextRun({ text: `${(block.start ?? 1) + n}. ` }), ...inlineRuns(item)], indent: { left: 360 } })
      )
    case 'checklist':
      return block.items.map(
        (item) =>
          new Paragraph({
            children: [new TextRun({ text: item.done ? '☑ ' : '☐ ' }), ...inlineRuns(item.html, item.done ? { strike: true } : {})],
            indent: { left: 360 }
          })
      )
    case 'table': {
      if (block.rows.length === 0) return []
      const rows = block.rows.map(
        (row, r) =>
          new TableRow({
            tableHeader: block.header && r === 0,
            children: row.map(
              (cell) =>
                new TableCell({
                  children: [new Paragraph({ children: inlineRuns(cell, block.header && r === 0 ? { bold: true } : {}) })],
                  borders: { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER },
                  ...(block.header && r === 0 ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F3F4' } } : {})
                })
            )
          })
      )
      return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }), new Paragraph({ children: [] })]
    }
    case 'code':
      // One paragraph per line keeps indentation and line breaks exactly as written.
      return block.code.split('\n').map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ text: line.replace(/\t/g, '    ') || ' ', font: MONO_FONT, size: 19 })],
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F5F6F7' },
            spacing: { after: 0 }
          })
      )
    case 'image': {
      const run = await imageRunFromSrc(block.src)
      return run ? [new Paragraph({ children: [run] })] : []
    }
    default:
      return []
  }
}

export function noteBlocks(note: Note): Block[] {
  return note.blocks && note.blocks.length > 0 ? note.blocks : htmlToBlocks(note.body)
}

async function noteToDocxElements(note: Note, withMeta: boolean): Promise<DocxBlock[]> {
  const children: DocxBlock[] = []
  const title = note.title.trim() || 'Без названия'
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: title })] }))
  if (withMeta) {
    const created = new Date(note.createdAt).toLocaleString('ru-RU')
    children.push(new Paragraph({ children: [new TextRun({ text: `Создано: ${created}`, italics: true, color: '888888' })] }))
  }
  for (const block of noteBlocks(note)) children.push(...(await blockToDocx(block)))
  return children
}

/** One note as a .docx buffer (per-note export). */
export async function noteToDocxBuffer(note: Note): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: await noteToDocxElements(note, false) }] })
  return Packer.toBuffer(doc)
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
    const children: DocxBlock[] = []
    for (const note of notes) {
      children.push(...(await noteToDocxElements(note, true)))
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
