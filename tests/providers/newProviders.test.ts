import { describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from '../../src/main/providers/impl/openaiCompatible'
import {
  CEREBRAS_CONFIG,
  CLOUDFLARE_CONFIG,
  HUGGINGFACE_CONFIG,
  MODAL_CONFIG,
  NVIDIA_CONFIG,
  OPENROUTER_CONFIG,
  parseHuggingFaceModels,
  parseNvidiaModels,
  parseOpenRouterModels,
  rankOpenRouterFree,
  validateModalEndpoint
} from '../../src/main/providers/impl/compatProviders'
import { MistralProvider } from '../../src/main/providers/impl/mistral'
import { CohereProvider } from '../../src/main/providers/impl/cohere'
import { MemorySecretStore } from '../../src/main/providers/secretStore'
import { ProviderError } from '../../src/main/providers/errors'
import type { ApiKeyProviderDeps } from '../../src/main/providers/impl/apiKeyProvider'
import { nextUtcMidnight } from '../../src/main/providers/rateLimits'

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)
const IMAGE = Buffer.from('png-bytes')

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function deps(
  fetchImpl: typeof fetch,
  options: { fields?: Record<string, string>; model?: string; value?: string } = {}
): ApiKeyProviderDeps {
  const secrets = new MemorySecretStore()
  secrets.set('k1', options.value ?? 'secret-key')
  return {
    secrets,
    getKeys: () => [{ id: 'k1', label: 'Key' }],
    getFields: () => options.fields ?? {},
    getModel: () => options.model ?? 'auto',
    integrationEnabled: true,
    fetchImpl,
    now: () => NOW
  }
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
function fetchOf(handler: Handler) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {})) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}
const bodyOf = (init: RequestInit): Record<string, unknown> => JSON.parse(String(init.body))
const headerOf = (init: RequestInit, name: string): string | undefined =>
  Object.entries((init.headers ?? {}) as Record<string, string>).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]

