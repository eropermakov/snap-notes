import { dialog, BrowserWindow } from 'electron'
import AdmZip from 'adm-zip'
import { ExportResult, Note } from '../shared/types'
import { htmlToPlainText } from '../shared/htmlText'

/** `folderName` puts notes into sub-folders of the archive, the same way they are organised in the app. */
export async function exportNotesToZip(
  win: BrowserWindow,
  notes: Note[],
  folderName: (folderId: string | null) => string | undefined = () => undefined
): Promise<ExportResult> {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Экспорт заметок',
    defaultPath: `snap-notes-export-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: 'ZIP архив', extensions: ['zip'] }]
  })

  if (canceled || !filePath) {
    return { ok: false, canceled: true }
  }

  try {
    const zip = new AdmZip()
    const usedNames = new Set<string>()

    for (const note of notes) {
      const title = note.title.trim() || 'Без названия'
      const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
      const dir = folderName(note.folderId)?.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
      const prefix = dir ? `${dir}/` : ''
      let filename = `${prefix}${safeTitle}.txt`
      let suffix = 2
      while (usedNames.has(filename)) {
        filename = `${prefix}${safeTitle} (${suffix}).txt`
        suffix += 1
      }
      usedNames.add(filename)

      const created = new Date(note.createdAt).toLocaleString('ru-RU')
      const content = `${title}\n${'='.repeat(title.length)}\nСоздано: ${created}\n\n${htmlToPlainText(note.body)}\n`
      zip.addFile(filename, Buffer.from(content, 'utf-8'))
    }

    zip.writeZip(filePath)
    return { ok: true, path: filePath }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
