import type { SavedWindowState } from './types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenInfo {
  /** Usable area (without the taskbar). */
  workArea: Rect
}

export interface WindowDefaults {
  width: number
  height: number
  minWidth: number
  minHeight: number
}

export interface ResolvedWindowState {
  bounds: { x?: number; y?: number; width: number; height: number }
  maximized: boolean
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function intersection(a: Rect, b: Rect): { width: number; height: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return { width: Math.max(0, width), height: Math.max(0, height) }
}

/** The part of the window the user must be able to grab: enough of the title bar on some screen. */
const MIN_VISIBLE_WIDTH = 120
const MIN_VISIBLE_HEIGHT = 48

/**
 * Turns a saved window geometry into one that is safe to open now. If the monitor it was on is gone
 * (or the layout changed) so that the window would be off-screen, it is moved to the primary screen
 * (the first one in `screens`) and clamped to its work area. Without a position the OS decides.
 */
export function resolveWindowState(saved: SavedWindowState | null | undefined, screens: ScreenInfo[], defaults: WindowDefaults): ResolvedWindowState {
  const fallbackArea = screens[0]?.workArea
  if (!saved || !finite(saved.width) || !finite(saved.height)) {
    return { bounds: { width: defaults.width, height: defaults.height }, maximized: false }
  }
  const width = Math.max(defaults.minWidth, Math.round(saved.width))
  const height = Math.max(defaults.minHeight, Math.round(saved.height))
  const maximized = saved.maximized === true

  if (!finite(saved.x) || !finite(saved.y)) {
    return { bounds: { width, height }, maximized }
  }
  const rect: Rect = { x: Math.round(saved.x), y: Math.round(saved.y), width, height }
  const visible = screens.some((s) => {
    const i = intersection(rect, s.workArea)
    return i.width >= Math.min(MIN_VISIBLE_WIDTH, width) && i.height >= Math.min(MIN_VISIBLE_HEIGHT, height)
  })
  if (visible) return { bounds: rect, maximized }
  if (!fallbackArea) return { bounds: { width, height }, maximized }

  const fitWidth = Math.min(width, fallbackArea.width)
  const fitHeight = Math.min(height, fallbackArea.height)
  return {
    bounds: {
      x: Math.round(fallbackArea.x + (fallbackArea.width - fitWidth) / 2),
      y: Math.round(fallbackArea.y + (fallbackArea.height - fitHeight) / 2),
      width: fitWidth,
      height: fitHeight
    },
    maximized
  }
}
