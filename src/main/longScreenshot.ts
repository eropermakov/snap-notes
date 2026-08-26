import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '../shared/ipc'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import { selectRegionRect, captureDisplayRegion, ScreenRegion } from './screenshot'
import { stitchFrames } from './imageStitch'
import { saveDocumentImage, imageSrc } from './imageStore'
import { buildDocumentNoteBody } from './documentBuilder'
import { AiError } from './ai/errors'
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
  broadcast(IPC.ON_NOTE_CREATED, note)
  broadcast(IPC.ON_NAVIGATE, { view: 'editor', noteId: note.id })

  const settings = settingsStore.getSettings()
  const geminiKey = settings.aiKeys.find((k) => k.provider === 'gemini' && k.apiKey.trim())

  let html: string | null = null
  let recognized = false

  if (geminiKey) {
    broadcast(IPC.ON_NOTE_PROCESSING_START, note.id)
    try {
      const result = await buildDocumentNoteBody(note.id, geminiKey.apiKey, stitched)
      if (result) {
        html = result.html
        recognized = true
      }
    } catch (err) {
      const message =
        err instanceof AiError ? err.message : 'Не удалось распознать текст и фото на длинном скриншоте.'
      toast('warning', `${message} Сохраняю как обычную картинку.`)
    } finally {
      broadcast(IPC.ON_NOTE_PROCESSING_END, note.id)
    }
  }

  if (!html) {
    const imageId = await saveDocumentImage(note.id, stitched)
    html = `<p><img class="doc-image" src="${imageSrc(note.id, imageId)}" alt="" /></p>`
  }

  const updated = await notesStore.updateNote(note.id, { body: html })
  if (updated) {
    broadcast(IPC.ON_NOTE_UPDATED, updated)
  }

  toast(
    'success',
    recognized
      ? `Длинный скриншот распознан и сохранён (${activeSession.frames.length} кадров)`
      : `Длинный скриншот сохранён как картинка (${activeSession.frames.length} кадров)`
  )
}
