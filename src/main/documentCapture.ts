import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import { captureRegionAtCursor } from './screenshot'
import { formatRoutingNotice } from '../shared/usageFormat'
import type { RecognitionService } from './providers/recognition'
import { noteTitle, recognitionErrorMessage, setActiveNoteId, withCompletenessFlag } from './capturePipeline'
import * as hud from './hud'
import { generateTitle, recognizeCapture } from './captureContent'
import { readForegroundWindow } from './windowInfo'
import { logEvent } from './logger'

let capturing = false
let getWin: (() => BrowserWindow | null) | null = null
let recognition: RecognitionService | null = null

export function initDocumentCapture(getMainWindow: () => BrowserWindow | null, service: RecognitionService): void {
  getWin = getMainWindow
  recognition = service
}

function broadcast(channel: string, payload?: unknown): void {
  const win = getWin?.() ?? null
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

/**
 * Capture to New Note (§12), on the former "Документ из скриншота" hotkey: select a region →
 * recognize text, structure and photos → new note → short title. The AI may name the note but the
 * recognized content is added exactly as recognized.
 */
export async function runDocumentCapture(preloadPath: string): Promise<void> {
  if (capturing) return
  capturing = true
  const windowInfo = readForegroundWindow()

  try {
    const settings = settingsStore.getSettings()
    if (!recognition) return

    let buffer: Buffer | null
    try {
      buffer = await captureRegionAtCursor(preloadPath)
    } catch (err) {
      hud.show({ kind: 'message', tone: 'error', text: `Не удалось сделать скриншот: ${(err as Error).message}` })
      return
    }
    if (!buffer) return

    const note = await notesStore.createNote()
    setActiveNoteId(note.id)
    broadcast(IPC.ON_NOTE_CREATED, note)
    broadcast(IPC.ON_NAVIGATE, { view: 'editor', noteId: note.id })
    broadcast(IPC.ON_NOTE_PROCESSING_START, note.id)
    hud.show({ kind: 'working', text: 'Распознаю в новую заметку…' })

    try {
      const result = await recognizeCapture({ png: buffer, noteId: note.id, recognition, withImages: true, windowInfo })
      if (result.blocks.length === 0) {
        hud.show({ kind: 'message', tone: 'warning', text: 'На скриншоте не удалось найти текст или фото.' })
        return
      }
      const { blocks } = withCompletenessFlag(result)
      await notesStore.appendBlocks(note.id, blocks, result.source)
      const title = await generateTitle(recognition.manager, result.blocks, settings.ai.mode === 'offline')
      const updated = await notesStore.updateNote(note.id, { title })
      if (updated) {
        broadcast(IPC.ON_NOTE_UPDATED, updated)
        hud.show({
          kind: 'added',
          tone: result.output.offlineFallback ? 'warning' : 'success',
          noteId: note.id,
          noteTitle: noteTitle(updated),
          detail: result.output.notice ? formatRoutingNotice(result.output.notice) : 'Новая заметка'
        })
      }
    } catch (err) {
      logEvent('capture', { kind: 'newNote', error: err instanceof Error ? err.name : 'unknown' })
      hud.show({ kind: 'message', tone: 'error', text: recognitionErrorMessage(err) })
    } finally {
      broadcast(IPC.ON_NOTE_PROCESSING_END, note.id)
    }
  } finally {
    capturing = false
  }
}
