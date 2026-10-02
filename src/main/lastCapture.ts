import { screen } from 'electron'
import type { CaptureRegion, DisplayInfo } from '../shared/captureRegion'

/** The area of the last region capture (kept in memory only: screen layouts do not survive a restart). */
let last: CaptureRegion | null = null

export function setLastRegion(region: CaptureRegion): void {
  last = region
}

export function getLastRegion(): CaptureRegion | null {
  return last
}

export function currentDisplays(): DisplayInfo[] {
  return screen.getAllDisplays().map((d) => ({ id: d.id, bounds: { ...d.bounds }, scaleFactor: d.scaleFactor }))
}
