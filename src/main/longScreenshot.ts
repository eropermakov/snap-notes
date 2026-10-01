import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import { selectRegionRect, captureDisplayRegion, ScreenRegion } from './screenshot'
import { stitchFrames } from './imageStitch'
import { saveDocumentImage, imageSrc } from './imageStore'
import { ToastPayload } from '../shared/types'
import type { RecognitionService } from './providers/recognition'
import { noteTitle, recognitionErrorMessage, setActiveNoteId } from './capturePipeline'
import * as hud from './hud'
import { generateTitle, recognizeCapture } from './captureContent'
import { readForegroundWindow, type ForegroundWindowInfo } from './windowInfo'

const CAPTURE_INTERVAL_MS = 500
const MAX_FRAMES = 150

interface Session {
  region: ScreenRegion
  frames: Buffer[]
  intervalId: ReturnType<typeof setInterval>
  windowInfo: Promise<ForegroundWindowInfo>
}

let session: Session | null = null
let starting = false
let getWin: (() => BrowserWindow | null) | null = null
let recognition: RecognitionService | null = null

export function initLongScreenshot(getMainWindow: () => BrowserWindow | null, service: RecognitionService): void {
  getWin = getMainWindow
  recognition = service
}

function broadcast(channel: string, payload?: unknown): void {
  const win = getWin?.() ?? null
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

/** The user is in another app while scrolling: messages go to the HUD, not the app window. */
function toast(type: ToastPayload['type'], message: string): void {
  hud.show({ kind: 'message', tone: type === 'error' ? 'error' : 'warning', text: message })
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
    const windowInfo = readForegroundWindow()
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
      windowInfo,
      frames: [firstFrame],
      intervalId: setInterval(() => {
        void captureNextFrame(activeSession)
      }, CAPTURE_INTERVAL_MS)
    }

    session = activeSession
    hud.show({
      kind: 'working',
      text: `Запись прокрутки — плавно прокручивайте страницу, затем нажмите хоткей ещё раз (до ${MAX_FRAMES} кадров)`
    })
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

  // Scrolling OCR (§14): the result is a structured document; the long picture is only a fallback.
  const note = await notesStore.createNote({ title: 'Длинный скриншот' })
  setActiveNoteId(note.id)
  broadcast(IPC.ON_NOTE_CREATED, note)
  broadcast(IPC.ON_NAVIGATE, { view: 'editor', noteId: note.id })

  const settings = settingsStore.getSettings()
  let recognized = false

  if (recognition) {
    broadcast(IPC.ON_NOTE_PROCESSING_START, note.id)
    hud.show({ kind: 'working', text: 'Распознаю длинную страницу…' })
    try {
      const result = await recognizeCapture({
        png: stitched,
        noteId: note.id,
        recognition,
        withImages: true,
        splitTall: true,
        windowInfo: activeSession.windowInfo,
        onProgress: (done, total) => {
          if (total > 1 && done < total) hud.show({ kind: 'working', text: `Распознаю длинную страницу… ${done + 1} из ${total}` })
        }
      })
      if (result.blocks.length > 0) {
        recognized = true
        await notesStore.appendBlocks(note.id, result.blocks, result.source)
        const title = await generateTitle(recognition.manager, result.blocks, settings.ai.mode === 'offline')
        const updated = await notesStore.updateNote(note.id, { title: title || 'Длинный скриншот' })
        if (updated) broadcast(IPC.ON_NOTE_UPDATED, updated)
      }
    } catch (err) {
      toast('warning', `${recognitionErrorMessage(err)} Сохраняю как обычную картинку.`)
    } finally {
      broadcast(IPC.ON_NOTE_PROCESSING_END, note.id)
    }
  }

  if (!recognized) {
    const imageId = await saveDocumentImage(note.id, stitched)
    const updated = await notesStore.updateNote(note.id, {
      body: `<p><img class="doc-image" src="${imageSrc(note.id, imageId)}" alt="" /></p>`
    })
    if (updated) broadcast(IPC.ON_NOTE_UPDATED, updated)
  }

  hud.show({
    kind: 'added',
    tone: recognized ? 'success' : 'warning',
    noteId: note.id,
    noteTitle: noteTitle(notesStore.getNote(note.id)),
    detail: recognized
      ? `Длинная страница распознана · кадров: ${activeSession.frames.length}`
      : `Сохранено как картинка · кадров: ${activeSession.frames.length}`
  })
}

