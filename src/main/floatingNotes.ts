import { BrowserWindow } from 'electron'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import { createNoteWindow, FLOATING_DEFAULTS } from './windows'
import { resolveSavedState, trackWindowState } from './windowState'
import { registerNoteWindow } from './noteWindows'

/**
 * "Open in floating window": one small window per note, remembering its geometry and the
 * Always-on-top choice. It closes independently of the main window; edits are synchronized through
 * the same note events as the main window (see noteWindows.ts).
 */
const windows = new Map<string, BrowserWindow>()
let preload = ''
let icon = ''
let backgroundColor = '#151716'

export function initFloatingNotes(preloadPath: string, iconPath: string, background: string): void {
  preload = preloadPath
  icon = iconPath
  backgroundColor = background
}

export function setFloatingBackground(color: string): void {
  backgroundColor = color
  for (const win of windows.values()) if (!win.isDestroyed()) win.setBackgroundColor(color)
}

export function openFloatingNote(noteId: string): boolean {
  const note = notesStore.getNote(noteId)
  if (!note || note.deletedAt !== null) return false

  const existing = windows.get(noteId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return true
  }

  const settings = settingsStore.getSettings()
  const state = resolveSavedState(settings.floatingState, FLOATING_DEFAULTS)
  // A second floating window opens slightly offset instead of exactly on top of the first.
  const open = [...windows.values()].filter((w) => !w.isDestroyed()).length
  if (open > 0 && state.bounds.x !== undefined && state.bounds.y !== undefined) {
    state.bounds = { ...state.bounds, x: state.bounds.x + 28 * open, y: state.bounds.y + 28 * open }
  }
  const win = createNoteWindow(noteId, preload, icon, backgroundColor, state, settings.floatingOnTop)
  windows.set(noteId, win)
  registerNoteWindow(win)
  trackWindowState(win, (saved) => settingsStore.updateSettings({ floatingState: saved }))
  win.on('closed', () => {
    if (windows.get(noteId) === win) windows.delete(noteId)
  })
  return true
}

export function setWindowAlwaysOnTop(win: BrowserWindow, on: boolean): boolean {
  if (win.isDestroyed()) return false
  win.setAlwaysOnTop(on)
  settingsStore.updateSettings({ floatingOnTop: on })
  return win.isAlwaysOnTop()
}

/** Closes the floating window of a note that was deleted. */
export function closeFloatingNote(noteId: string): void {
  const win = windows.get(noteId)
  if (win && !win.isDestroyed()) win.close()
}
