import { ipcMain, shell, app, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import { testProviderKey } from './ai/router'
import { getAllUsageToday } from './ai/usage'
import { exportNotesToZip } from './exportData'
import * as screenshotCache from './screenshotCache'
import { checkForUpdatesNow, installUpdateNow } from './updater'
import { htmlToPlainText } from '../shared/htmlText'
import { AiProvider, AppSettings, HotkeyRegistrationResult, Note, StorageStats } from '../shared/types'

export interface IpcContext {
  getMainWindow: () => BrowserWindow | null
  setActiveNoteId: (id: string | null) => void
  onSettingsChanged: (next: AppSettings, prev: AppSettings) => Promise<HotkeyRegistrationResult | null>
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

  ipcMain.handle(IPC.NOTES_LIST_TRASH, () => notesStore.listTrash())

  ipcMain.handle(IPC.NOTES_RESTORE, async (_e, id: string) => notesStore.restoreNote(id))

  ipcMain.handle(IPC.NOTES_PERMANENT_DELETE, async (_e, id: string) => notesStore.permanentlyDeleteNote(id))

  ipcMain.handle(IPC.NOTES_EMPTY_TRASH, async () => {
    await notesStore.emptyTrash()
    return { ok: true }
  })

  ipcMain.handle(IPC.SETTINGS_GET, () => settingsStore.getSettings())

  ipcMain.handle(IPC.SETTINGS_UPDATE, async (_e, patch: Partial<AppSettings>) => {
    const prev = settingsStore.getSettings()
    settingsStore.updateSettings(patch)
    const afterFirstSave = settingsStore.getSettings()
    const hotkeyResult = await ctx.onSettingsChanged(afterFirstSave, prev)
    const finalSettings = settingsStore.getSettings()
    return { settings: finalSettings, hotkeyResult }
  })

  ipcMain.handle(IPC.SETTINGS_TEST_API_KEY, async (_e, provider: AiProvider, apiKey: string) =>
    testProviderKey(provider, apiKey)
  )

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

  ipcMain.handle(IPC.SETTINGS_RESET_ALL, async () => {
    const prev = settingsStore.getSettings()
    await notesStore.resetAllNotes()
    await screenshotCache.clearCache()
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

  ipcMain.handle(IPC.SETTINGS_GET_USAGE, () => getAllUsageToday())

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
