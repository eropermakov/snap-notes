import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import { captureRegionAtCursor } from './screenshot'
import { formatRoutingNotice } from '../shared/usageFormat'
import type { RecognitionService } from './providers/recognition'
import { discardEmptyAutoNote, noteTitle, recognitionErrorMessage, setActiveNoteId, withCompletenessFlag } from './capturePipeline'
import { broadcastNoteEvent } from './noteWindows'
import * as hud from './hud'
import { heuristicTitle, recognizeCapture } from './captureContent'
import { readForegroundWindow } from './windowInfo'
import { logEvent } from './logger'

let capturing = false
let recognition: RecognitionService | null = null

export function initDocumentCapture(_getMainWindow: () => BrowserWindow | null, service: RecognitionService): void {
  recognition = service
}

function broadcast(channel: string, payload?: unknown): void {
  broadcastNoteEvent(channel, payload)
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

    // Made by the capture, not by the user: removed again if nothing is recognized.
    const note = await notesStore.createNote({ autoCreated: true })
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
      // The title comes from the first meaningful line: instant, and no AI quota is spent on it.
      const updated = (await notesStore.setAutoTitle(note.id, heuristicTitle(result.blocks))) ?? notesStore.getNote(note.id)
      if (updated) {
        broadcast(IPC.ON_NOTE_UPDATED, updated)
        const warn = result.output.offlineFallback
        if (settings.ocrFeedback !== 'none' || warn) {
          hud.show({
            kind: 'added',
            tone: warn ? 'warning' : 'success',
            noteId: note.id,
            noteTitle: noteTitle(updated),
            detail: result.output.notice ? formatRoutingNotice(result.output.notice) : 'Новая заметка',
            ...(settings.ocrFeedback === 'sound' ? { sound: true } : {})
          })
        }
      }
    } catch (err) {
      logEvent('capture', { kind: 'newNote', error: err instanceof Error ? err.name : 'unknown' })
      hud.show({ kind: 'message', tone: 'error', text: recognitionErrorMessage(err) })
    } finally {
      broadcast(IPC.ON_NOTE_PROCESSING_END, note.id)
      await discardEmptyAutoNote(note.id)
    }
  } finally {
    capturing = false
  }
}
