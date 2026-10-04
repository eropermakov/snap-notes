import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, MAIN_WINDOW_DEFAULTS } from './windows'
import { resolveSavedState, trackWindowState } from './windowState'
import { broadcastToNoteWindows, noteWindows, registerNoteWindow, setMainWindowGetter } from './noteWindows'
import { destroyQuickNote, initQuickNote, prewarmQuickNote, setQuickNoteBackground, toggleQuickNote } from './quickNote'
import { initFloatingNotes, setFloatingBackground } from './floatingNotes'
import { markClipboardImageHandled, readClipboardPng, startClipboardWatch, stopClipboardWatch } from './clipboardOcr'
import { registerIpcHandlers } from './ipc'
import { initNotesStore, purgeExpiredTrash } from './notesStore'
import { initFoldersStore } from './foldersStore'
import { getSettings, updateSettings, runAiMigration } from './settingsStore'
import { HOTKEY_KINDS, registerHotkeys, unregisterAllHotkeys, type HotkeyHandlers } from './hotkeys'
import { createTray, destroyTray, isTrayActive } from './tray'
import {
  captureNextInSession,
  finishCaptureSession,
  getActiveNoteId,
  initCapturePipeline,
  recoverOcrQueue,
  getOcrQueue,
  runCapture,
  runImageOcr,
  runRepeatCapture,
  setActiveNoteId,
  toggleCaptureSession,
  undoCapture
} from './capturePipeline'
import { destroyHud, initHud, prewarmHud } from './hud'
import * as hud from './hud'
import { copyNote } from './noteExport'
import * as notesStore from './notesStore'
import { initDocumentCapture, runDocumentCapture } from './documentCapture'
import { initLongScreenshot, toggleLongScreenshot, cancelLongScreenshotSession } from './longScreenshot'
import { initImageProtocol } from './imageStore'
import { syncAutoLaunch } from './autoLaunch'
import { initScreenshotCache, purgeExpired } from './screenshotCache'
import { prewarmOverlay } from './screenshot'
import { terminateLocalOcr } from './ai/local'
import { initUpdater } from './updater'
import { API_KEY_PROVIDERS } from '../shared/providers'
import { createProviderSystem, type ProviderSystem } from './providers'
import { registerProviderIpc } from './providersIpc'
import { logEvent } from './logger'
import { createFileJobStore } from './ocr/jobStore'
import { IPC } from '../shared/ipc'
import { AppSettings, HotkeyRegistrationResult } from '../shared/types'

const CACHE_PURGE_INTERVAL_MS = 30 * 60 * 1000

function backgroundColorForTheme(theme: AppSettings['theme']): string {
  // Matches --bg-secondary (the app shell) so the first paint does not flash.
  return theme.endsWith('-dark') ? '#151716' : '#F7F7F6'
}

const preloadPath = join(__dirname, '../preload/index.js')
const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'resources/icon.png')
  : join(__dirname, '../../resources/icon.png')

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let providerSystem: ProviderSystem | null = null

/** Copy for AI (§15) from anywhere: the open note, else the most recently edited one. */
async function copyCurrentNoteForAi(): Promise<void> {
  const activeId = getActiveNoteId()
  const note = (activeId ? notesStore.getNote(activeId) : undefined) ?? notesStore.listNotes()[0]
  const notify = (body: string): void => {
    if (Notification.isSupported()) new Notification({ title: 'Snap Notes', body, silent: true }).show()
  }
  if (!note || note.deletedAt !== null) {
    notify('Нет заметки для копирования')
    return
  }
  await copyNote(note, 'ai')
  notify(`Скопировано для AI: «${note.title.trim() || 'Без названия'}»`)
}

function hotkeyHandlers(): HotkeyHandlers {
  return {
    region: () => void runCapture('region', preloadPath),
    fullscreen: () => void runCapture('fullscreen', preloadPath),
    document: () => void runDocumentCapture(preloadPath),
    longScreenshot: () => void toggleLongScreenshot(preloadPath),
    copyForAi: () => void copyCurrentNoteForAi(),
    openApp: () => showMainWindow(),
    session: () => void toggleCaptureSession(preloadPath),
    quickNote: () => toggleQuickNote(),
    repeatCapture: () => void runRepeatCapture(preloadPath),
    ocrClipboard: () => void ocrClipboardImage(),
    globalSearch: () => {
      showMainWindow()
      mainWindow?.webContents.send(IPC.ON_NAVIGATE, { view: 'search' })
    }
  }
}

/** "OCR clipboard image": recognizes the picture in the clipboard into the open note / a new one. */
async function ocrClipboardImage(): Promise<void> {
  const png = readClipboardPng()
  if (!png) {
    hud.show({ kind: 'message', tone: 'warning', text: 'В буфере обмена нет изображения.' })
    return
  }
  markClipboardImageHandled()
  await runImageOcr(png, preloadPath)
}

