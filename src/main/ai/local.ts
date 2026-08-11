import { createWorker, type Worker } from 'tesseract.js'
import { app } from 'electron'
import path from 'path'
import { AiError } from './errors'
import type { ApiKeyTestResult } from '../../shared/types'

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

export async function extractRawWithLocalOcr(pngBuffer: Buffer): Promise<string> {
  try {
    const worker = await getWorker()
    const result = await worker.recognize(pngBuffer)
    return (result.data.text ?? '').trim()
  } catch (err) {
    throw new AiError('unknown', `Локальное распознавание не удалось: ${(err as Error).message}`)
  }
}

export async function testLocalOcr(): Promise<ApiKeyTestResult> {
  try {
    await getWorker()
    return { ok: true, message: 'Локальное распознавание готово к работе' }
  } catch (err) {
    return { ok: false, message: `Не удалось подготовить локальное распознавание: ${(err as Error).message}` }
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
