import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './windows'
import { registerIpcHandlers } from './ipc'
import { initNotesStore, purgeExpiredTrash } from './notesStore'
import { getSettings, updateSettings, runAiMigration } from './settingsStore'
import { HOTKEY_KINDS, registerHotkeys, unregisterAllHotkeys, type HotkeyHandlers } from './hotkeys'
import { createTray, destroyTray, isTrayActive } from './tray'
import {
  captureNextInSession,
  finishCaptureSession,
  getActiveNoteId,
  initCapturePipeline,
  runCapture,
  setActiveNoteId,
  toggleCaptureSession,
  undoCapture
} from './capturePipeline'
import { destroyHud, initHud, prewarmHud } from './hud'
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
import { createProviderSystem, type ProviderSystem } from './providers'
import { registerProviderIpc } from './providersIpc'
import { logEvent } from './logger'
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
    session: () => void toggleCaptureSession(preloadPath)
  }
}

function applyHotkeys(settings: AppSettings): HotkeyRegistrationResult {
  return registerHotkeys(settings.hotkeys, hotkeyHandlers())
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow(preloadPath, iconPath, backgroundColorForTheme(getSettings().theme))
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

  if (next.theme !== prev.theme && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(backgroundColorForTheme(next.theme))
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

    await initNotesStore()
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

    mainWindow = createMainWindow(preloadPath, iconPath, backgroundColorForTheme(getSettings().theme))
    attachWindowLifecycle(mainWindow)
    initCapturePipeline(() => mainWindow, system.recognition)
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
      sessionFinish: () => finishCaptureSession()
    })
    prewarmHud()
    initUpdater(() => mainWindow)

    ipcMain.handle(IPC.APP_CAPTURE_DOCUMENT, () => void runDocumentCapture(preloadPath))

    registerIpcHandlers({
      getMainWindow: () => mainWindow,
      setActiveNoteId,
      onSettingsChanged: handleSettingsChanged,
      resetProviders: async () => {
        await system.chatgpt.disconnect().catch(() => undefined)
        const settings = getSettings()
        for (const provider of ['gemini', 'groq', 'openai', 'anthropic'] as const) {
          for (const key of settings.providerKeys[provider] ?? []) system.secrets.delete(key.id)
        }
        system.activity.clear()
      }
    })
    registerProviderIpc(system, () => mainWindow)

    const settings = getSettings()
    applyHotkeys(settings)
    applyTray(settings)
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

  app.on('before-quit', () => {
    isQuitting = true
    unregisterAllHotkeys()
    cancelLongScreenshotSession()
    providerSystem?.dispose()
    destroyHud()
    void terminateLocalOcr()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'win32') {
      app.quit()
    }
  })
}