/** Starts / stops the clipboard watcher according to "Suggest OCR for clipboard images". */
function applyClipboardWatch(settings: AppSettings): void {
  if (!settings.suggestClipboardOcr) {
    stopClipboardWatch()
    return
  }
  startClipboardWatch(() => {
    // A quiet, auto-hiding suggestion in the HUD: it never takes focus and is offered once per image.
    hud.show({ kind: 'suggest', text: 'В буфере обмена картинка' })
  })
}

function makeMainWindow(): BrowserWindow {
  const settings = getSettings()
  const win = createMainWindow(
    preloadPath,
    iconPath,
    backgroundColorForTheme(settings.theme),
    resolveSavedState(settings.windowState, MAIN_WINDOW_DEFAULTS)
  )
  registerNoteWindow(win)
  trackWindowState(win, (saved) => updateSettings({ windowState: saved }))
  return win
}

function applyHotkeys(settings: AppSettings): HotkeyRegistrationResult {
  return registerHotkeys(settings.hotkeys, hotkeyHandlers())
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = makeMainWindow()
    attachWindowLifecycle(mainWindow)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

function applyTray(settings: AppSettings): void {
  if (settings.minimizeToTray) {
    if (!isTrayActive()) {
      createTray({
        iconPath,
        onOpen: showMainWindow,
        onNewNoteCapture: () => void runCapture('region', preloadPath),
        onNewDocumentCapture: () => void runDocumentCapture(preloadPath),
        onQuickNote: () => toggleQuickNote(),
        onRepeatCapture: () => void runRepeatCapture(preloadPath),
        onOcrClipboard: () => void ocrClipboardImage(),
        onToggleLongScreenshot: () => void toggleLongScreenshot(preloadPath),
        onQuit: () => {
          isQuitting = true
          app.quit()
        }
      })
    }
  } else {
    destroyTray()
  }
}

async function handleSettingsChanged(
  next: AppSettings,
  prev: AppSettings
): Promise<HotkeyRegistrationResult | null> {
  let hotkeyResult: HotkeyRegistrationResult | null = null

  if (HOTKEY_KINDS.some((kind) => next.hotkeys[kind] !== prev.hotkeys[kind])) {
    hotkeyResult = applyHotkeys(next)

    // A hotkey that could not be registered keeps its previous, working combination.
    const corrected = { ...next.hotkeys }
    for (const kind of HOTKEY_KINDS) {
      if (!hotkeyResult[kind].ok) corrected[kind] = prev.hotkeys[kind]
    }

    if (HOTKEY_KINDS.some((kind) => corrected[kind] !== next.hotkeys[kind])) {
      applyHotkeys({ ...next, hotkeys: corrected })
      updateSettings({ hotkeys: corrected })
    }
  }

  if (next.minimizeToTray !== prev.minimizeToTray) {
    applyTray(next)
  }

  if (JSON.stringify(next.ai) !== JSON.stringify(prev.ai)) {
    providerSystem?.manager.emit()
  }

  if (next.theme !== prev.theme) {
    const color = backgroundColorForTheme(next.theme)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(color)
    setQuickNoteBackground(color)
    setFloatingBackground(color)
  }

  if (next.ocrQueueEnabled !== prev.ocrQueueEnabled) {
    getOcrQueue()?.setPaused(!next.ocrQueueEnabled)
  }

  if (next.suggestClipboardOcr !== prev.suggestClipboardOcr) {
    applyClipboardWatch(next)
  }

  if (next.launchAtStartup !== prev.launchAtStartup || next.minimizeToTray !== prev.minimizeToTray) {
    try {
      await syncAutoLaunch(next.launchAtStartup, next.minimizeToTray)
    } catch (err) {
      console.error('[auto-launch] sync failed', err)
    }
  }

  return hotkeyResult
}

function attachWindowLifecycle(win: BrowserWindow): void {
  win.on('close', (event) => {
    const settings = getSettings()
    if (!isQuitting && settings.minimizeToTray) {
      event.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
}

/** Asks every note window to save pending edits; resolves when all answered (or after 1.5 s). */
function requestRendererFlush(): Promise<void> {
  const wins = noteWindows()
  if (wins.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    let waiting = wins.length
    const timer = setTimeout(done, 1500)
    function done(): void {
      clearTimeout(timer)
      ipcMain.removeListener(IPC.APP_FLUSHED, onAck)
      resolve()
    }
    function onAck(): void {
      waiting -= 1
      if (waiting <= 0) done()
    }
    ipcMain.on(IPC.APP_FLUSHED, onAck)
    broadcastToNoteWindows(IPC.APP_FLUSH)
  })
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.snapnotes.app')

    app.on('browser-window-created', (_e, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Protect targets before cleaning empty auto-notes; OCR recovery runs after stores and UI exist.
    const savedJobs = await createFileJobStore(join(app.getPath('userData'), 'ocr-queue')).loadAll()
    const pendingCaptureNotes = new Set(savedJobs
      .filter((job) => job.status !== 'COMPLETED' && job.status !== 'CANCELLED')
      .map((job) => job.targetNoteId))
    await initNotesStore(pendingCaptureNotes)
    await initFoldersStore()
    await initScreenshotCache()

    const system = createProviderSystem()
    providerSystem = system
    // Legacy plaintext keys → OS-encrypted storage, verified before the plaintext copy is removed.
    try {
      const migration = runAiMigration(system.secrets)
      if (migration.migratedKeyIds.length || migration.failedKeyIds.length) {
        logEvent('migration', { migrated: migration.migratedKeyIds.length, failed: migration.failedKeyIds.length })
      }
    } catch (err) {
      logEvent('migration', { error: err instanceof Error ? err.name : 'unknown' })
    }
    void system.manager.refreshAll().then(() => system.manager.warmModels())

    setMainWindowGetter(() => mainWindow)
    mainWindow = makeMainWindow()
    attachWindowLifecycle(mainWindow)
    initQuickNote(preloadPath, backgroundColorForTheme(getSettings().theme))
    initFloatingNotes(preloadPath, iconPath, backgroundColorForTheme(getSettings().theme))
    const ocrQueue = initCapturePipeline(() => mainWindow, system.recognition)
    initDocumentCapture(() => mainWindow, system.recognition)
    initLongScreenshot(() => mainWindow, system.recognition)
    initImageProtocol()
    prewarmOverlay(preloadPath)
    initHud(preloadPath, {
      undo: (noteId, sourceId) => void undoCapture(noteId, sourceId),
      open: (noteId) => {
        showMainWindow()
        setActiveNoteId(noteId)
        mainWindow?.webContents.send(IPC.ON_NAVIGATE, { view: 'editor', noteId })
      },
      sessionNext: () => captureNextInSession(),
      sessionFinish: () => finishCaptureSession(),
      ocrClipboard: () => void ocrClipboardImage(),
      cancelJob: (jobId) => void ocrQueue.cancel(jobId),
      retryFailed: () => void ocrQueue.retryFailed()
    })
    prewarmHud()
    prewarmQuickNote()
    initUpdater(() => mainWindow)

    ipcMain.handle(IPC.APP_CAPTURE_DOCUMENT, () => void runDocumentCapture(preloadPath))

    registerIpcHandlers({
      ocrQueue,
      recognition: system.recognition,
      preloadPath,
      getMainWindow: () => mainWindow,
      setActiveNoteId,
      onSettingsChanged: handleSettingsChanged,
      resetProviders: async () => {
        await system.chatgpt.disconnect().catch(() => undefined)
        const settings = getSettings()
        for (const provider of API_KEY_PROVIDERS) {
          for (const key of settings.providerKeys[provider] ?? []) system.secrets.delete(key.id)
          system.clearFields(provider)
        }
        system.activity.clear()
      }
    })
    registerProviderIpc(system, () => mainWindow)

    const settings = getSettings()
    applyHotkeys(settings)
    applyTray(settings)
    applyClipboardWatch(settings)
    // Captures that were waiting when the app was last closed continue in the background.
    void recoverOcrQueue().then((count) => {
      if (count > 0) logEvent('ocr-queue', { recovered: count })
    })
    syncAutoLaunch(settings.launchAtStartup, settings.minimizeToTray).catch((err) => {
      console.error('[auto-launch] initial sync failed', err)
    })

    void purgeExpired(settings.screenshotCacheRetentionHours)
    void purgeExpiredTrash(settings.trashRetentionDays)
    setInterval(() => {
      const current = getSettings()
      void purgeExpired(current.screenshotCacheRetentionHours)
      void purgeExpiredTrash(current.trashRetentionDays)
    }, CACHE_PURGE_INTERVAL_MS)

    app.on('activate', () => {
      showMainWindow()
    })
  })

  let flushedBeforeQuit = false
  app.on('before-quit', (event) => {
    isQuitting = true
    // Pending edits are written first: windows are asked to flush, then the quit continues.
    if (!flushedBeforeQuit && noteWindows().length > 0) {
      flushedBeforeQuit = true
      event.preventDefault()
      void requestRendererFlush().finally(() => app.quit())
      return
    }
    unregisterAllHotkeys()
    stopClipboardWatch()
    cancelLongScreenshotSession()
    providerSystem?.dispose()
    destroyHud()
    destroyQuickNote()
    void terminateLocalOcr()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'win32') {
      app.quit()
    }
  })
}
