import type { BrowserWindow, WebContents } from 'electron'
import { IPC } from '../shared/ipc'

/**
 * Windows that show notes: the main window and floating note windows. Changes made by the main
 * process (captures, undo, duplicates…) are sent to all of them so every open copy of a note stays in
 * sync; navigation requests go to the main window only.
 */
const windows = new Set<BrowserWindow>()
let mainWindowGetter: () => BrowserWindow | null = () => null

export function setMainWindowGetter(getter: () => BrowserWindow | null): void {
  mainWindowGetter = getter
}

export function registerNoteWindow(win: BrowserWindow): void {
  windows.add(win)
  win.on('closed', () => windows.delete(win))
}

export function noteWindows(): BrowserWindow[] {
  return [...windows].filter((w) => !w.isDestroyed())
}

/** Sends an event to every note window, optionally skipping the one that caused the change. */
export function broadcastToNoteWindows(channel: string, payload?: unknown, except?: WebContents): void {
  for (const win of noteWindows()) {
    if (except && win.webContents === except) continue
    win.webContents.send(channel, payload)
  }
}

/** Capture code calls this for every event: navigation goes to the main window, notes to all windows. */
export function broadcastNoteEvent(channel: string, payload?: unknown): void {
  if (channel === IPC.ON_NAVIGATE) {
    const main = mainWindowGetter()
    if (main && !main.isDestroyed()) main.webContents.send(channel, payload)
    return
  }
  broadcastToNoteWindows(channel, payload)
}
