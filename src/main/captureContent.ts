import { nativeImage } from 'electron'
import { randomUUID } from 'crypto'
import { blocksToText, newBlockId, type Block, type OcrSource } from '../shared/blocks'
import { itemsToBlocks, plainTextToItems } from '../shared/aiBlocks'
import { layoutToItems } from '../shared/localLayout'
import { extractBlockItems } from '../shared/structuredJson'
import { buildJsonRepairPromptV2, buildTextStructurePrompt, buildTitlePrompt, buildVisionPrompt } from '../shared/ocrPrompts'
import type { RecognitionOutput, RecognitionService } from './providers/recognition'
import type { ProviderManager } from './providers/manager'
import { cropToPng, deleteNoteImage, imageSrc, saveDocumentImage } from './imageStore'
import { splitAtQuietRows } from './imageStitch'
import type { ForegroundWindowInfo } from './windowInfo'

export interface CaptureResult {
  blocks: Block[]
  source: OcrSource
  output: RecognitionOutput
}

export interface CaptureOptions {
  png: Buffer
  noteId: string
  recognition: RecognitionService
  /** Cut photos/illustrations out of the screenshot as image blocks (§11). */
  withImages: boolean
  /** Started when the hotkey fired, before the overlay took focus (§17). */
  windowInfo?: Promise<ForegroundWindowInfo>
  /** Split very tall images (scrolling capture) into parts recognized one by one. */
  splitTall?: boolean
  /** Progress callback for multi-part recognition. */
  onProgress?: (done: number, total: number) => void
}

function normalizeForSeam(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function newSourceId(): string {
  return `c${randomUUID().replace(/-/g, '').slice(0, 20)}`
}

/** Recognition output → block items: AI JSON, else Tesseract layout, else plain paragraphs. */
export function outputToItems(output: RecognitionOutput): unknown[] {
  if (output.structured) {
    const items = extractBlockItems(output.raw)
    if (items) return items
  }
  if (output.localLines && output.localLines.length) {
    const items = layoutToItems(output.localLines)
    if (items.length) return items
  }
  return plainTextToItems(output.raw)
}

/**
 * Screenshot → note blocks linked to a new OCR source. The original screenshot is stored as the
 * source's attachment (never shown inline); photos are cropped into image blocks in reading order.
 * Returns empty blocks (and stores nothing) when nothing was recognized.
 */
export async function recognizeCapture(options: CaptureOptions): Promise<CaptureResult> {
  const { png, noteId, recognition } = options
  const sourceId = newSourceId()
  const parts = options.splitTall ? splitAtQuietRows(png) : [png]

  const blocks: Block[] = []
  let output: RecognitionOutput | null = null
  let notice: RecognitionOutput['notice'] = null
  let offlineFallback = false
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    const partOutput = await recognition.recognize(part, {
      vision: buildVisionPrompt({ withImages: options.withImages }),
      textFormat: buildTextStructurePrompt,
      jsonRepair: buildJsonRepairPromptV2
    })
    output = partOutput
    notice = notice ?? partOutput.notice
    offlineFallback = offlineFallback || partOutput.offlineFallback
    options.onProgress?.(index + 1, parts.length)

    let first = true
    for (const item of itemsToBlocks(outputToItems(partOutput), sourceId)) {
      if (item.type === 'pending_image') {
        if (!options.withImages) continue
        const cropped = cropToPng(part, item.bbox)
        if (!cropped) continue
        const imageId = await saveDocumentImage(noteId, cropped)
        blocks.push({ id: newBlockId(), sourceId, type: 'image', src: imageSrc(noteId, imageId) })
        continue
      }
      // A block repeated across a seam between parts is added once.
      const previous = blocks[blocks.length - 1]
      if (first && previous && normalizeForSeam(blocksToText([previous])) === normalizeForSeam(blocksToText([item]))) {
        first = false
        continue
      }
      first = false
      blocks.push(item)
    }
  }
  if (!output) throw new Error('nothing to recognize')
  output = { ...output, notice, offlineFallback }

  const window = options.windowInfo ? await options.windowInfo.catch(() => ({})) : {}
  const size = nativeImage.createFromBuffer(png).getSize()
  const source: OcrSource = {
    id: sourceId,
    capturedAt: Date.now(),
    ...(size.width ? { imageWidth: size.width, imageHeight: size.height } : {}),
    ...window,
    method: output.providerName,
    model: output.model,
    mode: output.mode
  }
  if (blocks.length > 0) {
    // Original screenshot, kept for "Показать оригинал" / "Проверить распознавание".
    source.imageId = await saveDocumentImage(noteId, png)
  }
  return { blocks, source, output }
}

/** Removes a capture's stored files when its blocks were not used (e.g. duplicate). */
export async function discardCapture(noteId: string, result: CaptureResult): Promise<void> {
  if (result.source.imageId) await deleteNoteImage(noteId, result.source.imageId)
  for (const block of result.blocks) {
    const match = block.type === 'image' ? /^snap-media:\/\/[^/]+\/([a-zA-Z0-9-]+)\.png$/.exec(block.src) : null
    if (match) await deleteNoteImage(noteId, match[1])
  }
}

/** First heading or first line, trimmed to a readable title. */
export function heuristicTitle(blocks: Block[]): string {
  const heading = blocks.find((b) => b.type === 'heading')
  const text = (heading ? blocksToText([heading]) : blocksToText(blocks)).split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  if (text.length <= 60) return text
  const cut = text.slice(0, 60)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}…`
}

/**
 * Short note title (§12). The AI sees the recognized text only and returns just a title — it never
 * changes the note content. Offline mode or any failure falls back to the heuristic title.
 */
export async function generateTitle(manager: ProviderManager, blocks: Block[], offline: boolean): Promise<string> {
  const fallback = heuristicTitle(blocks)
  const text = blocksToText(blocks).trim()
  if (offline || !text) return fallback
  try {
    const outcome = await manager.execute({
      operation: 'TITLE_GENERATION',
      requiredCapabilities: ['text'],
      imageSent: false,
      includeLocalFallback: false,
      run: (provider) => provider.runText({ operation: 'TITLE_GENERATION', prompt: buildTitlePrompt(text) })
    })
    const title = outcome.result.text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean)
      ?.replace(/^["«„'`*#\s]+|["»“'`*.\s]+$/g, '')
      .slice(0, 80)
    return title || fallback
  } catch {
    return fallback
  }
}
