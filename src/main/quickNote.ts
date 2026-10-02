import { BrowserWindow, screen } from 'electron'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import * as hud from './hud'
import { createQuickNoteWindow, QUICK_NOTE_DEFAULTS } from './windows'
import { resolveSavedState, trackWindowState } from './windowState'
import { broadcastNoteEvent } from './noteWindows'
import { plainTextToHtml } from '../shared/htmlText'
import { meaningfulTitle } from '../shared/textTools'
import { IPC } from '../shared/ipc'
import { noteTitle } from './capturePipeline'

/**
 * Quick Note: a small window above whatever the user is doing. It is created once and only shown /
 * hidden afterwards, so the hotkey answers instantly. The main window is never opened by it.
 */
let win: BrowserWindow | null = null
let preload = ''
let backgroundColor = '#151716'

export function initQuickNote(preloadPath: string, background: string): void {
  preload = preloadPath
  backgroundColor = background
}

export function setQuickNoteBackground(color: string): void {
  backgroundColor = color
  if (win && !win.isDestroyed()) win.setBackgroundColor(color)
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  const state = resolveSavedState(settingsStore.getSettings().quickNoteState, QUICK_NOTE_DEFAULTS)
  const created = createQuickNoteWindow(preload, backgroundColor, state)
  trackWindowState(created, (saved) => settingsStore.updateSettings({ quickNoteState: saved }))
  // Clicking another app dismisses nothing: the text stays until saved or Esc is pressed.
  created.on('closed', () => {
    if (win === created) win = null
  })
  win = created
  return created
}

function placeNearCursor(target: BrowserWindow): void {
  if (settingsStore.getSettings().quickNoteState?.x !== undefined) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = target.getBounds()
  target.setPosition(
    Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    Math.round(display.workArea.y + display.workArea.height * 0.22 - height / 4)
  )
}

/** Shows the window (empty, focused); pressing the hotkey again while it is open hides it. */
export function toggleQuickNote(): void {
  const target = ensureWindow()
  if (target.isVisible() && target.isFocused()) {
    target.hide()
    return
  }
  const show = (): void => {
    target.webContents.send(IPC.ON_QUICK_RESET)
    placeNearCursor(target)
    target.show()
    target.focus()
  }
  if (target.webContents.isLoading()) target.webContents.once('did-finish-load', show)
  else show()
}

export function closeQuickNote(): void {
  if (win && !win.isDestroyed()) win.hide()
}

export function prewarmQuickNote(): void {
  ensureWindow()
}

export function destroyQuickNote(): void {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}

/**
 * Saves the quick note as a normal note. The title is optional: without one, the first meaningful
 * line becomes the title (until the user types their own). Empty input saves nothing.
 */
export async function saveQuickNote(titleInput: unknown, textInput: unknown): Promise<{ ok: boolean }> {
  const title = typeof titleInput === 'string' ? titleInput.trim().slice(0, 200) : ''
  const text = typeof textInput === 'string' ? textInput.slice(0, 200_000) : ''
  if (!title && !text.trim()) {
    closeQuickNote()
    return { ok: false }
  }
  const auto = title ? '' : meaningfulTitle(text)
  const note = await notesStore.createNote({
    title: title || auto,
    body: plainTextToHtml(text),
    ...(title ? { titleManual: true } : {})
  })
  broadcastNoteEvent(IPC.ON_NOTE_CREATED, note)
  closeQuickNote()
  hud.show({ kind: 'added', tone: 'success', noteId: note.id, noteTitle: noteTitle(note), detail: 'Быстрая заметка сохранена' })
  return { ok: true }
}
