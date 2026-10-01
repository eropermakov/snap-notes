import { describe, expect, it, vi } from 'vitest'
import { OpenAiApiProvider } from '../../src/main/providers/impl/openaiApi'
import { GroqProvider } from '../../src/main/providers/impl/groq'
import { AnthropicApiProvider } from '../../src/main/providers/impl/anthropicApi'
import { GeminiProvider, type GeminiClientLike } from '../../src/main/providers/impl/gemini'
import { MemorySecretStore } from '../../src/main/providers/secretStore'
import { ProviderError } from '../../src/main/providers/errors'
import type { ApiKeyProviderDeps } from '../../src/main/providers/impl/apiKeyProvider'

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0)
const IMAGE = Buffer.from('png-bytes')

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function deps(fetchImpl: typeof fetch, keys = [{ id: 'k1', label: 'Key 1' }], values: Record<string, string> = { k1: 'sk-1' }): ApiKeyProviderDeps {
  const secrets = new MemorySecretStore()
  for (const [id, value] of Object.entries(values)) secrets.set(id, value)
  return { secrets, getKeys: () => keys, getModel: () => 'auto', integrationEnabled: true, fetchImpl, now: () => NOW }
}

/** Routes by URL: /models always answers with a small catalog; everything else goes to `handler`. */
function router(handler: (url: string, init: RequestInit) => Response, models: unknown = { data: [{ id: 'gpt-6-luna' }] }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/models')) return json(200, models)
    return handler(url, init ?? {})
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe('OpenAI API provider', () => {
  it('sends the image via the Responses API and returns rate-limit windows from headers', async () => {
    const fetchImpl = router((_url, init) => {
      const body = JSON.parse(String(init.body))
      expect(body.store).toBe(false)
      expect(body.input[0].content[1]).toMatchObject({ type: 'input_image' })
      expect(body.input[0].content[1].image_url.startsWith('data:image/png;base64,')).toBe(true)
      expect(body.text.format.type).toBe('json_object')
      return json(
        200,
        {
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: '{"blocks":[]}' }] }],
          usage: { input_tokens: 900, output_tokens: 12, total_tokens: 912 }
        },
        {
          'x-ratelimit-limit-requests': '60',
          'x-ratelimit-remaining-requests': '59',
          'x-ratelimit-reset-requests': '1s',
          'x-ratelimit-limit-tokens': '150000',
          'x-ratelimit-remaining-tokens': '149984',
          'x-ratelimit-reset-tokens': '6m0s'
        }
      )
    })
    const provider = new OpenAiApiProvider(deps(fetchImpl))
    const result = await provider.runStructuredOutput({ operation: 'OCR_VISION', prompt: 'p', image: IMAGE, mimeType: 'image/png' })
    expect(result.text).toBe('{"blocks":[]}')
    expect(result.model).toBe('gpt-6-luna')
    expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 12, totalTokens: 912 })
    expect(result.rateLimits?.find((w) => w.id === 'tokens')).toMatchObject({ limit: 150000, remaining: 149984 })
  })

  it('works when rate-limit headers are missing (no windows, no invented values)', async () => {
    const fetchImpl = router(() =>
      json(200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }] })
    )
    const result = await new OpenAiApiProvider(deps(fetchImpl)).runText({ operation: 'AI_REWRITE', prompt: 'x' })
    expect(result.rateLimits).toEqual([])
  })

  it('429 with retry-after → RATE_LIMIT with retryAfter', async () => {
    const fetchImpl = router(() => json(429, { error: { code: 'rate_limit_exceeded' } }, { 'retry-after': '20' }))
    const error = await new OpenAiApiProvider(deps(fetchImpl)).runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ code: 'RATE_LIMIT', retryAfter: 20, canFallback: true })
  })

  it('insufficient_quota → INSUFFICIENT_CREDITS; invalid_api_key → AUTH', async () => {
    const quota = router(() => json(429, { error: { code: 'insufficient_quota' } }))
    expect(await new OpenAiApiProvider(deps(quota)).runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e.code)).toBe(
      'INSUFFICIENT_CREDITS'
    )
    const auth = router(() => json(401, { error: { code: 'invalid_api_key' } }))
    expect(await new OpenAiApiProvider(deps(auth)).runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e.code)).toBe('AUTH')
  })

  it('model not found → MODEL_UNAVAILABLE (router can fall back)', async () => {
    const fetchImpl = router(() => json(404, { error: { code: 'model_not_found' } }))
    const error = await new OpenAiApiProvider(deps(fetchImpl)).runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e)
    expect(error).toMatchObject({ code: 'MODEL_UNAVAILABLE', canFallback: true })
  })

  it('rotates to the next key when the first key is rate limited', async () => {
    const used: string[] = []
    const fetchImpl = router((_url, init) => {
      const auth = String((init.headers as Record<string, string>).authorization)
      used.push(auth)
      if (auth.endsWith('sk-1')) return json(429, { error: { code: 'rate_limit_exceeded' } }, { 'retry-after': '30' })
      return json(200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] })
    })
    const provider = new OpenAiApiProvider(
      deps(fetchImpl, [{ id: 'k1', label: 'A' }, { id: 'k2', label: 'B' }], { k1: 'sk-1', k2: 'sk-2' })
    )
    const result = await provider.runText({ operation: 'OCR_CLEANUP', prompt: 'x' })
    expect(result.text).toBe('ok')
    expect(used).toEqual(['Bearer sk-1', 'Bearer sk-2'])
  })

  it('network failure → NETWORK', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const error = await new OpenAiApiProvider(deps(fetchImpl)).runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e)
    expect(error.code).toBe('NETWORK')
  })

  it('without keys it is unavailable and fails with AUTH', async () => {
    const provider = new OpenAiApiProvider(deps(router(() => json(200, {})), [], {}))
    expect(await provider.isAvailable()).toBe(false)
    expect(await provider.runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e.code)).toBe('AUTH')
  })
})

