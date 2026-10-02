/**
 * Configurations for providers that speak the OpenAI Chat Completions protocol. Each object is the
 * whole difference between that provider and the generic client in openaiCompatible.ts.
 *
 * Model knowledge here is *preference*, not truth: model lists come from each provider's catalog
 * endpoint at runtime, patterns only order them for "Automatic", and an empty result simply makes
 * the router use another route (Tesseract → text model). Nothing breaks when a model is retired.
 */
import type { ModelInfo, ProviderCapabilities, ProviderUsage } from '../../../shared/providers'
import { ProviderError } from '../errors'
import { getHeader, nextUtcMidnight, parseCerebrasRateLimits, parseOpenRouterKey, parseRetryAfter } from '../rateLimits'
import { API_CAPABILITIES, type HttpResponse } from './apiKeyProvider'
import { errorMessage, pickPreferred, type CompatContext, type OpenAICompatConfig } from './openaiCompatible'

const TEXT_ONLY: ProviderCapabilities = { ...API_CAPABILITIES, vision: false }
const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** Plain OpenAI-style listing: { data: [{ id }] }. */
function parseOpenAiList(body: unknown): ModelInfo[] {
  return asList(asObject(body).data)
    .map((m) => asObject(m).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => ({ id, displayName: id }))
}

// ---------------------------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------------------------
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const OPENROUTER_NOT_CHAT = /embed|guard|safety|moderation|lyria|tts|whisper|audio|rerank/i

export function parseOpenRouterModels(body: unknown): ModelInfo[] {
  const models: ModelInfo[] = []
  for (const raw of asList(asObject(body).data)) {
    const m = asObject(raw)
    if (typeof m.id !== 'string' || !m.id) continue
    const arch = asObject(m.architecture)
    const inputs = asList(arch.input_modalities)
    const outputs = asList(arch.output_modalities)
    // A chat model must be able to answer in text.
    if (outputs.length > 0 && !outputs.includes('text')) continue
    if (OPENROUTER_NOT_CHAT.test(m.id)) continue
    const pricing = asObject(m.pricing)
    const free = pricing.prompt !== undefined && Number(pricing.prompt) === 0 && Number(pricing.completion) === 0
    const params = asList(m.supported_parameters)
    models.push({
      id: m.id,
      displayName: typeof m.name === 'string' && m.name ? m.name : m.id,
      free,
      ...(inputs.length ? { vision: inputs.includes('image') } : {}),
      ...(typeof m.context_length === 'number' ? { contextLength: m.context_length } : {}),
      ...(params.length ? { structured: params.includes('response_format') || params.includes('structured_outputs') } : {})
    })
  }
  // Free first, then the rest alphabetically.
  return models.sort((a, b) => Number(b.free === true) - Number(a.free === true) || a.displayName.localeCompare(b.displayName))
}

/** Free models able to do the task, best first: structured output, then the larger context. */
export function rankOpenRouterFree(models: ModelInfo[] | null, vision: boolean, json: boolean): string[] {
  // The catalog is unknown (offline start): let OpenRouter's own free router choose a capable model.
  if (!models || models.length === 0) return vision ? [] : ['openrouter/free']
  // "stealth/" models are anonymous pre-release models whose providers log prompts: never chosen automatically.
  const pool = models.filter((m) => m.free === true && m.id !== 'openrouter/free' && !m.id.startsWith('stealth/') && (!vision || m.vision === true))
  const ranked = pool
    .sort(
      (a, b) =>
        (json ? Number(b.structured === true) - Number(a.structured === true) : 0) ||
        (b.contextLength ?? 0) - (a.contextLength ?? 0) ||
        a.id.localeCompare(b.id)
    )
    .map((m) => m.id)
  // For text the router is a safety net after the explicit candidates; for images it is not used,
  // because an image may only go to a model that is known to accept it.
  return vision ? ranked : [...ranked, 'openrouter/free']
}

