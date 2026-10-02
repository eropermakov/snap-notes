import { BrowserWindow, screen } from 'electron'
import { debounce } from '../shared/debounce'
import type { SavedWindowState } from '../shared/types'
import { resolveWindowState, type ResolvedWindowState, type ScreenInfo, type WindowDefaults } from '../shared/windowBounds'

/** Connected screens, primary first (the fallback for windows whose monitor is gone). */
export function screenInfos(): ScreenInfo[] {
  const primary = screen.getPrimaryDisplay().id
  return screen
    .getAllDisplays()
    .sort((a, b) => (a.id === primary ? -1 : b.id === primary ? 1 : 0))
    .map((d) => ({ workArea: d.workArea }))
}

export function resolveSavedState(saved: SavedWindowState | null | undefined, defaults: WindowDefaults): ResolvedWindowState {
  return resolveWindowState(saved, screenInfos(), defaults)
}

/** Saves size, position and maximized state while the user works with the window (debounced). */
export function trackWindowState(win: BrowserWindow, save: (state: SavedWindowState) => void): void {
  const capture = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    const bounds = win.getNormalBounds()
    save({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized: win.isMaximized() })
  }
  const later = debounce(capture, 400)
  win.on('resize', later)
  win.on('move', later)
  win.on('maximize', capture)
  win.on('unmaximize', capture)
  win.on('close', () => {
    later.cancel()
    capture()
  })
}
