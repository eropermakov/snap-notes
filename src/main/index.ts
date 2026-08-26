import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './windows'
import { registerIpcHandlers } from './ipc'
import { initNotesStore, purgeExpiredTrash } from './notesStore'
import { getSettings, updateSettings } from './settingsStore'
import { registerHotkeys, unregisterAllHotkeys } from './hotkeys'
import { createTray, destroyTray, isTrayActive } from './tray'
import { initCapturePipeline, runCapture, setActiveNoteId } from './capturePipeline'
import { initDocumentCapture, runDocumentCapture } from './documentCapture'
import { initImageProtocol } from './imageStore'
import { syncAutoLaunch } from './autoLaunch'
import { initScreenshotCache, purgeExpired } from './screenshotCache'
import { prewarmOverlay } from './screenshot'
import { terminateLocalOcr } from './ai/local'
import { initUpdater } from './updater'
import { IPC } from '../shared/ipc'
import { AppSettings, HotkeyRegistrationResult } from '../shared/types'

const CACHE_PURGE_INTERVAL_MS = 30 * 60 * 1000

function backgroundColorForTheme(theme: AppSettings['theme']): string {
  return theme.endsWith('-dark') ? '#1E1F22' : '#F7F8FA'
}

const preloadPath = join(__dirname, '../preload/index.js')
const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'resources/icon.png')
  : join(__dirname, '../../resources/icon.png')

let mainWindow: BrowserWindow | null = null
let isQuitting = false

function hotkeyHandlers(): { onRegion: () => void; onFullscreen: () => void } {
  return {
    onRegion: () => void runCapture('region', preloadPath),
    onFullscreen: () => void runCapture('fullscreen', preloadPath)
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

  if (next.hotkeys.region !== prev.hotkeys.region || next.hotkeys.fullscreen !== prev.hotkeys.fullscreen) {
    hotkeyResult = applyHotkeys(next)

    const corrected = {
      region: hotkeyResult.region.ok ? next.hotkeys.region : prev.hotkeys.region,
      fullscreen: hotkeyResult.fullscreen.ok ? next.hotkeys.fullscreen : prev.hotkeys.fullscreen
    }

    if (corrected.region !== next.hotkeys.region || corrected.fullscreen !== next.hotkeys.fullscreen) {
      applyHotkeys({ ...next, hotkeys: corrected })
      updateSettings({ hotkeys: corrected })
    }
  }

  if (next.minimizeToTray !== prev.minimizeToTray) {
    applyTray(next)
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

    mainWindow = createMainWindow(preloadPath, iconPath, backgroundColorForTheme(getSettings().theme))
    attachWindowLifecycle(mainWindow)
    initCapturePipeline(() => mainWindow)
    initDocumentCapture(() => mainWindow)
    initImageProtocol()
    prewarmOverlay(preloadPath)
    initUpdater(() => mainWindow)

    ipcMain.handle(IPC.APP_CAPTURE_DOCUMENT, () => void runDocumentCapture(preloadPath))

    registerIpcHandlers({
      getMainWindow: () => mainWindow,
      setActiveNoteId,
      onSettingsChanged: handleSettingsChanged
    })

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
    void terminateLocalOcr()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'win32') {
      app.quit()
    }
  })
}
