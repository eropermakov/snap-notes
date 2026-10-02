import { describe, expect, it } from 'vitest'
import { planRoute, type RouteCandidate, type RouteRequest } from '../../src/main/providers/router'
import { RecognitionService } from '../../src/main/providers/recognition'
import { TesseractProvider, type LocalOcrResult } from '../../src/main/providers/impl/tesseract'
import { isVisionRequest } from '../../src/main/providers/types'
import { PROVIDER_CATALOG } from '../../src/shared/providerCatalog'
import { DEFAULT_PRIORITY, type AiSettings, type ProviderId } from '../../src/shared/providers'
import { extractBlockItems } from '../../src/shared/structuredJson'
import { FULL_CAPS, FakeProvider, createHarness, failWith, settle } from './fakes'

const TEXT_ONLY = { ...FULL_CAPS, vision: false }

function candidate(id: ProviderId, partial: Partial<RouteCandidate> = {}): RouteCandidate {
  const entry = PROVIDER_CATALOG[id]
  return {
    id,
    local: id === 'tesseract',
    usable: true,
    capabilities: id === 'tesseract' ? { ...TEXT_ONLY, vision: true, text: false } : FULL_CAPS,
    canServeVision: true,
    status: 'AVAILABLE',
    costClass: entry.costClass,
    qualityRank: entry.qualityRank,
    speedRank: entry.speedRank,
    ...partial
  }
}

function request(partial: Partial<RouteRequest> = {}): RouteRequest {
  return {
    operation: 'OCR_VISION',
    requiredCapabilities: ['vision'],
    privacyMode: 'cloud',
    networkOnline: true,
    userPriority: DEFAULT_PRIORITY,
    preferredProvider: null,
    protectLowLimits: true,
    autoFallback: true,
    includeLocalFallback: true,
    ...partial
  }
}

describe('Prefer: free / quality / speed / custom', () => {
  const pool = (): RouteCandidate[] => [
    candidate('tesseract'),
    candidate('openai'), // paid
    candidate('modal'), // advanced
    candidate('cerebras'),
    candidate('gemini'),
    candidate('mistral')
  ]

  it('Free: free providers first (in the user\'s order), then advanced, then paid, Tesseract last', () => {
    const plan = planRoute(request({ prefer: 'free' }), pool())
    expect(plan.order).toEqual(['gemini', 'mistral', 'cerebras', 'modal', 'openai', 'tesseract'])
  })

  it('Best quality uses the catalog quality rank', () => {
    const plan = planRoute(request({ prefer: 'quality' }), pool())
    expect(plan.order.slice(0, 3)).toEqual(['gemini', 'openai', 'mistral']) // 1, 1 (priority tiebreak), 3 — modal ties mistral at 3
    expect(plan.order[plan.order.length - 1]).toBe('tesseract')
  })

  it('Fastest puts Cerebras first', () => {
    expect(planRoute(request({ prefer: 'speed' }), pool()).order[0]).toBe('cerebras')
  })

  it('Custom (or no preference) keeps the user\'s own order exactly', () => {
    const custom = request({ prefer: 'custom', userPriority: ['openai', 'cerebras', 'gemini', 'mistral', 'modal'] })
    expect(planRoute(custom, pool()).order).toEqual(['openai', 'cerebras', 'gemini', 'mistral', 'modal', 'tesseract'])
    expect(planRoute({ ...custom, prefer: undefined }, pool()).order).toEqual(planRoute(custom, pool()).order)
  })

  it('a provider that cannot take an image is skipped for screenshots but kept for text', () => {
    const cerebras = candidate('cerebras', { capabilities: TEXT_ONLY, canServeVision: false })
    expect(planRoute(request(), [cerebras, candidate('tesseract')]).order).toEqual(['tesseract'])
    const text = planRoute(request({ requiredCapabilities: ['text', 'ocrCleanup'], includeLocalFallback: false }), [cerebras, candidate('tesseract')])
    expect(text.order).toEqual(['cerebras'])
  })
})

// --------------------------------------------------------------------------------------------
const IMAGE = Buffer.from('fake-png')
const PROMPTS = { vision: 'VISION PROMPT', textFormat: (t: string) => `FORMAT:${t}`, jsonRepair: (b: string) => `REPAIR:${b}` }
const LOCAL: LocalOcrResult = {
  text: 'Список покупок\nмолоко\nхлеб',
  confidence: 95,
  lines: [
    { text: 'Список покупок', confidence: 95, bbox: { x0: 10, y0: 10, x1: 120, y1: 24 }, wordConfidences: [95, 95] },
    { text: 'молоко', confidence: 95, bbox: { x0: 10, y0: 30, x1: 60, y1: 44 }, wordConfidences: [95] }
  ]
}

function setup(mode: AiSettings['mode'], cloud: FakeProvider[], local: LocalOcrResult = LOCAL) {
  const engine = { recognize: async () => local, ready: async () => {} }
  const tesseract = new TesseractProvider(engine)
  const h = createHarness([...cloud, tesseract as unknown as FakeProvider], { mode })
  return { service: new RecognitionService(h.manager, tesseract, () => h.settings), h }
}

