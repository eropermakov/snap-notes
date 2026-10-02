import { IPC } from '../shared/ipc'
import type { RecognitionService } from './providers/recognition'
import { recognitionErrorMessage, noteTitle, withCompletenessFlag } from './capturePipeline'
import { recognizeCapture, discardCapture } from './captureContent'
import { broadcastNoteEvent } from './noteWindows'
import { readNoteImage } from './imageStore'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import * as hud from './hud'
import { formatRoutingNotice } from '../shared/usageFormat'
import { logEvent } from './logger'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024

/** Accepts only real PNG data of a sane size (the renderer converts every picture format to PNG). */
export function asPngBuffer(value: unknown): Buffer | null {
  if (!(value instanceof Uint8Array) || value.byteLength < 16 || value.byteLength > MAX_IMAGE_BYTES) return null
  const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  return buffer.subarray(0, 8).equals(PNG_SIGNATURE) ? buffer : null
}

const SNAP_IMAGE = /^snap-media:\/\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9-]+)\.png$/

/**
 * "Recognize text" on a picture inside a note. By default the text is inserted under the image (it
 * stays visible next to its source); `replace` swaps the picture for the text. The result is linked
 * to a capture source, so the usual fragment tools, Undo and "Original" work on it.
 */
export async function recognizeNoteImage(
  recognition: RecognitionService,
  noteId: string,
  src: string,
  mode: 'below' | 'replace'
): Promise<{ ok: boolean; message?: string }> {
  const match = SNAP_IMAGE.exec(src)
  const note = notesStore.getNote(noteId)
  if (!match || match[1] !== noteId || !note) return { ok: false, message: 'Изображение не найдено' }
  const png = await readNoteImage(noteId, match[2])
  if (!png) return { ok: false, message: 'Файл изображения не найден' }

  hud.show({ kind: 'working', text: 'Распознаю текст на изображении…' })
  broadcastNoteEvent(IPC.ON_NOTE_PROCESSING_START, noteId)
  try {
    const result = await recognizeCapture({ png, noteId, recognition, withImages: false })
    if (result.blocks.length === 0) {
      hud.show({ kind: 'message', tone: 'warning', text: 'На изображении не удалось найти текст.' })
      return { ok: false, message: 'Текст не найден' }
    }
    const { blocks, flagged } = withCompletenessFlag(result)
    const updated = await notesStore.insertAfterImage(noteId, src, blocks, result.source, mode === 'replace')
    if (!updated) {
      await discardCapture(noteId, result)
      return { ok: false, message: 'Изображение уже удалено из заметки' }
    }
    broadcastNoteEvent(IPC.ON_NOTE_UPDATED, updated)
    const feedback = settingsStore.getSettings().ocrFeedback
    if (feedback !== 'none' || flagged) {
      hud.show({
        kind: 'added',
        tone: flagged || result.output.offlineFallback ? 'warning' : 'success',
        noteId,
        noteTitle: noteTitle(updated),
        sourceId: result.source.id,
        detail: flagged ? 'Похоже, текст поместился не полностью' : result.output.notice ? formatRoutingNotice(result.output.notice) : undefined,
        ...(feedback === 'sound' ? { sound: true } : {})
      })
    }
    return { ok: true }
  } catch (err) {
    logEvent('capture', { kind: 'image', error: err instanceof Error ? err.name : 'unknown' })
    hud.show({ kind: 'message', tone: 'error', text: recognitionErrorMessage(err) })
    return { ok: false, message: recognitionErrorMessage(err) }
  } finally {
    broadcastNoteEvent(IPC.ON_NOTE_PROCESSING_END, noteId)
  }
}
