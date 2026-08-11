import { GoogleGenAI } from '@google/genai'
import { AiError, classifyError, withTimeout } from './errors'
import { buildOcrPrompt, buildTextFormatPrompt } from '../../shared/ocrPresets'
import type { ApiKeyTestResult, OcrPreset } from '../../shared/types'

const MODEL_ID = 'gemini-3.5-flash'
const GENERATION_TIMEOUT_MS = 30000
const TEST_TIMEOUT_MS = 15000

export async function testGeminiKey(apiKey: string): Promise<ApiKeyTestResult> {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, message: 'Ключ не указан.' }
  }
  try {
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() })
    await withTimeout(
      ai.models.generateContent({ model: MODEL_ID, contents: 'ping' }),
      TEST_TIMEOUT_MS,
      'Превышено время ожидания ответа от Gemini.'
    )
    return { ok: true, message: 'Ключ рабочий' }
  } catch (err) {
    const classified = err instanceof AiError ? err : classifyError(err)
    return { ok: false, message: classified.message }
  }
}

export async function extractRawWithGemini(
  apiKey: string,
  pngBuffer: Buffer,
  preset: OcrPreset,
  existingContext?: string
): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    throw new AiError('no-key', 'API-ключ Gemini не задан.')
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim() })
  const base64 = pngBuffer.toString('base64')
  const prompt = buildOcrPrompt(preset, existingContext)

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: MODEL_ID,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: base64 } }]
          }
        ]
      }),
      GENERATION_TIMEOUT_MS,
      'Превышено время ожидания ответа от Gemini.'
    )
    return (response.text ?? '').trim()
  } catch (err) {
    if (err instanceof AiError) throw err
    throw classifyError(err)
  }
}

export async function formatTextWithGemini(
  apiKey: string,
  rawText: string,
  preset: OcrPreset,
  existingContext?: string
): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    throw new AiError('no-key', 'API-ключ Gemini не задан.')
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim() })
  const prompt = buildTextFormatPrompt(preset, rawText, existingContext)

  try {
    const response = await withTimeout(
      ai.models.generateContent({ model: MODEL_ID, contents: prompt }),
      GENERATION_TIMEOUT_MS,
      'Превышено время ожидания ответа от Gemini.'
    )
    return (response.text ?? '').trim()
  } catch (err) {
    if (err instanceof AiError) throw err
    throw classifyError(err)
  }
}