describe('OCR routing across many providers', () => {
  it('text-only provider only (best mode): Tesseract → text provider → structured blocks; the image is never sent', async () => {
    const cerebras = new FakeProvider('cerebras', false, undefined, TEXT_ONLY)
    cerebras.vision = false
    const { service } = setup('best', [cerebras])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(out.provider).toBe('cerebras')
    expect(out.structured).toBe(true)
    expect(cerebras.calls).toHaveLength(1)
    expect(isVisionRequest(cerebras.calls[0])).toBe(false)
    expect(cerebras.calls[0].prompt).toBe(`FORMAT:${LOCAL.text}`)
  })

  it('example chain: Gemini quota → OpenRouter unavailable → Mistral quota → Tesseract + Cerebras', async () => {
    const gemini = new FakeProvider('gemini', false, failWith('gemini', 'PLAN_LIMIT'))
    const openrouter = new FakeProvider('openrouter', false, failWith('openrouter', 'MODEL_UNAVAILABLE'))
    const mistral = new FakeProvider('mistral', false, failWith('mistral', 'RATE_LIMIT', { retryAfter: 30 }))
    const cerebras = new FakeProvider('cerebras', false, undefined, TEXT_ONLY)
    cerebras.vision = false
    const { service } = setup('best', [gemini, openrouter, mistral, cerebras])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    // The user still gets a structured note.
    expect(out.provider).toBe('cerebras')
    expect(out.structured).toBe(true)
    expect(out.offlineFallback).toBe(false)
    expect(out.notice?.skipped.map((s) => s.provider)).toEqual(['gemini', 'openrouter', 'mistral'])
    expect(gemini.calls.every((c) => isVisionRequest(c))).toBe(true)
    expect(isVisionRequest(cerebras.calls[0])).toBe(false)
  })

  it('every provider fails → the local text is still a result (offline fallback)', async () => {
    const { service } = setup('best', [new FakeProvider('gemini', false, failWith('gemini', 'NETWORK')), new FakeProvider('cerebras', false, failWith('cerebras', 'NETWORK'))])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(out.provider).toBe('tesseract')
    expect(out.offlineFallback).toBe(true)
    expect(out.raw).toBe(LOCAL.text)
  })

  it('an OCR engine\'s Markdown becomes note blocks locally, with no second AI request', async () => {
    const mistral = new FakeProvider('mistral', false, async () => ({
      text: '# Прайс\n\n| Товар | Цена |\n|---|---|\n| Хлеб | 50 |\n\n- один\n- два',
      model: 'mistral-ocr-latest',
      format: 'markdown' as const
    }))
    const { service } = setup('best', [mistral])
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(out.provider).toBe('mistral')
    expect(out.structured).toBe(true)
    expect(mistral.calls).toHaveLength(1) // no repair / cleanup round trip
    const items = extractBlockItems(out.raw) as { type: string }[]
    expect(items.map((i) => i.type)).toEqual(['heading', 'table', 'bullet_list'])
  })

  it('offline mode never reaches any provider, however many are connected', async () => {
    const providers = (['gemini', 'groq', 'openrouter', 'mistral', 'cerebras'] as const).map((id) => new FakeProvider(id))
    const { service } = setup('offline', providers)
    await settle()
    const out = await service.recognize(IMAGE, PROMPTS)
    expect(out.provider).toBe('tesseract')
    expect(providers.every((p) => p.calls.length === 0)).toBe(true)
  })

  it('a provider that declines this screenshot size is not asked (inline image limit)', async () => {
    const nvidia = new FakeProvider('nvidia')
    nvidia.canServeVision = async (bytes?: number) => (bytes ?? 0) <= 100
    const gemini = new FakeProvider('gemini')
    const big = Buffer.alloc(5000)
    const { service } = setup('best', [nvidia, gemini])
    await settle()
    const out = await service.recognize(big, PROMPTS)
    expect(out.provider).toBe('gemini')
    expect(nvidia.calls).toHaveLength(0)
  })
})

// --------------------------------------------------------------------------------------------
describe('provider catalog (static configuration)', () => {
  const entries = Object.values(PROVIDER_CATALOG)

  it('has an entry for every provider id', () => {
    for (const id of Object.keys(PROVIDER_CATALOG)) expect(PROVIDER_CATALOG[id as ProviderId].id).toBe(id)
    expect(entries).toHaveLength(15)
  })

  it('"Get API key" always points at an official https page, never a search engine', () => {
    for (const entry of entries) {
      if (!entry.keyUrl) continue
      const url = new URL(entry.keyUrl)
      expect(url.protocol).toBe('https:')
      expect(url.hostname).not.toMatch(/^(www\.)?(google\.com|bing\.com|duckduckgo\.com|yandex\.(ru|com))$/)
      expect(url.search).not.toMatch(/[?&]q=/)
    }
    expect(PROVIDER_CATALOG.gemini.keyUrl).toBe('https://aistudio.google.com/apikey')
    expect(PROVIDER_CATALOG.openrouter.keyUrl).toBe('https://openrouter.ai/keys')
    expect(PROVIDER_CATALOG.huggingface.keyUrl).toBe('https://huggingface.co/settings/tokens')
  })

  it('every credential field exports under its own unique variable name (the documented .env names)', () => {
    const names = entries.flatMap((e) => e.fields.map((f) => f.env))
    expect(new Set(names).size).toBe(names.length)
    for (const expected of [
      'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN', 'NVIDIA_API_KEY', 'COHERE_API_KEY', 'HF_TOKEN', 'MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET', 'MODAL_OCR_ENDPOINT'
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('does not promise what the providers do not promise', () => {
    const text = (id: ProviderId): string => PROVIDER_CATALOG[id].notes.join(' ')
    expect(text('mistral')).toMatch(/Zero Data Retention/)
    expect(text('mistral')).toMatch(/не обещает/)
    expect(text('nvidia')).toMatch(/разработки и прототипирования/)
    expect(PROVIDER_CATALOG.cohere.tierLabel).toMatch(/Trial/)
    expect(text('cohere')).toMatch(/Не для продакшена/i)
    expect(text('huggingface')).toMatch(/ограничены/)
  })
})
