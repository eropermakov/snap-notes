import { createWorker, type Worker } from 'tesseract.js'
import { app } from 'electron'
import path from 'path'
import type { LocalOcrEngine, LocalOcrLine, LocalOcrResult } from '../providers/impl/tesseract'

let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('rus+eng', undefined, {
      cachePath: path.join(app.getPath('userData'), 'tesseract-cache')
    }).catch((err: unknown) => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

export async function recognizeLocal(pngBuffer: Buffer): Promise<LocalOcrResult> {
  const worker = await getWorker()
  const result = await worker.recognize(pngBuffer, {}, { text: true, blocks: true })
  const lines: LocalOcrLine[] = []
  for (const block of result.data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        lines.push({
          text: line.text ?? '',
          confidence: line.confidence ?? 0,
          bbox: line.bbox,
          wordConfidences: (line.words ?? []).map((w) => w.confidence ?? 0),
          words: (line.words ?? []).map((w) => ({ text: w.text ?? '', confidence: w.confidence ?? 0, bbox: w.bbox }))
        })
      }
    }
  }
  return { text: (result.data.text ?? '').trim(), confidence: result.data.confidence ?? 0, lines }
}

export const tesseractEngine: LocalOcrEngine = {
  recognize: recognizeLocal,
  ready: async () => {
    await getWorker()
  }
}

export async function terminateLocalOcr(): Promise<void> {
  if (!workerPromise) return
  const current = workerPromise
  workerPromise = null
  try {
    const worker = await current
    await worker.terminate()
  } catch {
    /* ignore */
  }
}
