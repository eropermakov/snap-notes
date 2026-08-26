import { extractDocumentBlocksRaw } from './ai/gemini'
import { parseDocumentBlocks, renderDocumentBlocksToHtml } from '../shared/documentBlocks'
import { saveDocumentImage, imageSrc, cropToPng } from './imageStore'

export interface DocumentBuildResult {
  html: string
  blockCount: number
}

/**
 * Sends a screenshot to Gemini for sequential text+photo block extraction, crops any detected
 * photos out of the original screenshot, saves them under the note's own image folder, and
 * renders everything back into note HTML with images inline in their original reading order.
 * Returns null if Gemini found nothing on the screenshot at all.
 */
export async function buildDocumentNoteBody(
  noteId: string,
  geminiApiKey: string,
  screenshotBuffer: Buffer
): Promise<DocumentBuildResult | null> {
  const raw = await extractDocumentBlocksRaw(geminiApiKey, screenshotBuffer)
  const blocks = parseDocumentBlocks(raw)
  if (blocks.length === 0) return null

  const imageSrcByIndex = new Map<number, string>()
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.type !== 'image') continue
    const cropped = cropToPng(screenshotBuffer, block.bbox)
    if (!cropped) continue
    const imageId = await saveDocumentImage(noteId, cropped)
    imageSrcByIndex.set(i, imageSrc(noteId, imageId))
  }

  return { html: renderDocumentBlocksToHtml(blocks, imageSrcByIndex), blockCount: blocks.length }
}
