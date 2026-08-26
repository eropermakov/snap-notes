import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '../shared/ipc'
import * as notesStore from './notesStore'
import { selectRegionRect, captureDisplayRegion, ScreenRegion } from './screenshot'
import { stitchFrames } from './imageStitch'
import { saveDocumentImage, imageSrc } from './imageStore'
import { ToastPayload } from '../shared/types'

const CAPTURE_INTERVAL_MS = 500
const MAX_FRAMES = 150

interface Session {
  region: ScreenRegion
  frames: Buffer[]
  intervalId: ReturnType<typeof setInterval>
}

let session: Session | null = null
let starting = false
let getWin: (() => BrowserWindow | null) | null = null

export function initLongScreenshot(getMainWindow: () => BrowserWindow | null): void {
  getWin = getMainWindow
}

function broadcast(channel: string, payload?: unknown): void {
  const win = getWin?.() ?? null
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

function toast(type: ToastPayload['type'], message: string): void {
  const win = getWin?.() ?? null
  if (!win || win.isDestroyed()) return
  const payload: ToastPayload = { id: randomUUID(), type, message }
  win.webContents.send(IPC.ON_TOAST, payload)
}

export function isLongScreenshotActive(): boolean {
  return session !== null
}

export async function toggleLongScreenshot(preloadPath: string): Promise<void> {
  if (session) {
    await finishLongScreenshot()
    return
  }
  if (starting) return
  starting = true

  try {
    const region = await selectRegionRect(preloadPath)
    if (!region) return

    if (region.cropRect.width < 40 || region.cropRect.height < 40) {
      toast('warning', 'Область слишком маленькая для длинного скриншота.')
      return
    }

    const firstFrame = await captureDisplayRegion(region.displayId, region.cropRect)
    if (!firstFrame) {
      toast('error', 'Не удалось начать захват.')
      return
    }

    const activeSession: Session = {
      region,
      frames: [firstFrame],
      intervalId: setInterval(() => {
        void captureNextFrame(activeSession)
      }, CAPTURE_INTERVAL_MS)
    }

    session = activeSession
    toast(
      'success',
      `Долгий скриншот запущен — плавно прокручивайте страницу. Нажмите хоткей ещё раз, чтобы завершить и сохранить (максимум ${MAX_FRAMES} кадров).`
    )
  } finally {
    starting = false
  }
}

async function captureNextFrame(activeSession: Session): Promise<void> {
  if (session !== activeSession) return
  if (activeSession.frames.length >= MAX_FRAMES) {
    void finishLongScreenshot()
    return
  }
  const frame = await captureDisplayRegion(activeSession.region.displayId, activeSession.region.cropRect)
  if (frame && session === activeSession) {
    activeSession.frames.push(frame)
  }
}

export function cancelLongScreenshotSession(): void {
  if (!session) return
  clearInterval(session.intervalId)
  session = null
}

async function finishLongScreenshot(): Promise<void> {
  const activeSession = session
  if (!activeSession) return
  session = null
  clearInterval(activeSession.intervalId)

  if (activeSession.frames.length === 0) {
    toast('warning', 'Не удалось снять ни одного кадра.')
    return
  }

  const stitched = stitchFrames(activeSession.frames)
  if (!stitched) {
    toast('error', 'Не удалось склеить кадры в один скриншот.')
    return
  }

  const note = await notesStore.createNote({ title: 'Длинный скриншот' })
  const imageId = await saveDocumentImage(note.id, stitched)
  const html = `<p><img class="doc-image" src="${imageSrc(note.id, imageId)}" alt="" /></p>`
  const updated = await notesStore.updateNote(note.id, { body: html })

  broadcast(IPC.ON_NOTE_CREATED, note)
  broadcast(IPC.ON_NAVIGATE, { view: 'editor', noteId: note.id })
  if (updated) {
    broadcast(IPC.ON_NOTE_UPDATED, updated)
  }
  toast('success', `Длинный скриншот сохранён (${activeSession.frames.length} кадров)`)
}