const completion = (text: string, extra: Record<string, unknown> = {}) => ({
  choices: [{ message: { content: text } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  ...extra
})
const VISION_REQUEST = { operation: 'OCR_VISION' as const, prompt: 'p', image: IMAGE, mimeType: 'image/png' as const }
const TEXT_REQUEST = { operation: 'OCR_CLEANUP' as const, prompt: 'fix this' }

// --------------------------------------------------------------------------------------------
describe('OpenRouter', () => {
  const catalog = {
    data: [
      { id: 'a/paid-vision', name: 'Paid Vision', pricing: { prompt: '0.000001', completion: '0.000002' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
      { id: 'b/free-text:free', name: 'Free Text', pricing: { prompt: '0', completion: '0' }, context_length: 32000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['response_format'] },
      { id: 'c/free-vision:free', name: 'Free Vision', pricing: { prompt: '0', completion: '0' }, context_length: 128000, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
      { id: 'd/free-big-vision:free', name: 'Free Big Vision', pricing: { prompt: '0', completion: '0' }, context_length: 256000, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
      { id: 'e/music', name: 'Music', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['audio'] } },
      { id: 'openrouter/free', name: 'Free Models Router', pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }
    ]
  }

  it('detects FREE vs PAID and vision from the catalog, and drops non-chat models', () => {
    const models = parseOpenRouterModels(catalog)
    expect(models.find((m) => m.id === 'a/paid-vision')).toMatchObject({ free: false, vision: true })
    expect(models.find((m) => m.id === 'b/free-text:free')).toMatchObject({ free: true, vision: false, structured: true })
    expect(models.some((m) => m.id === 'e/music')).toBe(false)
    expect(models.slice(0, 4).every((m) => m.free)).toBe(true) // free first
  })

  it('Automatic Free: images only go to free models with image input, text gets the router as a safety net', () => {
    const models = parseOpenRouterModels(catalog)
    expect(rankOpenRouterFree(models, true, true)).toEqual(['d/free-big-vision:free', 'c/free-vision:free'])
    const text = rankOpenRouterFree(models, false, true)
    expect(text[0]).toBe('b/free-text:free') // structured output first
    expect(text[text.length - 1]).toBe('openrouter/free')
  })

  it('never picks anonymous "stealth/" preview models automatically', () => {
    const models = parseOpenRouterModels({
      data: [
        { id: 'stealth/space-bunny', name: 'x', pricing: { prompt: '0', completion: '0' }, context_length: 999999, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
        { id: 'c/free-vision:free', name: 'y', pricing: { prompt: '0', completion: '0' }, context_length: 1000, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }
      ]
    })
    expect(rankOpenRouterFree(models, true, false)).toEqual(['c/free-vision:free'])
    expect(rankOpenRouterFree(models, false, false)).not.toContain('stealth/space-bunny')
  })

  it('has no vision route when the catalog lists no free vision model (→ Tesseract → text)', async () => {
    const onlyText = parseOpenRouterModels({ data: [catalog.data[1]] })
    expect(rankOpenRouterFree(onlyText, true, false)).toEqual([])
    const fetchImpl = fetchOf(() => json(200, { data: [catalog.data[1]] }))
    const provider = new OpenAICompatibleProvider(OPENROUTER_CONFIG, deps(fetchImpl))
    await provider.getAvailableModels({ refresh: true })
    expect(await provider.canServeVision()).toBe(false)
  })

  it('sends a fallback list of free models and the screenshot as an image_url', async () => {
    const fetchImpl = fetchOf((url, init) => {
      if (url.endsWith('/models')) return json(200, catalog)
      const body = bodyOf(init)
      expect(body.model).toBe('d/free-big-vision:free')
      expect(body.models).toEqual(['d/free-big-vision:free', 'c/free-vision:free'])
      const content = (body.messages as { content: unknown }[])[0].content as { type: string; image_url?: { url: string } }[]
      expect(content[1].image_url?.url.startsWith('data:image/png;base64,')).toBe(true)
      expect(headerOf(init, 'authorization')).toBe('Bearer secret-key')
      return json(200, completion('{"blocks":[]}', { model: 'c/free-vision:free' }))
    })
    const provider = new OpenAICompatibleProvider(OPENROUTER_CONFIG, deps(fetchImpl))
    const result = await provider.runStructuredOutput(VISION_REQUEST)
    expect(result.text).toBe('{"blocks":[]}')
    expect(result.model).toBe('c/free-vision:free') // the model OpenRouter actually used
  })

  it('daily free-model limit → PLAN_LIMIT with the provider-reported reset; per-minute → RATE_LIMIT', async () => {
    const reset = NOW + 5 * 3_600_000
    const daily = fetchOf((url) =>
      url.endsWith('/models') ? json(200, catalog) : json(429, { error: { message: 'Rate limit exceeded: free-models-per-day' } }, { 'x-ratelimit-reset': String(reset) })
    )
    const error = await new OpenAICompatibleProvider(OPENROUTER_CONFIG, deps(daily)).runText(TEXT_REQUEST).catch((e) => e)
    expect(error).toMatchObject({ code: 'PLAN_LIMIT', resetAt: reset, canFallback: true })
    const perMinute = fetchOf((url) => (url.endsWith('/models') ? json(200, catalog) : json(429, { error: { message: 'Rate limit exceeded' } }, { 'retry-after': '12' })))
    expect(await new OpenAICompatibleProvider(OPENROUTER_CONFIG, deps(perMinute)).runText(TEXT_REQUEST).catch((e) => e)).toMatchObject({ code: 'RATE_LIMIT', retryAfter: 12 })
  })

  it('402 → INSUFFICIENT_CREDITS, 401 → AUTH', async () => {
    const make = (status: number) => fetchOf((url) => (url.endsWith('/models') ? json(200, catalog) : json(status, { error: { message: 'no' } })))
    expect(await new OpenAICompatibleProvider(OPENROUTER_CONFIG, deps(make(402))).runText(TEXT_REQUEST).catch((e) => e.code)).toBe('INSUFFICIENT_CREDITS')
    expect(await new OpenAICompatibleProvider(OPENROUTER_CONFIG, deps(make(401))).runText(TEXT_REQUEST).catch((e) => e.code)).toBe('AUTH')
  })

  it('"Test connection" verifies the key against /key, because /models is public', async () => {
    const rejected = fetchOf((url) => (url.endsWith('/key') ? json(401, { error: { message: 'No auth' } }) : json(200, catalog)))
    const bad = await new OpenAICompatibleProvider(OPENROUTER_CONFIG, deps(rejected)).healthCheck()
    expect(bad).toMatchObject({ ok: false, errorCode: 'AUTH' })
    const ok = fetchOf((url) => (url.endsWith('/key') ? json(200, { data: { limit_remaining: 4.5 } }) : json(200, catalog)))
    const good = await new OpenAICompatibleProvider(OPENROUTER_CONFIG, deps(ok)).healthCheck()
    expect(good.ok).toBe(true)
    expect(good.message).toContain('бесплатных')
  })

  it('reads credits and the free-model daily budget from /key (provider-reported only)', async () => {
    const fetchImpl = fetchOf(() =>
      json(200, { data: { limit_remaining: 3.25, is_free_tier: false, free_model_daily_requests: { limit: 1000, remaining: 940, used: 60 } } })
    )
    const usage = await new OpenAICompatibleProvider(OPENROUTER_CONFIG, deps(fetchImpl)).getUsage()
    expect(usage?.credits).toEqual({ balance: 3.25, currency: 'USD', accuracy: 'provider_reported' })
    expect(usage?.windows?.[0]).toMatchObject({ limit: 1000, remaining: 940, accuracy: 'provider_reported' })
  })

  it('shows nothing (no invented numbers) when /key has no usage fields', async () => {
    const fetchImpl = fetchOf(() => json(200, { data: { label: 'x' } }))
    expect(await new OpenAICompatibleProvider(OPENROUTER_CONFIG, deps(fetchImpl)).getUsage()).toBeNull()
  })
})

// --------------------------------------------------------------------------------------------
describe('JSON mode fallback', () => {
  it('retries once without response_format when the model has no JSON mode', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchImpl = fetchOf((url, init) => {
      if (url.endsWith('/models')) return json(200, { data: [{ id: 'llama3.1-8b' }] })
      bodies.push(bodyOf(init))
      return bodies.length === 1 ? json(400, { error: { message: 'response_format json_object is not supported for this model' } }) : json(200, completion('{"blocks":[]}'))
    })
    const result = await new OpenAICompatibleProvider(CEREBRAS_CONFIG, deps(fetchImpl)).runStructuredOutput(TEXT_REQUEST)
    expect(result.text).toBe('{"blocks":[]}')
    expect(bodies[0].response_format).toEqual({ type: 'json_object' })
    expect(bodies[1].response_format).toBeUndefined()
  })
})

// --------------------------------------------------------------------------------------------
describe('Cerebras', () => {
  const models = { data: [{ id: 'llama3.1-8b' }, { id: 'gpt-oss-120b' }] }

  it('is a text provider: never offered a screenshot', async () => {
    const provider = new OpenAICompatibleProvider(CEREBRAS_CONFIG, deps(fetchOf(() => json(200, models))))
    expect(provider.getCapabilities()).toMatchObject({ vision: false, text: true, ocrCleanup: true, structuredOutput: true })
    expect(await provider.canServeVision()).toBe(false)
  })

  it('reads x-ratelimit-*-day / -minute headers (seconds until reset)', async () => {
    const fetchImpl = fetchOf((url, init) => {
      if (url.endsWith('/models')) return json(200, models)
      expect(bodyOf(init).max_completion_tokens).toBeDefined()
      return json(200, completion('ok'), {
        'x-ratelimit-limit-requests-day': '14400',
        'x-ratelimit-remaining-requests-day': '14000',
        'x-ratelimit-reset-requests-day': '3600',
        'x-ratelimit-limit-tokens-minute': '60000',
        'x-ratelimit-remaining-tokens-minute': '59000',
        'x-ratelimit-reset-tokens-minute': '30'
      })
    })
    const result = await new OpenAICompatibleProvider(CEREBRAS_CONFIG, deps(fetchImpl)).runText(TEXT_REQUEST)
    const day = result.rateLimits?.find((w) => w.id === 'requests-day')
    expect(day).toMatchObject({ limit: 14400, remaining: 14000, resetAt: NOW + 3_600_000, accuracy: 'provider_reported' })
    expect(result.rateLimits?.find((w) => w.id === 'tokens-minute')?.remaining).toBe(59000)
  })

  it('429 with an exhausted daily window → PLAN_LIMIT with that reset', async () => {
    const fetchImpl = fetchOf((url) =>
      url.endsWith('/models')
        ? json(200, models)
        : json(429, { message: 'Too many requests' }, { 'x-ratelimit-remaining-requests-day': '0', 'x-ratelimit-limit-requests-day': '100', 'x-ratelimit-reset-requests-day': '7200' })
    )
    const error = await new OpenAICompatibleProvider(CEREBRAS_CONFIG, deps(fetchImpl)).runText(TEXT_REQUEST).catch((e) => e)
    expect(error).toMatchObject({ code: 'PLAN_LIMIT', resetAt: NOW + 7_200_000 })
  })
})

// --------------------------------------------------------------------------------------------
describe('NVIDIA NIM', () => {
  const catalog = {
    data: [
      { id: 'meta/llama-3.3-70b-instruct' },
      { id: 'meta/llama-3.2-11b-vision-instruct' },
      { id: 'nvidia/nv-embedqa-e5-v5' },
      { id: 'nvidia/nemoguard-8b-content-safety' }
    ]
  }

  it('filters non-chat models and flags VLMs', () => {
    const models = parseNvidiaModels(catalog)
    expect(models.map((m) => m.id)).toEqual(['meta/llama-3.2-11b-vision-instruct', 'meta/llama-3.3-70b-instruct'])
    expect(models.find((m) => m.id.includes('vision'))?.vision).toBe(true)
    expect(models.find((m) => m.id.includes('3.3-70b'))?.vision).toBe(false)
  })

  it('declines screenshots over the documented 180 KB inline limit before any request', async () => {
    const fetchImpl = fetchOf(() => json(200, catalog))
    const provider = new OpenAICompatibleProvider(NVIDIA_CONFIG, deps(fetchImpl))
    await provider.getAvailableModels({ refresh: true })
    expect(await provider.canServeVision(50_000)).toBe(true)
    expect(await provider.canServeVision(200_000)).toBe(false)
    const error = await provider.runVision({ ...VISION_REQUEST, image: Buffer.alloc(200_000) }).catch((e) => e)
    expect(error).toMatchObject({ code: 'UNSUPPORTED' })
  })

  it('"Test connection" makes one real request, because the catalog is public', async () => {
    const calls: string[] = []
    const fetchImpl = fetchOf((url) => {
      calls.push(url)
      if (url.endsWith('/models')) return json(200, catalog)
      return json(401, { detail: 'Authentication failed' })
    })
    const result = await new OpenAICompatibleProvider(NVIDIA_CONFIG, deps(fetchImpl)).healthCheck()
    expect(result).toMatchObject({ ok: false, errorCode: 'AUTH' })
    expect(calls.some((u) => u.endsWith('/chat/completions'))).toBe(true)
  })
})

// --------------------------------------------------------------------------------------------
describe('Hugging Face', () => {
  it('reads input modalities and ranks models with structured output first', () => {
    const models = parseHuggingFaceModels({
      data: [
        { id: 'a/text', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, providers: [{ provider: 'p', status: 'live', throughput: 90 }] },
        { id: 'b/vlm', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, providers: [{ provider: 'p', status: 'live', supports_structured_output: true, context_length: 1000 }] },
        { id: 'c/dead', architecture: { input_modalities: ['text'], output_modalities: ['text'] }, providers: [{ provider: 'p', status: 'error' }] }
      ]
    })
    expect(models.map((m) => m.id)).toEqual(['b/vlm', 'a/text'])
    expect(models[0]).toMatchObject({ vision: true, structured: true, contextLength: 1000 })
  })

  it('checks the token against whoami-v2 (the catalog is public)', async () => {
    const fetchImpl = fetchOf((url) => (url.includes('whoami-v2') ? json(401, { error: 'Invalid credentials' }) : json(200, { data: [] })))
    expect(await new OpenAICompatibleProvider(HUGGINGFACE_CONFIG, deps(fetchImpl)).healthCheck()).toMatchObject({ ok: false, errorCode: 'AUTH' })
  })

  it('never shows a made-up balance: only an honest note', async () => {
    const usage = await new OpenAICompatibleProvider(HUGGINGFACE_CONFIG, deps(fetchOf(() => json(200, { data: [] })))).getUsage()
    expect(usage?.windows).toEqual([])
    expect(usage?.credits).toBeUndefined()
    expect(usage?.note).toContain('недоступен')
  })
})

// --------------------------------------------------------------------------------------------
describe('Cloudflare Workers AI', () => {
  const FIELDS = { accountId: 'acc123' }
  const models = {
    result: [
      { name: '@cf/meta/llama-3.1-8b-instruct' },
      { name: '@cf/google/gemma-3-12b-it' },
      { name: '@cf/baai/bge-m3' }
    ],
    success: true
  }

  it('is unavailable until the Account ID is saved', async () => {
    const provider = new OpenAICompatibleProvider(CLOUDFLARE_CONFIG, deps(fetchOf(() => json(200, models))))
    expect(await provider.isAvailable()).toBe(false)
    expect((await provider.getConnectionInfo()).fields).toEqual([{ id: 'accountId', set: false }])
    expect((await provider.healthCheck()).ok).toBe(false)
  })

  it('builds account-scoped URLs, finds vision models, uses text model for text', async () => {
    const urls: string[] = []
    const fetchImpl = fetchOf((url, init) => {
      urls.push(url)
      if (url.includes('/models/search')) return json(200, models)
      return json(200, completion(String(bodyOf(init).model)))
    })
    const provider = new OpenAICompatibleProvider(CLOUDFLARE_CONFIG, deps(fetchImpl, { fields: FIELDS }))
    expect((await provider.healthCheck()).ok).toBe(true)
    expect(urls[0]).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/ai/models/search?task=Text%20Generation&per_page=100')
    expect((await provider.runText(TEXT_REQUEST)).text).toBe('@cf/meta/llama-3.1-8b-instruct')
    expect((await provider.runVision(VISION_REQUEST)).text).toBe('@cf/google/gemma-3-12b-it')
    expect(urls.filter((u) => u.includes('/chat/completions')).every((u) => u === 'https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1/chat/completions')).toBe(true)
  })

  it('free allocation is shown as a documented fact — no remaining, no percentage', async () => {
    const provider = new OpenAICompatibleProvider(CLOUDFLARE_CONFIG, deps(fetchOf(() => json(200, models)), { fields: FIELDS }))
    const usage = await provider.getUsage()
    expect(usage?.windows).toEqual([])
    expect(usage?.allocation).toMatchObject({ label: expect.stringContaining('10 000'), resetAt: nextUtcMidnight(NOW) })
    expect(usage?.credits).toBeUndefined()
  })

  it('exhausted allocation → PLAN_LIMIT resetting at 00:00 UTC (documented rule, flagged as estimate)', async () => {
    const fetchImpl = fetchOf((url) =>
      url.includes('/models/search')
        ? json(200, models)
        : json(429, { errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }], success: false })
    )
    const error = await new OpenAICompatibleProvider(CLOUDFLARE_CONFIG, deps(fetchImpl, { fields: FIELDS })).runText(TEXT_REQUEST).catch((e) => e)
    expect(error).toMatchObject({ code: 'PLAN_LIMIT', resetAt: nextUtcMidnight(NOW), resetIsEstimate: true })
  })

  it('a rejected token / wrong account → AUTH with a helpful message', async () => {
    const fetchImpl = fetchOf(() => json(403, { errors: [{ code: 10000, message: 'Authentication error' }], success: false }))
    const result = await new OpenAICompatibleProvider(CLOUDFLARE_CONFIG, deps(fetchImpl, { fields: FIELDS })).healthCheck()
    expect(result).toMatchObject({ ok: false, errorCode: 'AUTH' })
    expect(result.message).toContain('Account ID')
  })
})

// --------------------------------------------------------------------------------------------
describe('Modal OCR endpoint', () => {
  const FIELDS = { tokenId: 'wk-id', endpoint: 'https://ws--snap-notes-ocr-serve.modal.run/' }

  it('sends Modal proxy-auth headers, its own OCR prompt, and marks the result as Markdown', async () => {
    const fetchImpl = fetchOf((url, init) => {
      if (url.endsWith('/v1/models')) return json(200, { data: [{ id: 'dots-studio/dots.ocr' }] })
      expect(url).toBe('https://ws--snap-notes-ocr-serve.modal.run/v1/chat/completions')
      expect(headerOf(init, 'Modal-Key')).toBe('wk-id')
      expect(headerOf(init, 'Modal-Secret')).toBe('ws-secret')
      const body = bodyOf(init)
      expect(body.response_format).toBeUndefined()
      const content = (body.messages as { content: { type: string; text?: string }[] }[])[0].content
      expect(content[0].text).toContain('Extract all text')
      expect(content[0].text).not.toBe('p')
      return json(200, completion('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |'))
    })
    const provider = new OpenAICompatibleProvider(MODAL_CONFIG, deps(fetchImpl, { fields: FIELDS, value: 'ws-secret' }))
    const result = await provider.runStructuredOutput(VISION_REQUEST)
    expect(result.format).toBe('markdown')
    expect(result.model).toBe('dots-studio/dots.ocr')
  })

  it('is an OCR engine: no text requests, vision only', async () => {
    const provider = new OpenAICompatibleProvider(MODAL_CONFIG, deps(fetchOf(() => json(200, { data: [{ id: 'm' }] })), { fields: FIELDS }))
    expect(provider.getCapabilities()).toMatchObject({ vision: true, ocr: true, text: false })
    expect(await provider.runText(TEXT_REQUEST).catch((e) => e.code)).toBe('UNSUPPORTED')
  })

  it('needs token ID and endpoint; endpoint must be https', async () => {
    const provider = new OpenAICompatibleProvider(MODAL_CONFIG, deps(fetchOf(() => json(200, {})), { fields: { tokenId: 'wk' } }))
    expect(await provider.isAvailable()).toBe(false)
    expect(validateModalEndpoint('http://x.modal.run')).toContain('https')
    expect(validateModalEndpoint('not a url')).not.toBeNull()
    expect(validateModalEndpoint('https://ws--app.modal.run')).toBeNull()
  })

  it('an app that is not deployed (modal.run answers 404) is reported as an unreachable endpoint', async () => {
    const fetchImpl = fetchOf(() => json(404, { detail: 'app not found' }))
    const result = await new OpenAICompatibleProvider(MODAL_CONFIG, deps(fetchImpl, { fields: FIELDS })).healthCheck()
    expect(result).toMatchObject({ ok: false, errorCode: 'PROVIDER_DOWN' })
    expect(result.message).toContain('modal deploy')
  })

  it('follows the Modal 303 redirect for long requests; other providers refuse redirects', async () => {
    const seen: (RequestRedirect | undefined)[] = []
    const fetchImpl = fetchOf((url, init) => {
      seen.push(init.redirect)
      return json(200, url.endsWith('/models') ? { data: [{ id: 'm' }] } : completion('ok'))
    })
    await new OpenAICompatibleProvider(MODAL_CONFIG, deps(fetchImpl, { fields: FIELDS })).runVision(VISION_REQUEST)
    expect(seen.every((r) => r === 'follow')).toBe(true)
    seen.length = 0
    await new OpenAICompatibleProvider(CEREBRAS_CONFIG, deps(fetchImpl)).runText(TEXT_REQUEST)
    expect(seen.every((r) => r === 'error')).toBe(true)
  })

  it('401 → AUTH', async () => {
    const fetchImpl = fetchOf(() => json(401, { detail: 'Unauthorized' }))
    expect(await new OpenAICompatibleProvider(MODAL_CONFIG, deps(fetchImpl, { fields: FIELDS })).healthCheck()).toMatchObject({ ok: false, errorCode: 'AUTH' })
  })
})

// --------------------------------------------------------------------------------------------
describe('Mistral', () => {
  const catalog = {
    data: [
      { id: 'mistral-small-latest', capabilities: { completion_chat: true, vision: true } },
      { id: 'mistral-ocr-latest', capabilities: { completion_chat: false, ocr: true } },
      { id: 'mistral-embed', capabilities: { completion_chat: false } },
      { id: 'codestral-latest', capabilities: { completion_chat: true } }
    ]
  }

  it('uses the official OCR endpoint for screenshots and returns Markdown', async () => {
    const fetchImpl = fetchOf((url, init) => {
      if (url.endsWith('/models')) return json(200, catalog)
      expect(url).toBe('https://api.mistral.ai/v1/ocr')
      const body = bodyOf(init)
      expect(body.model).toBe('mistral-ocr-latest')
      expect((body.document as { type: string; image_url: string }).type).toBe('image_url')
      expect((body.document as { image_url: string }).image_url.startsWith('data:image/png;base64,')).toBe(true)
      return json(200, { pages: [{ index: 0, markdown: '# Hi' }, { index: 1, markdown: 'text' }], model: 'mistral-ocr-latest' }, { 'x-ratelimit-limit-requests': '60', 'x-ratelimit-remaining-requests': '55' })
    })
    const result = await new MistralProvider(deps(fetchImpl)).runStructuredOutput(VISION_REQUEST)
    expect(result).toMatchObject({ text: '# Hi\n\ntext', format: 'markdown', model: 'mistral-ocr-latest' })
    expect(result.rateLimits?.[0]).toMatchObject({ limit: 60, remaining: 55 })
  })

  it('text requests use chat completions with a chat model (not OCR, not embeddings)', async () => {
    const fetchImpl = fetchOf((url, init) => {
      if (url.endsWith('/models')) return json(200, catalog)
      expect(url).toBe('https://api.mistral.ai/v1/chat/completions')
      expect(bodyOf(init).model).toBe('mistral-small-latest')
      return json(200, completion('{"blocks":[]}'))
    })
    expect((await new MistralProvider(deps(fetchImpl)).runStructuredOutput(TEXT_REQUEST)).text).toBe('{"blocks":[]}')
  })

  it('OCR unavailable on the plan → MODEL_UNAVAILABLE, vision skipped afterwards, text still works', async () => {
    const fetchImpl = fetchOf((url) => {
      if (url.endsWith('/models')) return json(200, catalog)
      if (url.endsWith('/ocr')) return json(403, { message: 'forbidden' })
      return json(200, completion('ok'))
    })
    const provider = new MistralProvider(deps(fetchImpl))
    expect(await provider.runVision(VISION_REQUEST).catch((e) => e.code)).toBe('MODEL_UNAVAILABLE')
    expect(await provider.canServeVision()).toBe(false)
    expect((await provider.runText(TEXT_REQUEST)).text).toBe('ok')
  })

  it('invalid key → AUTH; 429 → RATE_LIMIT', async () => {
    const make = (status: number, headers: Record<string, string> = {}) => fetchOf((url) => (url.endsWith('/models') ? json(200, catalog) : json(status, { message: 'x' }, headers)))
    expect(await new MistralProvider(deps(make(401))).runVision(VISION_REQUEST).catch((e) => e.code)).toBe('AUTH')
    expect(await new MistralProvider(deps(make(429, { 'retry-after': '3' }))).runVision(VISION_REQUEST).catch((e) => e)).toMatchObject({ code: 'RATE_LIMIT', retryAfter: 3 })
  })
})

// --------------------------------------------------------------------------------------------
describe('Cohere', () => {
  const catalog = {
    models: [
      { name: 'command-a-03-2025', endpoints: ['chat'], context_length: 256000, features: ['json_mode'] },
      { name: 'command-a-vision-07-2025', endpoints: ['chat'], features: [] },
      { name: 'embed-v4.0', endpoints: ['embed'] }
    ]
  }

  it('is a text provider: picks a non-vision command model, speaks v2 chat', async () => {
    const fetchImpl = fetchOf((url, init) => {
      if (url.includes('/v1/models')) return json(200, catalog)
      expect(url).toBe('https://api.cohere.com/v2/chat')
      const body = bodyOf(init)
      expect(body.model).toBe('command-a-03-2025')
      expect(body.response_format).toEqual({ type: 'json_object' })
      return json(200, { message: { content: [{ type: 'text', text: '{"blocks":[]}' }] }, usage: { tokens: { input_tokens: 12, output_tokens: 3 } } }, {
        'x-trial-endpoint-call-limit': '1000',
        'x-trial-endpoint-call-remaining': '940'
      })
    })
    const result = await new CohereProvider(deps(fetchImpl)).runStructuredOutput(TEXT_REQUEST)
    expect(result.text).toBe('{"blocks":[]}')
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 })
    expect(result.rateLimits?.[0]).toMatchObject({ limit: 1000, remaining: 940, accuracy: 'provider_reported' })
  })

  it('images only to models whose catalog says they accept images', async () => {
    const withVision = new CohereProvider(deps(fetchOf(() => json(200, catalog))))
    await withVision.getAvailableModels({ refresh: true })
    expect(await withVision.canServeVision()).toBe(true)
    const textOnly = new CohereProvider(deps(fetchOf(() => json(200, { models: [catalog.models[0]] }))))
    await textOnly.getAvailableModels({ refresh: true })
    expect(await textOnly.canServeVision()).toBe(false)
  })

  it('Trial monthly limit → PLAN_LIMIT without an invented reset; per-minute → RATE_LIMIT', async () => {
    const make = (message: string) => fetchOf((url) => (url.includes('/v1/models') ? json(200, catalog) : json(429, { message })))
    const monthly = await new CohereProvider(deps(make('You are using a Trial key, which is limited to 1000 API calls / month'))).runText(TEXT_REQUEST).catch((e) => e)
    expect(monthly).toMatchObject({ code: 'PLAN_LIMIT' })
    expect(monthly.resetAt).toBeUndefined()
    expect(await new CohereProvider(deps(make('too many requests'))).runText(TEXT_REQUEST).catch((e) => e.code)).toBe('RATE_LIMIT')
  })

  it('invalid key → AUTH on test connection', async () => {
    const fetchImpl = fetchOf(() => json(401, { message: 'invalid api token' }))
    expect(await new CohereProvider(deps(fetchImpl)).healthCheck()).toMatchObject({ ok: false, errorCode: 'AUTH' })
  })
})

// --------------------------------------------------------------------------------------------
describe('provider errors and offline behaviour', () => {
  it('offline (fetch fails) → NETWORK, which lets the router fall back', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    }) as unknown as typeof fetch
    const error = await new OpenAICompatibleProvider(CEREBRAS_CONFIG, deps(fetchImpl)).runText(TEXT_REQUEST).catch((e) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ code: 'NETWORK', canFallback: true })
  })

  it('an upstream error wrapped in HTTP 200 is an error, not an empty answer', async () => {
    const fetchImpl = fetchOf((url) => (url.endsWith('/models') ? json(200, { data: [{ id: 'm:free', pricing: { prompt: '0', completion: '0' } }] }) : json(200, { error: { message: 'Provider returned error', code: 502 } })))
    const error = await new OpenAICompatibleProvider(OPENROUTER_CONFIG, deps(fetchImpl)).runText(TEXT_REQUEST).catch((e) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error.code).toBe('PROVIDER_DOWN')
  })

  it('an empty completion is INVALID_RESPONSE', async () => {
    const fetchImpl = fetchOf((url) => (url.endsWith('/models') ? json(200, { data: [{ id: 'm' }] }) : json(200, { choices: [{ message: { content: null } }] })))
    expect(await new OpenAICompatibleProvider(CEREBRAS_CONFIG, deps(fetchImpl)).runText(TEXT_REQUEST).catch((e) => e.code)).toBe('INVALID_RESPONSE')
  })
})
