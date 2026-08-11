import { AiError, classifyError, withTimeout } from './errors'
import { buildOcrPrompt, buildTextFormatPrompt } from '../../shared/ocrPresets'
import type { ApiKeyTestResult, OcrPreset } from '../../shared/types'

const MODEL_ID = 'qwen/qwen3.6-27b'
const API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GENERATION_TIMEOUT_MS = 30000
const TEST_TIMEOUT_MS = 15000

interface GroqChatContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

interface GroqMessage {
  role: 'user'
  content: string | GroqChatContentPart[]
}

async function callGroq(apiKey: string, messages: GroqMessage[], timeoutMs: number, timeoutMessage: string): Promise<string> {
  const request = fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify({ model: MODEL_ID, messages, max_tokens: 4096 })
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = new Error(body || `HTTP ${res.status}`) as Error & { status: number }
      err.status = res.status
      throw err
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ''
  })

  return withTimeout(request, timeoutMs, timeoutMessage)
}

export async function testGroqKey(apiKey: string): Promise<ApiKeyTestResult> {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, message: 'Ключ не указан.' }
  }
  try {
    await callGroq(apiKey, [{ role: 'user', content: 'ping' }], TEST_TIMEOUT_MS, 'Превышено время ожидания ответа от Groq.')
    return { ok: true, message: 'Ключ рабочий' }
  } catch (err) {
    const classified = err instanceof AiError ? err : classifyError(err)
    return { ok: false, message: classified.message }
  }
}

export async function extractRawWithGroq(
  apiKey: string,
  pngBuffer: Buffer,
  preset: OcrPreset,
  existingContext?: string
): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    throw new AiError('no-key', 'API-ключ Groq не задан.')
  }

  const base64 = pngBuffer.toString('base64')
  const prompt = buildOcrPrompt(preset, existingContext)

  try {
    const text = await callGroq(
      apiKey,
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
          ]
        }
      ],
      GENERATION_TIMEOUT_MS,
      'Превышено время ожидания ответа от Groq.'
    )
    return text.trim()
  } catch (err) {
    if (err instanceof AiError) throw err
    throw classifyError(err)
  }
}

export async function formatTextWithGroq(
  apiKey: string,
  rawText: string,
  preset: OcrPreset,
  existingContext?: string
): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    throw new AiError('no-key', 'API-ключ Groq не задан.')
  }

  const prompt = buildTextFormatPrompt(preset, rawText, existingContext)

  try {
    const text = await callGroq(
      apiKey,
      [{ role: 'user', content: prompt }],
      GENERATION_TIMEOUT_MS,
      'Превышено время ожидания ответа от Groq.'
    )
    return text.trim()
  } catch (err) {
    if (err instanceof AiError) throw err
    throw classifyError(err)
  }
}
