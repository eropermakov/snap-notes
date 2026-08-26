import { desktopCapturer, screen, ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import { createOverlayWindow } from './windows'

let overlayWin: BrowserWindow | null = null
let overlayReadyPromise: Promise<void> | null = null

function matchSourceToDisplay(
  sources: Electron.DesktopCapturerSource[],
  display: Electron.Display
): Electron.DesktopCapturerSource | null {
  if (sources.length === 0) return null
  const byId = sources.find((s) => s.display_id && s.display_id === String(display.id))
  if (byId) return byId
  if (sources.length === 1) return sources[0]

  const targetRatio = display.size.width / display.size.height
  let best = sources[0]
  let bestDiff = Infinity
  for (const s of sources) {
    const size = s.thumbnail.getSize()
    if (!size.width || !size.height) continue
    const diff = Math.abs(size.width / size.height - targetRatio)
    if (diff < bestDiff) {
      bestDiff = diff
      best = s
    }
  }
  return best
}

async function getSourceForDisplay(display: Electron.Display): Promise<Electron.DesktopCapturerSource | null> {
  const scaleFactor = display.scaleFactor || 1
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scaleFactor),
      height: Math.round(display.size.height * scaleFactor)
    }
  })
  return matchSourceToDisplay(sources, display)
}

export function getActiveDisplay(): Electron.Display {
  const point = screen.getCursorScreenPoint()
  return screen.getDisplayNearestPoint(point)
}

export async function captureFullscreenAtCursor(): Promise<Buffer | null> {
  const display = getActiveDisplay()
  try {
    const source = await getSourceForDisplay(display)
    if (!source) return null
    return source.thumbnail.toPNG()
  } catch {
    return null
  }
}

function ensureOverlayWindow(preloadPath: string): { win: BrowserWindow; readyPromise: Promise<void> } {
  if (overlayWin && !overlayWin.isDestroyed()) {
    return { win: overlayWin, readyPromise: overlayReadyPromise ?? Promise.resolve() }
  }

  const primary = screen.getPrimaryDisplay()
  const win = createOverlayWindow(primary, preloadPath)
  overlayWin = win
  overlayReadyPromise = new Promise<void>((resolve) => {
    const onReady = (event: Electron.IpcMainEvent): void => {
      if (event.sender !== win.webContents) return
      ipcMain.removeListener(IPC.OVERLAY_READY, onReady)
      resolve()
    }
    ipcMain.on(IPC.OVERLAY_READY, onReady)
  })
  win.on('closed', () => {
    if (overlayWin === win) {
      overlayWin = null
      overlayReadyPromise = null
    }
  })

  return { win, readyPromise: overlayReadyPromise }
}

export function prewarmOverlay(preloadPath: string): void {
  ensureOverlayWindow(preloadPath)
}

export function captureRegionAtCursor(preloadPath: string): Promise<Buffer | null> {
  const display = getActiveDisplay()
  const { win, readyPromise } = ensureOverlayWindow(preloadPath)

  return new Promise<Buffer | null>((resolve) => {
    let settled = false

    const finish = (result: Buffer | null): void => {
      if (settled) return
      settled = true
      ipcMain.removeHandler(IPC.OVERLAY_SELECTION)
      ipcMain.removeHandler(IPC.OVERLAY_CANCEL)
      resolve(result)
      if (!win.isDestroyed()) {
        win.hide()
      }
    }

    getSourceForDisplay(display)
      .then((source) => {
        if (!source) {
          finish(null)
          return
        }
        const imageSize = source.thumbnail.getSize()
        const dataUrl = source.thumbnail.toDataURL()

        if (win.isDestroyed()) {
          finish(null)
          return
        }

        win.setBounds({
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height
        })

        ipcMain.handle(
          IPC.OVERLAY_SELECTION,
          (event, rect: { x: number; y: number; width: number; height: number }) => {
            if (event.sender !== win.webContents) return
            const ratioX = imageSize.width / display.bounds.width
            const ratioY = imageSize.height / display.bounds.height
            const cropRect = {
              x: Math.max(0, Math.round(rect.x * ratioX)),
              y: Math.max(0, Math.round(rect.y * ratioY)),
              width: Math.max(1, Math.round(rect.width * ratioX)),
              height: Math.max(1, Math.round(rect.height * ratioY))
            }
            const cropped = source.thumbnail.crop(cropRect)
            finish(cropped.toPNG())
          }
        )

        ipcMain.handle(IPC.OVERLAY_CANCEL, (event) => {
          if (event.sender !== win.webContents) return
          finish(null)
        })

        void readyPromise.then(() => {
          if (win.isDestroyed() || settled) return
          win.webContents.send(IPC.OVERLAY_IMAGE, dataUrl)
          win.show()
          win.focus()
        })
      })
      .catch(() => finish(null))
  })
}

export interface ScreenRegion {
  displayId: number
  cropRect: { x: number; y: number; width: number; height: number }
}

/** Like captureRegionAtCursor, but resolves the selected screen rect instead of a single cropped image, so the same rect can be re-captured repeatedly (used by the scrolling long-screenshot feature). */
export function selectRegionRect(preloadPath: string): Promise<ScreenRegion | null> {
  const display = getActiveDisplay()
  const { win, readyPromise } = ensureOverlayWindow(preloadPath)

  return new Promise<ScreenRegion | null>((resolve) => {
    let settled = false

    const finish = (result: ScreenRegion | null): void => {
      if (settled) return
      settled = true
      ipcMain.removeHandler(IPC.OVERLAY_SELECTION)
      ipcMain.removeHandler(IPC.OVERLAY_CANCEL)
      resolve(result)
      if (!win.isDestroyed()) {
        win.hide()
      }
    }

    getSourceForDisplay(display)
      .then((source) => {
        if (!source) {
          finish(null)
          return
        }
        const imageSize = source.thumbnail.getSize()
        const dataUrl = source.thumbnail.toDataURL()

        if (win.isDestroyed()) {
          finish(null)
          return
        }

        win.setBounds({
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height
        })

        ipcMain.handle(
          IPC.OVERLAY_SELECTION,
          (event, rect: { x: number; y: number; width: number; height: number }) => {
            if (event.sender !== win.webContents) return
            const ratioX = imageSize.width / display.bounds.width
            const ratioY = imageSize.height / display.bounds.height
            const cropRect = {
              x: Math.max(0, Math.round(rect.x * ratioX)),
              y: Math.max(0, Math.round(rect.y * ratioY)),
              width: Math.max(1, Math.round(rect.width * ratioX)),
              height: Math.max(1, Math.round(rect.height * ratioY))
            }
            finish({ displayId: display.id, cropRect })
          }
        )

        ipcMain.handle(IPC.OVERLAY_CANCEL, (event) => {
          if (event.sender !== win.webContents) return
          finish(null)
        })

        void readyPromise.then(() => {
          if (win.isDestroyed() || settled) return
          win.webContents.send(IPC.OVERLAY_IMAGE, dataUrl)
          win.show()
          win.focus()
        })
      })
      .catch(() => finish(null))
  })
}

/** Re-captures a previously selected screen rect without showing the overlay again — used to grab repeated frames while the user scrolls. */
export async function captureDisplayRegion(
  displayId: number,
  cropRect: { x: number; y: number; width: number; height: number }
): Promise<Buffer | null> {
  const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? getActiveDisplay()
  try {
    const source = await getSourceForDisplay(display)
    if (!source) return null
    return source.thumbnail.crop(cropRect).toPNG()
  } catch {
    return null
  }
}
