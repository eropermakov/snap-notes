import { app, BrowserWindow, clipboard, dialog } from 'electron'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import type { ExportResult, Note } from '../shared/types'
import type { Block } from '../shared/blocks'
import { blocksToAiMarkdown, blocksToMarkdown, blocksToPlainText, blocksToRichHtml } from '../shared/blockExport'
import { noteBlocks, noteToDocxBuffer } from './exportDocx'
import { readNoteImage } from './imageStore'

export type CopyFormat = 'ai' | 'markdown' | 'plain' | 'rich'
export type ExportFormat = 'txt' | 'md' | 'pdf' | 'docx'

const SNAP_MEDIA_SRC = /^snap-media:\/\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\.png$/

/** snap-media:// images → data: URLs (other apps and the PDF renderer cannot read the app scheme). */
async function imageDataUrls(blocks: Block[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const block of blocks) {
    if (block.type !== 'image' || map.has(block.src)) continue
    const match = SNAP_MEDIA_SRC.exec(block.src)
    if (!match) continue
    const data = await readNoteImage(match[1], match[2])
    if (data) map.set(block.src, `data:image/png;base64,${data.toString('base64')}`)
  }
  return map
}

export function safeFileName(title: string): string {
  const base = (title.trim() || 'Без названия').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').slice(0, 80).trim()
  return base.replace(/[. ]+$/, '') || 'note'
}

/**
 * Copies a note: "ai" = clean Markdown for chats (Copy for AI), "markdown", "plain", or "rich"
 * (HTML with inline styles + plain-text alternative, which Word / Google Docs keep on paste).
 */
export async function copyNote(note: Note, format: CopyFormat): Promise<void> {
  const blocks = noteBlocks(note)
  const title = note.title.trim() || undefined
  switch (format) {
    case 'ai':
      clipboard.writeText(blocksToAiMarkdown(blocks, title))
      return
    case 'markdown':
      clipboard.writeText(blocksToMarkdown(blocks, { title, image: (_src, alt) => `![${alt}](изображение)` }))
      return
    case 'plain':
      clipboard.writeText(blocksToPlainText(blocks, title))
      return
    case 'rich': {
      const images = await imageDataUrls(blocks)
      clipboard.write({
        html: blocksToRichHtml(blocks, { title, resolveImage: (src) => images.get(src) ?? null }),
        text: blocksToPlainText(blocks, title)
      })
      return
    }
  }
}

async function renderPdf(html: string): Promise<Buffer> {
  // Offscreen, sandboxed window without preload or Node: it only lays out the generated HTML.
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
  })
  // A temp file, not a data: URL — embedded images easily exceed URL length limits.
  const temp = path.join(app.getPath('temp'), `snap-notes-pdf-${randomUUID()}.html`)
  try {
    await fs.writeFile(temp, html, 'utf-8')
    await win.loadFile(temp)
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
    })
  } finally {
    win.destroy()
    await fs.rm(temp, { force: true }).catch(() => {})
  }
}

const FILTERS: Record<ExportFormat, Electron.FileFilter> = {
  txt: { name: 'Текст', extensions: ['txt'] },
  md: { name: 'Markdown', extensions: ['md'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
  docx: { name: 'Документ Word', extensions: ['docx'] }
}

/** Exports one note to a file chosen by the user. Markdown images go to "<name>_files/". */
export async function exportNote(win: BrowserWindow, note: Note, format: ExportFormat): Promise<ExportResult> {
  const name = safeFileName(note.title)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Экспорт заметки',
    defaultPath: `${name}.${format}`,
    filters: [FILTERS[format]]
  })
  if (canceled || !filePath) return { ok: false, canceled: true }

  try {
    const blocks = noteBlocks(note)
    const title = note.title.trim() || undefined
    if (format === 'txt') {
      await fs.writeFile(filePath, blocksToPlainText(blocks, title), 'utf-8')
    } else if (format === 'md') {
      const assetDirName = `${path.basename(filePath, path.extname(filePath))}_files`
      const assetDir = path.join(path.dirname(filePath), assetDirName)
      const written = new Map<string, string>()
      let counter = 0
      for (const block of blocks) {
        if (block.type !== 'image' || written.has(block.src)) continue
        const match = SNAP_MEDIA_SRC.exec(block.src)
        const data = match ? await readNoteImage(match[1], match[2]) : null
        if (!data) continue
        await fs.mkdir(assetDir, { recursive: true })
        const file = `image-${++counter}.png`
        await fs.writeFile(path.join(assetDir, file), data)
        written.set(block.src, `${assetDirName}/${file}`)
      }
      const md = blocksToMarkdown(blocks, {
        title,
        image: (src, alt) => (written.has(src) ? `![${alt}](${encodeURI(written.get(src)!)})` : null)
      })
      await fs.writeFile(filePath, md, 'utf-8')
    } else if (format === 'pdf') {
      const images = await imageDataUrls(blocks)
      const html = blocksToRichHtml(blocks, { title, document: true, resolveImage: (src) => images.get(src) ?? null })
      await fs.writeFile(filePath, await renderPdf(html))
    } else {
      await fs.writeFile(filePath, await noteToDocxBuffer(note))
    }
    return { ok: true, path: filePath }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
