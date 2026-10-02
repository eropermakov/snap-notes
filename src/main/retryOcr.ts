import { randomUUID } from 'crypto'
import { blocksToText, htmlToBlocks, type Block } from '../shared/blocks'
import { itemsToBlocks } from '../shared/aiBlocks'
import { buildJsonRepairPromptV2, buildTextStructurePrompt, buildVisionPrompt } from '../shared/ocrPrompts'
import { PROVIDER_NAMES, type ProviderId } from '../shared/providers'
import type { Note } from '../shared/types'
import type { RetryProvider, RetryResult } from '../shared/retry'
import type { RecognitionService } from './providers/recognition'
import { AllProvidersFailedError } from './providers/router'
import { outputToItems } from './captureContent'
import { qualityFromLines, storedQuality } from '../shared/ocrQuality'
import { readNoteImage } from './imageStore'
import * as notesStore from './notesStore'

/**
 * "Retry with another AI" for a recognized fragment. The new result is produced first and held here;
 * the note is not touched until the user chooses Replace, so the current text is never lost.
 */
interface Candidate {
  noteId: string
  sourceId: string
  blocks: Block[]
  providerName: string
  model: string
  quality?: 'HIGH' | 'MEDIUM' | 'LOW'
}

const candidates = new Map<string, Candidate>()
const MAX_CANDIDATES = 10


function providerIdOf(method: string | undefined): ProviderId | null {
  if (!method) return null
  const entry = (Object.entries(PROVIDER_NAMES) as [ProviderId, string][]).find(([, name]) => name.toLowerCase() === method.toLowerCase())
  return entry?.[0] ?? null
}

function fragment(note: Note, sourceId: string): Block[] {
  return (note.blocks ?? htmlToBlocks(note.body)).filter((b) => b.sourceId === sourceId)
}

/** Vision/OCR providers that can take the screenshot right now, in routing order. */
export async function listRetryProviders(recognition: RecognitionService, noteId: string, sourceId: string): Promise<RetryProvider[]> {
  const note = notesStore.getNote(noteId)
  const source = note?.sources?.[sourceId]
  if (!note || !source?.imageId) return []
  const current = providerIdOf(source.method)
  const providers = await recognition.visionProviders(source.imageWidth && source.imageHeight ? source.imageWidth * source.imageHeight : 1_000_000)
  return providers.map((p) => ({ ...p, current: p.id === current }))
}

export async function retrySource(
  recognition: RecognitionService,
  noteId: string,
  sourceId: string,
  target: 'next' | ProviderId
): Promise<RetryResult> {
  const note = notesStore.getNote(noteId)
  const source = note?.sources?.[sourceId]
  if (!note || !source) return { ok: false, message: 'Фрагмент не найден' }
  if (!source.imageId) return { ok: false, message: 'Оригинал скриншота не сохранён — повторить нечем.' }
  const png = await readNoteImage(noteId, source.imageId)
  if (!png) return { ok: false, message: 'Оригинал скриншота не найден.' }

  const current = providerIdOf(source.method)
  try {
    const output = await recognition.recognizeWith(
      png,
      { vision: buildVisionPrompt({ withImages: false }), textFormat: buildTextStructurePrompt, jsonRepair: buildJsonRepairPromptV2 },
      target === 'next' ? { exclude: current ? [current] : [] } : { only: target }
    )
    const blocks = itemsToBlocks(outputToItems(output), sourceId).filter((b): b is Block => b.type !== 'pending_image')
    if (blocks.length === 0) return { ok: false, message: 'Новый источник ничего не распознал — текст не изменён.' }

    const token = randomUUID()
    candidates.set(token, {
      noteId,
      sourceId,
      blocks,
      providerName: output.providerName,
      model: output.model,
      quality: storedQuality(qualityFromLines(output.localLines))
    })
    while (candidates.size > MAX_CANDIDATES) candidates.delete(candidates.keys().next().value as string)
    return {
      ok: true,
      token,
      providerName: output.providerName,
      model: output.model,
      oldText: blocksToText(fragment(note, sourceId).filter((b) => b.type !== 'image')),
      newText: blocksToText(blocks)
    }
  } catch (err) {
    if (err instanceof AllProvidersFailedError) {
      return { ok: false, message: err.attempts.length === 0 ? 'Нет другого доступного источника распознавания.' : 'Источник не ответил — текст не изменён.' }
    }
    return { ok: false, message: 'Не удалось повторить распознавание — текст не изменён.' }
  }
}

/** Replace: puts the held result into the note (photos of the fragment are kept) and updates its source label. */
export async function applyRetry(token: string): Promise<Note | null> {
  const candidate = candidates.get(token)
  if (!candidate) return null
  candidates.delete(token)
  const note = notesStore.getNote(candidate.noteId)
  if (!note) return null
  const images = fragment(note, candidate.sourceId).filter((b) => b.type === 'image')
  const replaced = await notesStore.replaceSourceBlocks(candidate.noteId, candidate.sourceId, [...candidate.blocks, ...images])
  if (!replaced) return null
  return (await notesStore.updateSource(candidate.noteId, candidate.sourceId, { method: candidate.providerName, model: candidate.model, quality: candidate.quality })) ?? replaced
}

export function discardRetry(token: string): void {
  candidates.delete(token)
}