describe('Groq provider', () => {
  it('uses a documented vision model, strips <think>, parses RPD/TPM headers', async () => {
    const fetchImpl = router(
      (_url, init) => {
        const body = JSON.parse(String(init.body))
        expect(body.model).toBe('qwen/qwen3.8-27b')
        expect(body.response_format).toEqual({ type: 'json_object' })
        return json(
          200,
          { choices: [{ message: { content: '<think>hmm</think>{"blocks":[]}' } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
          { 'x-ratelimit-limit-requests': '14400', 'x-ratelimit-remaining-requests': '14370', 'x-ratelimit-reset-requests': '2m59.56s' }
        )
      },
      { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'qwen/qwen3.8-27b' }, { id: 'whisper-large-v3' }] }
    )
    const provider = new GroqProvider(deps(fetchImpl))
    const result = await provider.runStructuredOutput({ operation: 'OCR_VISION', prompt: 'p', image: IMAGE, mimeType: 'image/png' })
    expect(result.text).toBe('{"blocks":[]}')
    expect(result.rateLimits?.[0]).toMatchObject({ id: 'requests-day', remaining: 14370 })
    const models = await provider.getAvailableModels()
    expect(models.map((m) => m.id)).toEqual(['qwen/qwen3.8-27b', 'llama-3.3-70b-versatile'])
  })

  it('decommissioned model → MODEL_UNAVAILABLE', async () => {
    const fetchImpl = router(() => json(400, { error: { code: 'model_decommissioned' } }))
    expect(await new GroqProvider(deps(fetchImpl)).runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e.code)).toBe(
      'MODEL_UNAVAILABLE'
    )
  })

  it('an explicitly chosen text-only model cannot serve vision', async () => {
    const d = deps(router(() => json(200, {})))
    const provider = new GroqProvider({ ...d, getModel: () => 'llama-3.3-70b-versatile' })
    expect(await provider.canServeVision()).toBe(false)
  })
})

