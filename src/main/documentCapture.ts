import { BrowserWindow } from 'electron'
import { captureRegionAtCursor } from './screenshot'
import { acceptCapture, beginSelection, createCaptureNote, endSelection } from './capturePipeline'
import * as hud from './hud'
import { readForegroundWindow } from './windowInfo'
import type { RecognitionService } from './providers/recognition'

export function initDocumentCapture(_getMainWindow: () => BrowserWindow | null, _service: RecognitionService): void {
  /* recognition runs in the shared OCR queue */
}

/**
 * Capture to New Note (§12), on the former "Документ из скриншота" hotkey: select a region → a new
 * note is created right away and the screenshot joins the OCR queue like any other capture. Text,
 * structure and photos arrive in the background, and the note gets a short title from its first
 * meaningful line. Several of these in a row make several notes without waiting.
 */
export async function runDocumentCapture(preloadPath: string): Promise<void> {
  if (!beginSelection()) return
  const windowInfo = readForegroundWindow()
  let buffer: Buffer | null
  try {
    buffer = await captureRegionAtCursor(preloadPath)
  } catch (err) {
    hud.show({ kind: 'message', tone: 'error', text: `Не удалось сделать скриншот: ${(err as Error).message}` })
    return
  } finally {
    endSelection()
  }
  if (!buffer) return

  // Made by the capture, not by the user: removed again if nothing is recognized.
  const note = await createCaptureNote()
  await acceptCapture(buffer, { origin: 'screen', targetNoteId: note.id, createdNote: true, windowInfo, ignoreSession: true })
}
