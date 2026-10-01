import { ipcMain, shell, app, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import { exportNotesToZip } from './exportData'
import { exportNotesToDocx } from './exportDocx'
import { copyNote, exportNote, type CopyFormat, type ExportFormat } from './noteExport'
import { htmlToBlocks } from '../shared/blocks'
import { sanitizeNoteHtml } from './htmlSanitize'
import * as screenshotCache from './screenshotCache'
import { checkForUpdatesNow, installUpdateNow } from './updater'
import { htmlToPlainText } from '../shared/htmlText'
import { AppSettings, HotkeyRegistrationResult, Note, StorageStats } from '../shared/types'

export interface IpcContext {
  getMainWindow: () => BrowserWindow | null
  setActiveNoteId: (id: string | null) => void
  onSettingsChanged: (next: AppSettings, prev: AppSettings) => Promise<HotkeyRegistrationResult | null>
  /** Removes every stored credential (API keys, ChatGPT sign-in) and local AI activity. */
  resetProviders: () => Promise<void>
}

export function registerIpcHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.NOTES_LIST, () => notesStore.listNotes())

  ipcMain.handle(IPC.NOTES_CREATE, async () => notesStore.createNote())

  ipcMain.handle(IPC.NOTES_UPDATE, async (_e, id: string, patch: Partial<Note>) =>
    notesStore.updateNote(id, patch)
  )

  ipcMain.handle(IPC.NOTES_DELETE, async (_e, id: string) => notesStore.softDeleteNote(id))

  ipcMain.handle(IPC.NOTES_TOGGLE_PIN, async (_e, id: string) => notesStore.togglePin(id))

  ipcMain.on(IPC.NOTES_SET_ACTIVE, (_e, id: string | null) => {
    ctx.setActiveNoteId(id)
  })

  ipcMain.handle(IPC.NOTES_COPY, async (_e, id: string, format: CopyFormat) => {
    const note = typeof id === 'string' ? notesStore.getNote(id) : undefined
    if (!note || !['ai', 'markdown', 'plain', 'rich'].includes(format)) return { ok: false }
    await copyNote(note, format)
    return { ok: true }
  })

  ipcMain.handle(IPC.NOTES_EXPORT, async (_e, id: string, format: ExportFormat) => {
    const win = ctx.getMainWindow()
    const note = typeof id === 'string' ? notesStore.getNote(id) : undefined
    if (!win || !note || !['txt', 'md', 'pdf', 'docx'].includes(format)) return { ok: false, message: 'Заметка не найдена' }
    return exportNote(win, note, format)
  })

  // "Проверить распознавание" (§19): the user's corrected HTML replaces the fragment in place.
  ipcMain.handle(IPC.NOTES_REPLACE_SOURCE_HTML, async (_e, id: string, sourceId: string, html: string) => {
    if (typeof id !== 'string' || typeof sourceId !== 'string' || typeof html !== 'string' || html.length > 2_000_000) return null
    const blocks = htmlToBlocks(sanitizeNoteHtml(html))
    const updated = await notesStore.replaceSourceBlocks(id, sourceId, blocks)
    const win = ctx.getMainWindow()
    if (updated && win && !win.isDestroyed()) win.webContents.send(IPC.ON_NOTE_UPDATED, updated)
    return updated
  })

  ipcMain.handle(IPC.NOTES_REMOVE_SOURCE, async (_e, id: string, sourceId: string) => {
    if (typeof id !== 'string' || typeof sourceId !== 'string') return null
    const updated = await notesStore.removeSource(id, sourceId)
    const win = ctx.getMainWindow()
    if (updated && win && !win.isDestroyed()) win.webContents.send(IPC.ON_NOTE_UPDATED, updated)
    return updated
  })

  ipcMain.handle(IPC.NOTES_LIST_TRASH, () => notesStore.listTrash())

  ipcMain.handle(IPC.NOTES_RESTORE, async (_e, id: string) => notesStore.restoreNote(id))

  ipcMain.handle(IPC.NOTES_PERMANENT_DELETE, async (_e, id: string) => notesStore.permanentlyDeleteNote(id))

  ipcMain.handle(IPC.NOTES_EMPTY_TRASH, async () => {
    await notesStore.emptyTrash()
    return { ok: true }
  })

  ipcMain.handle(IPC.SETTINGS_GET, () => settingsStore.getPublicSettings())

  ipcMain.handle(IPC.SETTINGS_UPDATE, async (_e, patch: settingsStore.SettingsPatch) => {
    const prev = settingsStore.getSettings()
    settingsStore.updateSettings(settingsStore.sanitizeRendererPatch(patch ?? {}))
    const afterFirstSave = settingsStore.getSettings()
    const hotkeyResult = await ctx.onSettingsChanged(afterFirstSave, prev)
    return { settings: settingsStore.getPublicSettings(), hotkeyResult }
  })

  ipcMain.handle(IPC.SETTINGS_GET_DATA_PATH, () => notesStore.getNotesDirPath())

  ipcMain.handle(IPC.SETTINGS_OPEN_DATA_FOLDER, async () => {
    const err = await shell.openPath(app.getPath('userData'))
    return { ok: !err, message: err || undefined }
  })

  ipcMain.handle(IPC.SETTINGS_EXPORT_NOTES, async () => {
    const win = ctx.getMainWindow()
    if (!win) return { ok: false, message: 'Окно приложения недоступно' }
    return exportNotesToZip(win, notesStore.listNotes())
  })

  ipcMain.handle(IPC.SETTINGS_EXPORT_NOTES_DOCX, async () => {
    const win = ctx.getMainWindow()
    if (!win) return { ok: false, message: 'Окно приложения недоступно' }
    return exportNotesToDocx(win, notesStore.listNotes())
  })

  ipcMain.handle(IPC.SETTINGS_RESET_ALL, async () => {
    const prev = settingsStore.getSettings()
    await notesStore.resetAllNotes()
    await screenshotCache.clearCache()
    await ctx.resetProviders()
    const next = settingsStore.resetSettings()
    const hotkeyResult = await ctx.onSettingsChanged(next, prev)
    return { ok: true, hotkeyResult }
  })

  ipcMain.handle(IPC.SETTINGS_GET_STORAGE_STATS, async (): Promise<StorageStats> => {
    const notes = notesStore.listNotes()
    let notesBytes = 0
    let totalCharacters = 0
    for (const note of notes) {
      const plain = htmlToPlainText(note.body)
      totalCharacters += plain.length
      notesBytes += Buffer.byteLength(JSON.stringify(note), 'utf-8')
    }
    const cacheStats = await screenshotCache.getCacheStats()
    return {
      notesBytes,
      notesCount: notes.length,
      totalCharacters,
      screenshotCacheBytes: cacheStats.bytes,
      screenshotCacheCount: cacheStats.count
    }
  })

  ipcMain.handle(IPC.SETTINGS_CLEAR_SCREENSHOT_CACHE, async () => {
    await screenshotCache.clearCache()
    return { ok: true }
  })

  ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion())

  ipcMain.handle(IPC.APP_OPEN_EXTERNAL, async (_e, url: string) => {
    if (/^https:\/\//i.test(url)) {
      await shell.openExternal(url)
    }
  })

  ipcMain.handle(IPC.APP_CHECK_FOR_UPDATES, () => checkForUpdatesNow())

  ipcMain.handle(IPC.APP_INSTALL_UPDATE, () => {
    installUpdateNow()
  })
}
