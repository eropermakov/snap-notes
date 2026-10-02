import { ipcMain, shell, app, BrowserWindow, clipboard, dialog } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
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
import { isOpenableLink } from '../shared/textTools'
import { normalizeColor, normalizeTags } from '../shared/noteMeta'
import { broadcastToNoteWindows } from './noteWindows'
import { asPngBuffer, recognizeNoteImage } from './imageOcr'
import { discardEmptyAutoNote, isNoteProcessing, runImageOcr, runRepeatCapture, undoLastCapture } from './capturePipeline'
import { cleanupSelection } from './noteActions'
import { applyRetry, discardRetry, listRetryProviders, retrySource } from './retryOcr'
import { closeFloatingNote, openFloatingNote, setWindowAlwaysOnTop } from './floatingNotes'
import { closeQuickNote, saveQuickNote } from './quickNote'
import { markClipboardImageHandled, readClipboardPng } from './clipboardOcr'
import type { RecognitionService } from './providers/recognition'
import type { ProviderId } from '../shared/providers'
import { AppSettings, HotkeyRegistrationResult, Note, StorageStats } from '../shared/types'

export interface IpcContext {
  getMainWindow: () => BrowserWindow | null
  setActiveNoteId: (id: string | null) => void
  onSettingsChanged: (next: AppSettings, prev: AppSettings) => Promise<HotkeyRegistrationResult | null>
  /** Removes every stored credential (API keys, ChatGPT sign-in) and local AI activity. */
  resetProviders: () => Promise<void>
  recognition: RecognitionService
  preloadPath: string
}

/** Only these note fields can be changed by the renderer; everything else is main-process owned. */
function pickEditable(patch: unknown): Partial<Note> | null {
  if (!patch || typeof patch !== 'object') return null
  const p = patch as Record<string, unknown>
  const out: Partial<Note> = {}
  if (typeof p.title === 'string') out.title = p.title
  if (typeof p.body === 'string' && p.body.length < 8_000_000) out.body = p.body
  if (p.emoji === null || typeof p.emoji === 'string') out.emoji = p.emoji as string | null
  if (typeof p.pinned === 'boolean') out.pinned = p.pinned
  if (typeof p.favorite === 'boolean') out.favorite = p.favorite
  if (p.color !== undefined) out.color = normalizeColor(p.color)
  if (p.tags !== undefined) out.tags = normalizeTags(p.tags)
  return out
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 5000) : []
}

