import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { ResolvedWindowState } from '../shared/windowBounds'

export function loadRoute(win: BrowserWindow, hash?: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = process.env['ELECTRON_RENDERER_URL'] + (hash ? `#${hash}` : '')
    void win.loadURL(url)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

export const MAIN_WINDOW_DEFAULTS = { width: 1180, height: 760, minWidth: 760, minHeight: 520 }

export function createMainWindow(
  preloadPath: string,
  iconPath: string,
  backgroundColor: string,
  state: ResolvedWindowState = { bounds: { width: MAIN_WINDOW_DEFAULTS.width, height: MAIN_WINDOW_DEFAULTS.height }, maximized: false }
): BrowserWindow {
  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: MAIN_WINDOW_DEFAULTS.minWidth,
    minHeight: MAIN_WINDOW_DEFAULTS.minHeight,
    show: false,
    backgroundColor,
    autoHideMenuBar: true,
    icon: iconPath,
    title: 'Snap Notes',
    webPreferences: {
      preload: preloadPath,
      sandbox: false
    }
  })

  if (state.maximized) win.maximize()
  win.once('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRoute(win)
  return win
}

export function createOverlayWindow(display: Electron.Display, preloadPath: string): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  loadRoute(win, 'overlay')

  return win
}

export const FLOATING_DEFAULTS = { width: 420, height: 520, minWidth: 300, minHeight: 240 }

/** A small separate window with one note (always-on-top optional). */
export function createNoteWindow(
  noteId: string,
  preloadPath: string,
  iconPath: string,
  backgroundColor: string,
  state: ResolvedWindowState,
  alwaysOnTop: boolean
): BrowserWindow {
  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: FLOATING_DEFAULTS.minWidth,
    minHeight: FLOATING_DEFAULTS.minHeight,
    show: false,
    backgroundColor,
    autoHideMenuBar: true,
    alwaysOnTop,
    icon: iconPath,
    title: 'Snap Notes',
    webPreferences: { preload: preloadPath, sandbox: false }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  loadRoute(win, `note/${noteId}`)
  return win
}

export const QUICK_NOTE_DEFAULTS = { width: 440, height: 280, minWidth: 320, minHeight: 200 }

/** The Quick Note window: compact, frameless-looking, above other apps. Created once and re-shown. */
export function createQuickNoteWindow(preloadPath: string, backgroundColor: string, state: ResolvedWindowState): BrowserWindow {
  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: QUICK_NOTE_DEFAULTS.minWidth,
    minHeight: QUICK_NOTE_DEFAULTS.minHeight,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor,
    title: 'Быстрая заметка',
    webPreferences: { preload: preloadPath, sandbox: false }
  })
  win.setAlwaysOnTop(true, 'floating')
  loadRoute(win, 'quick')
  return win
}
