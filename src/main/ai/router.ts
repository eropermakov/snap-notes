import { AiError } from './errors'
import { extractRawWithGemini, formatTextWithGemini, testGeminiKey } from './gemini'
import { extractRawWithGroq, formatTextWithGroq, testGroqKey } from './groq'
import { extractRawWithLocalOcr, testLocalOcr } from './local'
import { recordUsage } from './usage'
import { parseOcrBlocks, renderBlocksToHtml, type OcrBlock } from '../../shared/ocrBlocks'
import type { AiKeyEntry, AiProvider, ApiKeyTestResult, OcrPreset } from '../../shared/types'

export function testProviderKey(provider: AiProvider, apiKey: string): Promise<ApiKeyTestResult> {
  if (provider === 'gemini') return testGeminiKey(apiKey)
  if (provider === 'groq') return testGroqKey(apiKey)
  return testLocalOcr()
}

export interface ExtractResult {
  html: string
  blocks: OcrBlock[]
  usedKeyId: string
  usedKeyLabel: string
}

function toResult(raw: string, keyId: string, keyLabel: string): ExtractResult {
  const blocks = parseOcrBlocks(raw)
  const html = renderBlocksToHtml(blocks)
  return { html, blocks, usedKeyId: keyId, usedKeyLabel: keyLabel }
}

async function extractRaw(key: AiKeyEntry, pngBuffer: Buffer, preset: OcrPreset, existingContext?: string): Promise<string> {
  if (key.provider === 'gemini') return extractRawWithGemini(key.apiKey, pngBuffer, preset, existingContext)
  if (key.provider === 'groq') return extractRawWithGroq(key.apiKey, pngBuffer, preset, existingContext)
  return extractRawWithLocalOcr(pngBuffer)
}

async function formatText(key: AiKeyEntry, rawText: string, preset: OcrPreset, existingContext?: string): Promise<string> {
  if (key.provider === 'gemini') return formatTextWithGemini(key.apiKey, rawText, preset, existingContext)
  return formatTextWithGroq(key.apiKey, rawText, preset, existingContext)
}

export async function extractHtmlWithFallback(
  keys: AiKeyEntry[],
  pngBuffer: Buffer,
  preset: OcrPreset,
  existingContext?: string
): Promise<ExtractResult> {
  if (keys.length === 0) {
    throw new AiError('no-key', 'Не задан ни один источник распознавания. Откройте настройки, чтобы добавить ключ.')
  }

  let lastError: AiError | null = null
  for (const key of keys) {
    try {
      const raw = await extractRaw(key, pngBuffer, preset, existingContext)
      recordUsage(key.id)
      return toResult(raw, key.id, key.label)
    } catch (err) {
      lastError = err instanceof AiError ? err : new AiError('unknown', (err as Error).message)
    }
  }
  throw lastError ?? new AiError('unknown', 'Не удалось распознать текст.')
}

export async function extractHtmlHybrid(
  localKey: AiKeyEntry,
  cloudKeys: AiKeyEntry[],
  pngBuffer: Buffer,
  preset: OcrPreset,
  existingContext?: string
): Promise<ExtractResult> {
  const rawText = await extractRawWithLocalOcr(pngBuffer)
  recordUsage(localKey.id)

  if (!rawText.trim()) {
    return toResult('', localKey.id, localKey.label)
  }

  if (cloudKeys.length === 0) {
    return toResult(rawText, localKey.id, localKey.label)
  }

  let lastError: AiError | null = null
  for (const key of cloudKeys) {
    try {
      const formatted = await formatText(key, rawText, preset, existingContext)
      recordUsage(key.id)
      return toResult(formatted, key.id, `${localKey.label} → ${key.label}`)
    } catch (err) {
      lastError = err instanceof AiError ? err : new AiError('unknown', (err as Error).message)
    }
  }

  // Cloud formatting failed for every key — fall back to the raw local text rather than losing it
  void lastError
  return toResult(rawText, localKey.id, localKey.label)
}