export function registerIpcHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.NOTES_LIST, () => notesStore.listNotes())

  ipcMain.handle(IPC.NOTES_CREATE, async () => notesStore.createNote())

  ipcMain.handle(IPC.NOTES_UPDATE, async (e, id: string, patch: unknown) => {
    const picked = typeof id === 'string' ? pickEditable(patch) : null
    if (!picked) return null
    const updated = await notesStore.updateNote(id, picked, { user: true })
    // Other windows showing this note (main + floating) follow the change; the sender already has it.
    if (updated) broadcastToNoteWindows(IPC.ON_NOTE_UPDATED, updated, e.sender)
    return updated
  })

  ipcMain.handle(IPC.NOTES_DELETE, async (e, id: string) => {
    const deleted = typeof id === 'string' ? await notesStore.softDeleteNote(id) : null
    if (deleted) {
      broadcastToNoteWindows(IPC.ON_NOTE_DELETED, id, e.sender)
      closeFloatingNote(id)
    }
    return deleted
  })

  ipcMain.handle(IPC.NOTES_TOGGLE_PIN, async (e, id: string) => {
    const updated = typeof id === 'string' ? await notesStore.togglePin(id) : null
    if (updated) broadcastToNoteWindows(IPC.ON_NOTE_UPDATED, updated, e.sender)
    return updated
  })

  let activeId: string | null = null
  ipcMain.on(IPC.NOTES_SET_ACTIVE, (_e, id: string | null) => {
    const next = typeof id === 'string' ? id : null
    const previous = activeId
    activeId = next
    ctx.setActiveNoteId(next)
    // Leaving a note that a capture made and nobody used: it is removed instead of piling up empty.
    if (previous && previous !== next && !isNoteProcessing(previous)) void discardEmptyAutoNote(previous)
  })

  ipcMain.handle(IPC.NOTES_BULK_UPDATE, async (e, ids: unknown, op: unknown) => {
    const list = idList(ids)
    const o = op as Record<string, unknown> | null
    if (!o || typeof o.type !== 'string') return []
    let bulk: notesStore.BulkOp | null = null
    if (o.type === 'pin' || o.type === 'favorite') bulk = { type: o.type, value: o.value === true }
    else if (o.type === 'color') bulk = { type: 'color', value: normalizeColor(o.value) }
    else if (o.type === 'addTags' || o.type === 'removeTags') bulk = { type: o.type, tags: normalizeTags(o.tags) }
    if (!bulk) return []
    const updated = await notesStore.bulkUpdate(list, bulk)
    for (const note of updated) broadcastToNoteWindows(IPC.ON_NOTE_UPDATED, note, e.sender)
    return updated
  })

  // Bulk delete only moves notes to the trash; the renderer offers "Undo" through bulkRestore.
  ipcMain.handle(IPC.NOTES_BULK_DELETE, async (e, ids: unknown) => {
    const moved = await notesStore.bulkSoftDelete(idList(ids))
    for (const id of moved) {
      broadcastToNoteWindows(IPC.ON_NOTE_DELETED, id, e.sender)
      closeFloatingNote(id)
    }
    return moved
  })

  ipcMain.handle(IPC.NOTES_BULK_RESTORE, async (e, ids: unknown) => {
    const restored: Note[] = []
    for (const id of idList(ids)) {
      const note = await notesStore.restoreNote(id)
      if (note) {
        restored.push(note)
        broadcastToNoteWindows(IPC.ON_NOTE_UPDATED, note, e.sender)
      }
    }
    return restored
  })

  ipcMain.handle(IPC.NOTES_DUPLICATE, async (e, id: string) => {
    const copy = typeof id === 'string' ? await notesStore.duplicateNote(id) : null
    if (copy) broadcastToNoteWindows(IPC.ON_NOTE_CREATED, copy, e.sender)
    return copy
  })

  ipcMain.handle(IPC.NOTES_EXPORT_MANY, async (_e, ids: unknown) => {
    const win = ctx.getMainWindow()
    if (!win) return { ok: false, message: 'Окно приложения недоступно' }
    const notes = idList(ids).map((id) => notesStore.getNote(id)).filter((n): n is Note => Boolean(n))
    if (notes.length === 0) return { ok: false, message: 'Нет заметок для экспорта' }
    return exportNotesToZip(win, notes)
  })

  ipcMain.handle(IPC.NOTES_OPEN_FLOATING, (_e, id: string) => ({ ok: typeof id === 'string' && openFloatingNote(id) }))

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

  ipcMain.handle(IPC.NOTES_RESTORE, async (e, id: string) => {
    const note = typeof id === 'string' ? await notesStore.restoreNote(id) : null
    if (note) broadcastToNoteWindows(IPC.ON_NOTE_UPDATED, note, e.sender)
    return note
  })

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

  // Links in notes open in the system's default handler (browser, mail, dialer) — never inside the app.
  ipcMain.handle(IPC.APP_OPEN_LINK, async (_e, url: unknown) => {
    if (!isOpenableLink(url)) return { ok: false }
    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle(IPC.CLIPBOARD_READ_TEXT, () => clipboard.readText())

  // ----- pictures: drop into a note, OCR from a file / the clipboard -----
  ipcMain.handle(IPC.NOTES_ADD_IMAGE, async (_e, noteId: string, bytes: unknown) => {
    const png = asPngBuffer(bytes)
    if (!png || typeof noteId !== 'string') return null
    return notesStore.addNoteImage(noteId, png)
  })

  ipcMain.handle(IPC.NOTES_RECOGNIZE_IMAGE, (_e, noteId: string, src: string, mode: string) =>
    typeof noteId === 'string' && typeof src === 'string'
      ? recognizeNoteImage(ctx.recognition, noteId, src, mode === 'replace' ? 'replace' : 'below')
      : { ok: false }
  )

  ipcMain.handle(IPC.NOTES_OCR_IMAGE_DATA, async (_e, noteId: string | null, bytes: unknown) => {
    const png = asPngBuffer(bytes)
    if (!png) return { ok: false, message: 'Не удалось прочитать изображение' }
    await runImageOcr(png, ctx.preloadPath, typeof noteId === 'string' ? noteId : null)
    return { ok: true }
  })

  ipcMain.handle(IPC.NOTES_PICK_IMAGE, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? ctx.getMainWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Выберите изображение',
      properties: ['openFile'],
      filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
    })
    if (canceled || !filePaths[0]) return null
    const stat = await fs.stat(filePaths[0])
    if (stat.size > 40 * 1024 * 1024) return { error: 'Файл больше 40 МБ' }
    return { name: path.basename(filePaths[0]), bytes: await fs.readFile(filePaths[0]) }
  })

  ipcMain.handle(IPC.CAPTURE_CLIPBOARD, async () => {
    const png = readClipboardPng()
    if (!png) return { ok: false, message: 'В буфере обмена нет изображения' }
    markClipboardImageHandled()
    await runImageOcr(png, ctx.preloadPath)
    return { ok: true }
  })

  ipcMain.handle(IPC.CAPTURE_REPEAT, async () => {
    await runRepeatCapture(ctx.preloadPath)
  })

  ipcMain.handle(IPC.CAPTURE_UNDO_LAST, async () => ({ ok: await undoLastCapture() }))

  // ----- text and fragment tools -----
  ipcMain.handle(IPC.NOTES_CLEANUP_TEXT, async (_e, text: unknown) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 100_000) return { ok: false, text: '', local: true }
    return cleanupSelection(ctx.recognition.manager, text, settingsStore.getSettings().ai.mode === 'offline')
  })

  ipcMain.handle(IPC.NOTES_RETRY_PROVIDERS, (_e, noteId: string, sourceId: string) =>
    typeof noteId === 'string' && typeof sourceId === 'string' ? listRetryProviders(ctx.recognition, noteId, sourceId) : []
  )

  ipcMain.handle(IPC.NOTES_RETRY_SOURCE, (_e, noteId: string, sourceId: string, target: string) =>
    typeof noteId === 'string' && typeof sourceId === 'string' && typeof target === 'string'
      ? retrySource(ctx.recognition, noteId, sourceId, target === 'next' ? 'next' : (target as ProviderId))
      : { ok: false }
  )

  ipcMain.handle(IPC.NOTES_APPLY_RETRY, async (_e, token: string, apply: boolean) => {
    if (typeof token !== 'string') return null
    if (!apply) {
      discardRetry(token)
      return null
    }
    const updated = await applyRetry(token)
    if (updated) broadcastToNoteWindows(IPC.ON_NOTE_UPDATED, updated)
    return updated
  })

  // ----- windows -----
  ipcMain.handle(IPC.WINDOW_SET_ALWAYS_ON_TOP, (e, on: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win ? setWindowAlwaysOnTop(win, on === true) : false
  })

  ipcMain.handle(IPC.WINDOW_GET_STATE, (e) => ({ alwaysOnTop: BrowserWindow.fromWebContents(e.sender)?.isAlwaysOnTop() ?? false }))

  ipcMain.on(IPC.WINDOW_CLOSE_SELF, (e) => BrowserWindow.fromWebContents(e.sender)?.close())

  ipcMain.handle(IPC.QUICK_SAVE, (_e, title: unknown, text: unknown) => saveQuickNote(title, text))
  ipcMain.on(IPC.QUICK_CLOSE, () => closeQuickNote())



  ipcMain.handle(IPC.APP_CHECK_FOR_UPDATES, () => checkForUpdatesNow())

  ipcMain.handle(IPC.APP_INSTALL_UPDATE, () => {
    installUpdateNow()
  })
}
