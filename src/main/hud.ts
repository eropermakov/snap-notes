import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '../shared/ipc'
import type { HudAction, HudPickNote, HudSession, HudState } from '../shared/hud'
import { loadRoute } from './windows'

/**
 * Capture HUD (§13, §21): a small always-on-top window in the corner of the screen the user is on.
 * It never takes focus from the app the user works in; its size follows its content, so it does not
 * block clicks around it. States that are not part of a session disappear on their own.
 */

const AUTO_HIDE_MS = 5000
const MARGIN = 16
const WIDTH = 360

export interface HudHandlers {
  undo: (noteId: string, sourceId: string) => void
  open: (noteId: string) => void
  sessionNext: () => void
  sessionFinish: () => void
}

let win: BrowserWindow | null = null
let ready: Promise<void> | null = null
let state: HudState = { kind: 'hidden' }
let hideTimer: ReturnType<typeof setTimeout> | null = null
let hovering = false
let size = { width: WIDTH, height: 72 }
let handlers: HudHandlers | null = null
let preload = ''
let sessionState: HudSession | null = null
const picks = new Map<string, (choice: string | null) => void>()

function position(): void {
  if (!win || win.isDestroyed()) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const height = Math.max(40, Math.min(size.height, 480))
  const width = Math.max(200, Math.min(size.width, 480))
  win.setBounds({
    x: Math.round(area.x + area.width - width - MARGIN),
    y: Math.round(area.y + area.height - height - MARGIN),
    width: Math.round(width),
    height: Math.round(height)
  })
}

function ensureWindow(): { win: BrowserWindow; ready: Promise<void> } {
  if (win && !win.isDestroyed() && ready) return { win, ready }
  const created = new BrowserWindow({
    width: WIDTH,
    height: size.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload, sandbox: false }
  })
  created.setAlwaysOnTop(true, 'screen-saver')
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win = created
  ready = new Promise<void>((resolve) => {
    const onReady = (event: IpcMainEvent): void => {
      if (event.sender !== created.webContents) return
      ipcMain.removeListener(IPC.HUD_READY, onReady)
      resolve()
    }
    ipcMain.on(IPC.HUD_READY, onReady)
  })
  created.on('closed', () => {
    if (win === created) {
      win = null
      ready = null
    }
  })
  loadRoute(created, 'hud')
  return { win: created, ready }
}

function scheduleHide(): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  if (state.kind !== 'added' && state.kind !== 'message') return
  hideTimer = setTimeout(() => {
    if (hovering) {
      scheduleHide()
      return
    }
    // In a session the HUD falls back to the session counter instead of disappearing.
    show(sessionState ? { kind: 'session', session: sessionState } : { kind: 'hidden' })
  }, AUTO_HIDE_MS)
}

export function show(next: HudState): void {
  state = next
  scheduleHide()
  const { win: hud, ready: isReady } = ensureWindow()
  void isReady.then(() => {
    if (hud.isDestroyed()) return
    hud.webContents.send(IPC.HUD_STATE, state)
    if (state.kind === 'hidden') {
      hud.hide()
    } else {
      position()
      if (!hud.isVisible()) hud.showInactive()
    }
  })
}

export function hide(): void {
  show({ kind: 'hidden' })
}

/** Keeps session info on every state shown while a Capture Session is running. */
export function setSession(session: HudSession | null): void {
  sessionState = session
}

/** Asks which note to use (§1, "ask" behavior). Resolves 'new', a note id, or null (cancelled / timed out → new). */
export function pickNote(notes: HudPickNote[], timeoutMs = 30_000): Promise<string | null> {
  const requestId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      picks.delete(requestId)
      hide()
      resolve('new')
    }, timeoutMs)
    picks.set(requestId, (choice) => {
      clearTimeout(timer)
      picks.delete(requestId)
      resolve(choice)
    })
    show({ kind: 'pick', requestId, notes })
  })
}

function isAction(value: unknown): value is HudAction {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string')
}

export function initHud(preloadPath: string, actions: HudHandlers): void {
  preload = preloadPath
  handlers = actions
  ipcMain.on(IPC.HUD_ACTION, (event, raw: unknown) => {
    if (!win || event.sender !== win.webContents || !isAction(raw)) return
    const action = raw
    switch (action.type) {
      case 'undo':
        if (typeof action.noteId === 'string' && typeof action.sourceId === 'string') handlers?.undo(action.noteId, action.sourceId)
        break
      case 'open':
        if (typeof action.noteId === 'string') handlers?.open(action.noteId)
        hide()
        break
      case 'sessionNext':
        handlers?.sessionNext()
        break
      case 'sessionFinish':
        handlers?.sessionFinish()
        break
      case 'pick': {
        const resolve = picks.get(action.requestId)
        hide()
        resolve?.(typeof action.choice === 'string' ? action.choice : null)
        break
      }
      case 'dismiss':
        show(sessionState ? { kind: 'session', session: sessionState } : { kind: 'hidden' })
        break
      case 'hover':
        hovering = action.hovering === true
        if (!hovering) scheduleHide()
        break
      case 'resize':
        if (Number.isFinite(action.width) && Number.isFinite(action.height)) {
          size = { width: action.width, height: action.height }
          if (state.kind !== 'hidden') position()
        }
        break
      default:
        break
    }
  })
}

export function prewarmHud(): void {
  ensureWindow()
}

export function destroyHud(): void {
  if (hideTimer) clearTimeout(hideTimer)
  if (win && !win.isDestroyed()) win.destroy()
  win = null
  ready = null
}