describe('Anthropic API provider', () => {
  it('sends a base64 image block and parses anthropic-ratelimit headers', async () => {
    const fetchImpl = router(
      (_url, init) => {
        const headers = init.headers as Record<string, string>
        expect(headers['x-api-key']).toBe('sk-1')
        expect(headers['anthropic-version']).toBe('2023-06-01')
        const body = JSON.parse(String(init.body))
        expect(body.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } })
        return json(
          200,
          { content: [{ type: 'text', text: '{"blocks":[]}' }], usage: { input_tokens: 10, output_tokens: 3 } },
          {
            'anthropic-ratelimit-requests-limit': '50',
            'anthropic-ratelimit-requests-remaining': '49',
            'anthropic-ratelimit-requests-reset': '2026-09-30T12:01:00Z'
          }
        )
      },
      { data: [{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }] }
    )
    const result = await new AnthropicApiProvider(deps(fetchImpl)).runVision({
      operation: 'OCR_VISION',
      prompt: 'p',
      image: IMAGE,
      mimeType: 'image/png'
    })
    expect(result.model).toBe('claude-haiku-4-5')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 3, totalTokens: 13 })
    expect(result.rateLimits?.[0]).toMatchObject({ limit: 50, remaining: 49 })
  })

  it('spend cap (enforced_spend_limit_reached, no retry-after) → INSUFFICIENT_CREDITS', async () => {
    const fetchImpl = router(() =>
      json(429, { type: 'error', error: { type: 'rate_limit_error', message: '…', details: { error_code: 'enforced_spend_limit_reached' } } })
    )
    const error = await new AnthropicApiProvider(deps(fetchImpl)).runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e)
    expect(error.code).toBe('INSUFFICIENT_CREDITS')
    expect(error.retryAfter).toBeUndefined()
  })

  it('ordinary 429 keeps retry-after; 529 overloaded → PROVIDER_DOWN', async () => {
    const limited = router(() => json(429, { type: 'error', error: { type: 'rate_limit_error' } }, { 'retry-after': '12' }))
    expect(await new AnthropicApiProvider(deps(limited)).runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => [e.code, e.retryAfter])).toEqual([
      'RATE_LIMIT',
      12
    ])
    const overloaded = router(() => json(529, { type: 'error', error: { type: 'overloaded_error' } }))
    expect(await new AnthropicApiProvider(deps(overloaded)).runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e.code)).toBe(
      'PROVIDER_DOWN'
    )
  })
})

describe('Gemini provider', () => {
  function fakeClient(generate: GeminiClientLike['models']['generateContent']): GeminiClientLike {
    return {
      models: {
        generateContent: generate,
        list: async () =>
          (async function* () {
            yield { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedActions: ['generateContent'] }
            yield { name: 'models/text-embedding-004', supportedActions: ['embedContent'] }
          })()
      }
    }
  }

  it('requests JSON mode and reports token usage (no invented quota)', async () => {
    const generate = vi.fn(async (params: Parameters<GeminiClientLike['models']['generateContent']>[0]) => {
      expect(params.config?.responseMimeType).toBe('application/json')
      return { text: '{"blocks":[]}', usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 } }
    })
    const provider = new GeminiProvider({ ...deps(vi.fn() as unknown as typeof fetch), createClient: () => fakeClient(generate) })
    const result = await provider.runStructuredOutput({ operation: 'OCR_VISION', prompt: 'p', image: IMAGE, mimeType: 'image/png' })
    expect(result.model).toBe('gemini-3.5-flash')
    expect(result.usage?.totalTokens).toBe(7)
    expect(result.rateLimits).toBeUndefined()
    expect((await provider.getAvailableModels()).map((m) => m.id)).toEqual(['gemini-3.5-flash'])
  })

  it('daily quota 429 with retryDelay → PLAN_LIMIT with provider-reported retryAfter', async () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3600s' }
        ]
      }
    })
    const generate = vi.fn(async () => {
      throw Object.assign(new Error(body), { status: 429 })
    })
    const provider = new GeminiProvider({ ...deps(vi.fn() as unknown as typeof fetch), createClient: () => fakeClient(generate) })
    const error = await provider.runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e)
    expect(error).toMatchObject({ code: 'PLAN_LIMIT', retryAfter: 3600, resetIsEstimate: false })
  })

  it('daily quota without retryDelay → documented Pacific-midnight reset, marked as estimate', async () => {
    const body = JSON.stringify({
      error: { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDay-FreeTier' }] }] }
    })
    const generate = vi.fn(async () => {
      throw Object.assign(new Error(body), { status: 429 })
    })
    const provider = new GeminiProvider({ ...deps(vi.fn() as unknown as typeof fetch), createClient: () => fakeClient(generate) })
    const error = await provider.runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e)
    expect(error.code).toBe('PLAN_LIMIT')
    expect(error.resetIsEstimate).toBe(true)
    expect(error.resetAt).toBe(Date.UTC(2026, 9, 1, 7, 0, 0))
  })

  it('invalid key → AUTH', async () => {
    const generate = vi.fn(async () => {
      throw Object.assign(new Error('{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}'), { status: 400 })
    })
    const provider = new GeminiProvider({ ...deps(vi.fn() as unknown as typeof fetch), createClient: () => fakeClient(generate) })
    expect(await provider.runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e.code)).toBe('AUTH')
  })
})
