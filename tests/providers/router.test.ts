import { describe, expect, it } from 'vitest'
import { planRoute, runWithFallback, AllProvidersFailedError, type RouteCandidate, type RouteRequest } from '../../src/main/providers/router'
import { ProviderError } from '../../src/main/providers/errors'
import { FULL_CAPS } from './fakes'
import type { ProviderId } from '../../src/shared/providers'

const TEXT_ONLY = { ...FULL_CAPS, vision: false }

function candidate(id: ProviderId, partial: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    id,
    local: id === 'tesseract',
    usable: true,
    capabilities: id === 'tesseract' ? { ...TEXT_ONLY, vision: true, text: false } : FULL_CAPS,
    canServeVision: true,
    status: 'AVAILABLE',
    ...partial
  }
}

function request(partial: Partial<RouteRequest> = {}): RouteRequest {
  return {
    operation: 'OCR_VISION',
    requiredCapabilities: ['vision'],
    privacyMode: 'cloud',
    networkOnline: true,
    userPriority: ['chatgpt', 'claude', 'gemini', 'groq', 'openai', 'anthropic'],
    preferredProvider: null,
    protectLowLimits: true,
    autoFallback: true,
    includeLocalFallback: true,
    ...partial
  }
}

const ALL = (): RouteCandidate[] => [
  candidate('tesseract'),
  candidate('groq'),
  candidate('gemini'),
  candidate('chatgpt'),
  candidate('claude', { usable: false }),
  candidate('openai', { usable: false }),
  candidate('anthropic')
]

describe('planRoute (Auto router)', () => {
  it('orders by user priority with Tesseract always last', () => {
    expect(planRoute(request(), ALL()).order).toEqual(['chatgpt', 'gemini', 'groq', 'anthropic', 'tesseract'])
  })

  it('respects a custom priority', () => {
    const plan = planRoute(request({ userPriority: ['groq', 'anthropic', 'gemini', 'chatgpt'] }), ALL())
    expect(plan.order).toEqual(['groq', 'anthropic', 'gemini', 'chatgpt', 'tesseract'])
  })

  it('skips providers without the required capability (vision)', () => {
    const candidates = ALL().map((c) => (c.id === 'chatgpt' ? { ...c, canServeVision: false } : c))
    const plan = planRoute(request(), candidates)
    expect(plan.order[0]).toBe('gemini')
    expect(plan.skipped).toContainEqual({ id: 'chatgpt', reason: 'capability' })
  })

  it('uses text providers for economy text cleanup and never Tesseract there', () => {
    const plan = planRoute(request({ requiredCapabilities: ['text', 'ocrCleanup'], includeLocalFallback: false }), ALL())
    expect(plan.order).toEqual(['chatgpt', 'gemini', 'groq', 'anthropic'])
  })

  it('offline mode: only local providers, nothing in the cloud', () => {
    const plan = planRoute(request({ privacyMode: 'offline' }), ALL())
    expect(plan.order).toEqual(['tesseract'])
    expect(plan.skipped.filter((s) => s.reason === 'privacy').map((s) => s.id).sort()).toEqual(
      ['anthropic', 'chatgpt', 'claude', 'gemini', 'groq', 'openai']
    )
  })

  it('no network: only local providers', () => {
    expect(planRoute(request({ networkOnline: false }), ALL()).order).toEqual(['tesseract'])
  })

  it('skips blocked providers (limit reached, auth expired, rate limited)', () => {
    const candidates = ALL().map((c) =>
      c.id === 'chatgpt' ? { ...c, status: 'LIMIT_REACHED' as const } : c.id === 'gemini' ? { ...c, status: 'AUTH_EXPIRED' as const } : c
    )
    const plan = planRoute(request(), candidates)
    expect(plan.order).toEqual(['groq', 'anthropic', 'tesseract'])
  })

  it('protect low limits moves LIMIT_LOW providers behind healthy ones', () => {
    const candidates = ALL().map((c) => (c.id === 'chatgpt' ? { ...c, status: 'LIMIT_LOW' as const, remainingPercent: 8 } : c))
    expect(planRoute(request(), candidates).order).toEqual(['gemini', 'groq', 'anthropic', 'chatgpt', 'tesseract'])
    expect(planRoute(request({ protectLowLimits: false }), candidates).order[0]).toBe('chatgpt')
  })

  it('a manual provider choice goes first even when its limit is low', () => {
    const candidates = ALL().map((c) => (c.id === 'groq' ? { ...c, status: 'LIMIT_LOW' as const } : c))
    expect(planRoute(request({ preferredProvider: 'groq' }), candidates).order[0]).toBe('groq')
  })

  it('automatic fallback off → a single attempt', () => {
    expect(planRoute(request({ autoFallback: false }), ALL()).order).toEqual(['chatgpt'])
  })

  it('disconnected / not configured providers are skipped', () => {
    const plan = planRoute(request(), ALL())
    expect(plan.skipped).toContainEqual({ id: 'openai', reason: 'not_configured' })
    expect(plan.order).not.toContain('claude')
  })
})

describe('runWithFallback', () => {
  it('ChatGPT limit reached → Gemini succeeds', async () => {
    const seen: string[] = []
    const outcome = await runWithFallback(
      ['chatgpt', 'gemini', 'tesseract'],
      async (id) => {
        if (id === 'chatgpt') throw new ProviderError('chatgpt', 'PLAN_LIMIT')
        return `ok:${id}`
      },
      (error) => seen.push(`${error.provider}:${error.code}`)
    )
    expect(outcome.value).toBe('ok:gemini')
    expect(outcome.provider).toBe('gemini')
    expect(seen).toEqual(['chatgpt:PLAN_LIMIT'])
  })

  it('stops on cancellation instead of falling back', async () => {
    let calls = 0
    await expect(
      runWithFallback(['gemini', 'groq'], async () => {
        calls++
        throw new ProviderError('gemini', 'CANCELLED')
      })
    ).rejects.toBeInstanceOf(AllProvidersFailedError)
    expect(calls).toBe(1)
  })

  it('normalizes unknown thrown errors and keeps going', async () => {
    const outcome = await runWithFallback(['groq', 'tesseract'], async (id) => {
      if (id === 'groq') throw new TypeError('fetch failed')
      return 'local'
    })
    expect(outcome.attempts[0].error.code).toBe('NETWORK')
    expect(outcome.value).toBe('local')
  })

  it('reports every attempt when all providers fail', async () => {
    const error = await runWithFallback(['gemini', 'groq'], async (id) => {
      throw new ProviderError(id, 'MODEL_UNAVAILABLE')
    }).catch((e) => e)
    expect(error).toBeInstanceOf(AllProvidersFailedError)
    expect((error as AllProvidersFailedError).attempts.map((a) => a.provider)).toEqual(['gemini', 'groq'])
  })
})
