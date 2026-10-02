import type { Rect } from './windowBounds'

/** Where the last region capture was taken, enough to repeat it later. */
export interface CaptureRegion {
  displayId: number
  /** Display bounds (DIP) and scale at capture time: the layout the crop rectangle belongs to. */
  displayBounds: Rect
  scaleFactor: number
  /** Selection in image pixels (what is cropped from the display's screenshot). */
  cropRect: Rect
  /** Size in pixels of the screenshot the crop rectangle refers to. */
  imageSize: { width: number; height: number }
  capturedAt: number
}

export interface DisplayInfo {
  id: number
  bounds: Rect
  scaleFactor: number
}

export type RegionCheck = { ok: true; display: DisplayInfo } | { ok: false; reason: 'none' | 'display_missing' | 'layout_changed' | 'invalid' }

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * A saved region is repeated only on the same monitor with the same position, size and scale, and
 * only if the rectangle still lies inside the screenshot. Anything else means the layout changed and
 * the caller falls back to a normal selection instead of capturing the wrong area.
 */
export function validateCaptureRegion(region: CaptureRegion | null | undefined, displays: DisplayInfo[]): RegionCheck {
  if (!region) return { ok: false, reason: 'none' }
  const { cropRect, imageSize } = region
  const numbers = [cropRect.x, cropRect.y, cropRect.width, cropRect.height, imageSize.width, imageSize.height, region.scaleFactor]
  if (numbers.some((n) => !Number.isFinite(n)) || cropRect.width < 1 || cropRect.height < 1 || cropRect.x < 0 || cropRect.y < 0) {
    return { ok: false, reason: 'invalid' }
  }
  const display = displays.find((d) => d.id === region.displayId)
  if (!display) return { ok: false, reason: 'display_missing' }
  if (!sameRect(display.bounds, region.displayBounds) || display.scaleFactor !== region.scaleFactor) {
    return { ok: false, reason: 'layout_changed' }
  }
  if (cropRect.x + cropRect.width > imageSize.width || cropRect.y + cropRect.height > imageSize.height) {
    return { ok: false, reason: 'invalid' }
  }
  return { ok: true, display }
}