function openRouterError(response: HttpResponse, now: number): ProviderError | null {
  if (response.status !== 429) return null
  const message = errorMessage(response.body)
  const retryAfter = parseRetryAfter(getHeader(response.headers, 'retry-after'), now)
  const resetHeader = Number(getHeader(response.headers, 'x-ratelimit-reset'))
  // X-RateLimit-Reset is an epoch timestamp in milliseconds.
  const resetAt = Number.isFinite(resetHeader) && resetHeader > 1e12 ? resetHeader : undefined
  const daily = /per-day|per day|daily/i.test(message)
  return new ProviderError('openrouter', daily ? 'PLAN_LIMIT' : 'RATE_LIMIT', {
    status: 429,
    ...(daily ? { message: 'Дневной лимит бесплатных моделей OpenRouter исчерпан.' } : {}),
    ...(retryAfter !== undefined ? { retryAfter } : resetAt ? { resetAt } : {})
  })
}

export const OPENROUTER_CONFIG: OpenAICompatConfig = {
  id: 'openrouter',
  name: 'OpenRouter',
  baseUrl: OPENROUTER_BASE,
  headers: (apiKey) => ({ authorization: `Bearer ${apiKey}`, 'x-title': 'Snap Notes' }),
  capabilities: API_CAPABILITIES,
  modelDiscovery: { parse: parseOpenRouterModels },
  timeoutMs: 60_000,
  // 'auto' = Automatic Free. A specific choice (free or paid) is used as given.
  autoModels: rankOpenRouterFree,
  modelVision: () => undefined,
  extraBody: (_model, ranked) => (ranked.length > 1 ? { models: ranked.slice(0, 3) } : {}),
  mapError: openRouterError,
  // The listing is public, so credentials are verified against the key endpoint.
  authCheck: async (ctx) => {
    const response = await ctx.http(`${OPENROUTER_BASE}/key`, {})
    if (response.status !== 200) {
      throw new ProviderError('openrouter', response.status === 401 || response.status === 403 ? 'AUTH' : 'UNKNOWN', { status: response.status })
    }
  },
  fetchUsage: async (ctx): Promise<Partial<ProviderUsage> | null> => {
    const response = await ctx.http(`${OPENROUTER_BASE}/key`, {})
    if (response.status !== 200) return null
    const usage = parseOpenRouterKey(response.body, ctx.now)
    if (usage.windows.length === 0 && !usage.credits) return null
    return {
      source: 'OpenRouter · GET /key',
      accuracy: 'provider_reported',
      windows: usage.windows,
      ...(usage.credits ? { credits: usage.credits } : {}),
      ...(usage.isFreeTier ? { note: 'Аккаунт без пополнений: лимит бесплатных моделей ниже (по документации OpenRouter).' } : {})
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Cerebras (text only)
// ---------------------------------------------------------------------------------------------
export const CEREBRAS_CONFIG: OpenAICompatConfig = {
  id: 'cerebras',
  name: 'Cerebras',
  baseUrl: 'https://api.cerebras.ai/v1',
  capabilities: TEXT_ONLY,
  modelDiscovery: { parse: parseOpenAiList },
  rateLimitParser: parseCerebrasRateLimits,
  rateLimitSource: 'заголовки x-ratelimit-* Cerebras',
  maxTokensParam: 'max_completion_tokens',
  autoModels: (models, vision) =>
    vision ? [] : pickPreferred(models, [/gpt-oss-120b/, /qwen-?3.*(235|32)b/, /llama-?3\.3-70b/, /llama.*8b/]),
  modelVision: () => false
}

// ---------------------------------------------------------------------------------------------
// NVIDIA NIM (hosted API Catalog)
// ---------------------------------------------------------------------------------------------
const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1'
const NVIDIA_NOT_CHAT = /embed|rerank|retriev|guard|safety|parse|reward|clip|diffusion|sdxl|stable|flux|tts|asr|riva|segment|deplot|bge|e5-|nv-embed|vlm-embed|nemoguard|calibrat/i
/** VLM families the catalog is known to serve; anything else is treated as text-only unless listed. */
const NVIDIA_VISION = /vision|vila|neva|fuyu|paligemma|kosmos|llava|pixtral|gemma-3|llama-4|-vl|omni|phi-3\.5-vision|phi-4-multimodal|maverick|scout/i

export function parseNvidiaModels(body: unknown): ModelInfo[] {
  return parseOpenAiList(body)
    .filter((m) => !NVIDIA_NOT_CHAT.test(m.id))
    .map((m) => ({ ...m, vision: NVIDIA_VISION.test(m.id) }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export const NVIDIA_CONFIG: OpenAICompatConfig = {
  id: 'nvidia',
  name: 'NVIDIA NIM',
  baseUrl: NVIDIA_BASE,
  capabilities: API_CAPABILITIES,
  modelDiscovery: { parse: parseNvidiaModels },
  // NVIDIA documents a 180 KB limit for inline base64 images.
  maxInlineImageChars: 180_000,
  autoModels: (models, vision) =>
    vision
      ? pickPreferred(models, [/llama-3\.2-90b-vision/, /llama-3\.2-11b-vision/, /nemotron.*(vl|omni)/, /gemma-3/, /phi-.*(vision|multimodal)/], (m) => m.vision === true)
      : pickPreferred(models, [/llama-3\.3-70b/, /llama-3\.1-70b/, /nemotron.*(super|70b)/, /llama-3\.1-8b/], (m) => m.vision !== true),
  modelVision: (id) => NVIDIA_VISION.test(id),
  // The model list is public, so "Test connection" makes one tiny real request with the key.
  authCheck: async (ctx: CompatContext) => {
    const list = await ctx.http(`${NVIDIA_BASE}/models`, {})
    const models = list.status === 200 ? parseNvidiaModels(list.body) : []
    const model = NVIDIA_CONFIG.autoModels(models, false, false)[0] ?? 'meta/llama-3.1-8b-instruct'
    const response = await ctx.http(`${NVIDIA_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
    })
    if (response.status === 401 || response.status === 403) throw new ProviderError('nvidia', 'AUTH', { status: response.status })
    if (response.status === 429) throw new ProviderError('nvidia', 'RATE_LIMIT', { status: 429 })
    if (response.status >= 500) throw new ProviderError('nvidia', 'PROVIDER_DOWN', { status: response.status })
    // Any other 2xx/4xx means the key itself was accepted (a retired model is not an auth failure).
  }
}

// ---------------------------------------------------------------------------------------------
// Hugging Face Inference Providers
// ---------------------------------------------------------------------------------------------
const HF_BASE = 'https://router.huggingface.co/v1'

export function parseHuggingFaceModels(body: unknown): ModelInfo[] {
  const models: (ModelInfo & { throughput: number })[] = []
  for (const raw of asList(asObject(body).data)) {
    const m = asObject(raw)
    if (typeof m.id !== 'string' || !m.id) continue
    const arch = asObject(m.architecture)
    const inputs = asList(arch.input_modalities)
    const outputs = asList(arch.output_modalities)
    if (outputs.length > 0 && !outputs.includes('text')) continue
    const providers = asList(m.providers).map(asObject)
    const live = providers.filter((p) => p.status === 'live')
    if (providers.length > 0 && live.length === 0) continue
    const contexts = live.map((p) => p.context_length).filter((n): n is number => typeof n === 'number')
    models.push({
      id: m.id,
      displayName: m.id,
      ...(inputs.length ? { vision: inputs.includes('image') } : {}),
      ...(contexts.length ? { contextLength: Math.max(...contexts) } : {}),
      ...(live.some((p) => p.supports_structured_output === true) ? { structured: true } : {}),
      throughput: Math.max(0, ...live.map((p) => (typeof p.throughput === 'number' ? p.throughput : 0)))
    })
  }
  return models
    .sort((a, b) => Number(b.structured === true) - Number(a.structured === true) || b.throughput - a.throughput || a.id.localeCompare(b.id))
    .map(({ throughput: _t, ...m }) => m)
}

export const HUGGINGFACE_CONFIG: OpenAICompatConfig = {
  id: 'huggingface',
  name: 'Hugging Face',
  baseUrl: HF_BASE,
  capabilities: API_CAPABILITIES,
  modelDiscovery: { parse: parseHuggingFaceModels },
  timeoutMs: 60_000,
  autoModels: (models, vision) =>
    vision
      ? pickPreferred(models, [/qwen.*(vl|3\.\d)/i, /gemma-3/i], (m) => m.vision === true).slice(0, 8)
      : pickPreferred(models, [/gpt-oss-120b/, /qwen3.*(32b|235b|30b)/i, /llama-3\.3-70b/i], (m) => m.vision !== true).slice(0, 8),
  modelVision: () => undefined,
  staticUsage: () => ({
    source: 'Hugging Face',
    accuracy: 'unknown',
    windows: [],
    note: 'Бесплатные кредиты ограничены. Остаток через API недоступен — смотрите в настройках Hugging Face.'
  }),
  // The model list is public: the token is checked against the account endpoint.
  authCheck: async (ctx) => {
    const response = await ctx.http('https://huggingface.co/api/whoami-v2', {})
    if (response.status === 401 || response.status === 403) throw new ProviderError('huggingface', 'AUTH', { status: response.status })
    if (response.status >= 500) throw new ProviderError('huggingface', 'PROVIDER_DOWN', { status: response.status })
  }
}

// ---------------------------------------------------------------------------------------------
// Cloudflare Workers AI
// ---------------------------------------------------------------------------------------------
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'
const CLOUDFLARE_VISION = /vision|llava|gemma-3|llama-4|mistral-small-3|-vl|pixtral|uform/i
const CLOUDFLARE_NOT_CHAT = /embed|rerank|guard|whisper|tts|melotts|bge|m2m100|distilbert|resnet|stable-diffusion|flux|lucid|phoenix|aura|nova|indictrans|detr|llama-guard|text-to-/i

const accountOf = (fields: Record<string, string>): string => encodeURIComponent(fields.accountId?.trim() ?? '')

export function parseCloudflareModels(body: unknown): ModelInfo[] {
  const models: ModelInfo[] = []
  for (const raw of asList(asObject(body).result)) {
    const m = asObject(raw)
    const id = typeof m.name === 'string' ? m.name : ''
    if (!id || CLOUDFLARE_NOT_CHAT.test(id)) continue
    models.push({ id, displayName: id.replace(/^@cf\//, ''), ...(CLOUDFLARE_VISION.test(id) ? { vision: true } : {}) })
  }
  return models.sort((a, b) => a.id.localeCompare(b.id))
}

function cloudflareError(response: HttpResponse, now: number): ProviderError | null {
  const message = errorMessage(response.body)
  if (/daily free allocation|used up your|neurons/i.test(message) || (response.status === 429 && /allocation|quota/i.test(message))) {
    // Documented rule: the free allocation resets daily at 00:00 UTC (shown as an estimate).
    return new ProviderError('cloudflare', 'PLAN_LIMIT', {
      status: response.status,
      message: 'Бесплатная квота Cloudflare на сегодня исчерпана.',
      resetAt: nextUtcMidnight(now),
      resetIsEstimate: true
    })
  }
  if (/agree|license/i.test(message) && response.status !== 429) {
    return new ProviderError('cloudflare', 'MODEL_UNAVAILABLE', {
      status: response.status,
      message: 'Эта модель требует принять лицензию в Cloudflare. Выберите другую модель.'
    })
  }
  if (response.status === 401 || response.status === 403 || (response.status === 404 && !/model/i.test(message))) {
    return new ProviderError('cloudflare', 'AUTH', {
      status: response.status,
      message: 'Cloudflare не принял токен или Account ID. Нужен токен с правом Workers AI → Read.'
    })
  }
  return null
}

export const CLOUDFLARE_CONFIG: OpenAICompatConfig = {
  id: 'cloudflare',
  name: 'Cloudflare Workers AI',
  baseUrl: (fields) => `${CLOUDFLARE_API}/accounts/${accountOf(fields)}/ai/v1`,
  capabilities: API_CAPABILITIES,
  modelDiscovery: {
    url: (_base, fields) => `${CLOUDFLARE_API}/accounts/${accountOf(fields)}/ai/models/search?task=Text%20Generation&per_page=100`,
    parse: parseCloudflareModels
  },
  timeoutMs: 60_000,
  autoModels: (models, vision) =>
    vision
      ? pickPreferred(models, [/gemma-3/, /llama-4-scout/, /mistral-small-3\.1/, /llama-3\.2-11b-vision/], (m) => m.vision === true)
      : pickPreferred(models, [/llama-3\.1-8b-instruct/, /gemma-3-12b/, /mistral-small/, /llama-3\.3-70b/], (m) => m.vision !== true || /gemma-3/.test(m.id)),
  modelVision: (id) => (CLOUDFLARE_VISION.test(id) ? true : undefined),
  mapError: cloudflareError,
  // Cloudflare reports no remaining Neurons through the API: only the documented allocation is shown.
  staticUsage: (now) => ({
    source: 'Документация Cloudflare',
    accuracy: 'unknown',
    windows: [],
    allocation: { label: 'Бесплатная квота: 10 000 нейронов в сутки', resetAt: nextUtcMidnight(now), resetRule: 'Сброс ежедневно в 00:00 UTC' },
    note: 'Cloudflare не отдаёт остаток через API. Ниже — только локальный счётчик Snap Notes.'
  })
}

// ---------------------------------------------------------------------------------------------
// Modal (your own OCR endpoint, see integrations/modal)
// ---------------------------------------------------------------------------------------------
export const MODAL_OCR_PROMPT =
  'Extract all text from this image exactly as written, in reading order. Render tables as Markdown tables and code as fenced code blocks. Output only the extracted content.'

export function modalBaseUrl(fields: Record<string, string>): string {
  return `${(fields.endpoint ?? '').trim().replace(/\/+$/, '').replace(/\/v1$/, '')}/v1`
}

/** A Modal endpoint must be an https URL. Returns an error message, or null when it is fine. */
export function validateModalEndpoint(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:') return 'Адрес эндпоинта должен начинаться с https://'
    if (!url.hostname.includes('.')) return 'Некорректный адрес эндпоинта.'
    return null
  } catch {
    return 'Некорректный адрес эндпоинта.'
  }
}

export const MODAL_CONFIG: OpenAICompatConfig = {
  id: 'modal',
  name: 'Modal OCR',
  baseUrl: modalBaseUrl,
  headers: (secret, fields) => ({ 'Modal-Key': fields.tokenId ?? '', 'Modal-Secret': secret }),
  capabilities: { ...API_CAPABILITIES, vision: true, ocr: true, text: false, structuredOutput: false, ocrCleanup: false, translation: false, noteActions: false },
  modelDiscovery: { parse: (body) => parseOpenAiList(body).map((m) => ({ ...m, vision: true })) },
  // A cold GPU container can need a minute before it answers.
  timeoutMs: 180_000,
  jsonMode: 'none',
  textModels: false,
  // Modal answers requests that run longer than ~150 s with a 303 redirect on its own host.
  followRedirects: true,
  imagePrompt: MODAL_OCR_PROMPT,
  imageResultFormat: 'markdown',
  autoModels: (models, vision) => (vision ? (models ?? []).map((m) => m.id) : []),
  modelVision: () => true,
  mapError: (response) => {
    if (response.status === 401 || response.status === 403) {
      return new ProviderError('modal', 'AUTH', { status: response.status, message: 'Modal не принял Token ID / Token Secret.' })
    }
    if (response.status === 404 || response.status === 502 || response.status === 503) {
      // modal.run answers 404 for an app that is not deployed (or was stopped).
      return new ProviderError('modal', 'PROVIDER_DOWN', {
        status: response.status,
        message: 'Эндпоинт Modal не отвечает. Проверьте адрес и что приложение развёрнуто (modal deploy).'
      })
    }
    return null
  }
}
