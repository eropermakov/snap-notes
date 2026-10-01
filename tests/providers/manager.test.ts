import { describe, expect, it, vi } from 'vitest'
import { AllProvidersFailedError } from '../../src/main/providers/router'
import { formatRoutingNotice } from '../../src/shared/usageFormat'
import { FakeProvider, createHarness, failWith, settle } from './fakes'

const IMAGE = Buffer.from('png')

function visionRun() {
  return {
    operation: 'OCR_VISION' as const,
    requiredCapabilities: ['vision' as const],
    imageSent: true,
    includeLocalFallback: true,
    run: (p: FakeProvider | import('../../src/main/providers/types').AIProvider) =>
      p.runVision({ operation: 'OCR_VISION', prompt: 'p', image: IMAGE, mimeType: 'image/png' })
  }
}

describe('ProviderManager', () => {
  it('registers providers and lists public states without credentials', async () => {
    const h = createHarness([new FakeProvider('gemini'), new FakeProvider('tesseract', true)])
    await settle()
    const states = await h.manager.publicStates()
    expect(states.map((s) => s.id)).toEqual(['gemini', 'tesseract'])
    expect(JSON.stringify(states)).not.toMatch(/apiKey|token|secret/i)
    expect(states[0].status).toBe('AVAILABLE')
  })

  it('listing public states never asks a provider to fetch its model catalog (no network on render)', async () => {
    const gemini = new FakeProvider('gemini')
    const spy = vi.spyOn(gemini, 'getAvailableModels')
    const h = createHarness([gemini])
    await settle()
    await h.manager.publicStates()
    await h.manager.publicStates()
    expect(spy).toHaveBeenCalled()
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ cachedOnly: true })
  })

  it('falls back on limit reached, updates usage state and explains it', async () => {
    const chatgpt = new FakeProvider('chatgpt', false, failWith('chatgpt', 'PLAN_LIMIT', { retryAfter: 7980 }))
    const gemini = new FakeProvider('gemini')
    const h = createHarness([chatgpt, gemini, new FakeProvider('tesseract', true)])
    await settle()

    const outcome = await h.manager.execute(visionRun())
    expect(outcome.provider).toBe('gemini')
    expect(h.usage.getStatus('chatgpt')).toBe('LIMIT_REACHED')
    expect(outcome.notice?.skipped[0]).toMatchObject({ provider: 'chatgpt', code: 'PLAN_LIMIT' })
    expect(formatRoutingNotice(outcome.notice!, h.clock.now)).toBe(
      'Распознано: gemini · ChatGPT: лимит исчерпан, сброс через 2 ч 13 мин'
    )

    // The next request skips ChatGPT entirely while it is blocked.
    await h.manager.execute(visionRun())
    expect(chatgpt.calls).toHaveLength(1)
  })

  it('records local activity separately from provider usage', async () => {
    const gemini = new FakeProvider('gemini', false, async () => ({
      text: '{"blocks":[]}',
      model: 'gemini-x',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }
    }))
    const h = createHarness([new FakeProvider('chatgpt', false, failWith('chatgpt', 'RATE_LIMIT')), gemini])
    await settle()
    await h.manager.execute(visionRun())
    const summary = h.activity.summary()
    expect(summary.byProvider.gemini).toEqual({ requests: 1, failures: 0, totalTokens: 120 })
    expect(summary.byProvider.chatgpt).toEqual({ requests: 1, failures: 1, totalTokens: 0 })
    const [latest] = h.activity.recent(1)
    expect(latest).toMatchObject({ provider: 'gemini', imageSent: true, fallbackUsed: true, operationType: 'OCR_VISION' })
    // Activity never becomes "remaining usage".
    expect(h.usage.getUsage('gemini').windows).toEqual([])
  })

  it('model unavailable falls back to the next provider', async () => {
    const h = createHarness([
      new FakeProvider('groq', false, failWith('groq', 'MODEL_UNAVAILABLE')),
      new FakeProvider('anthropic')
    ])
    await settle()
    const outcome = await h.manager.execute(visionRun())
    expect(outcome.provider).toBe('anthropic')
    expect(h.usage.getStatus('groq')).toBe('ERROR')
  })

  it('offline mode never calls a cloud provider', async () => {
    const gemini = new FakeProvider('gemini')
    const tesseract = new FakeProvider('tesseract', true, async () => ({ text: 'local text', model: 'tesseract' }))
    const h = createHarness([gemini, tesseract], { mode: 'offline' })
    await settle()
    const outcome = await h.manager.execute(visionRun())
    expect(outcome.provider).toBe('tesseract')
    expect(gemini.calls).toHaveLength(0)
  })

  it('onlyProvider cannot reach the cloud in offline mode', async () => {
    const gemini = new FakeProvider('gemini')
    const h = createHarness([gemini], { mode: 'offline' })
    await settle()
    await expect(h.manager.execute({ ...visionRun(), onlyProvider: 'gemini' })).rejects.toBeInstanceOf(AllProvidersFailedError)
    expect(gemini.calls).toHaveLength(0)
  })

  it('a disconnected provider is no longer used', async () => {
    const chatgpt = new FakeProvider('chatgpt')
    const h = createHarness([chatgpt, new FakeProvider('gemini')])
    await settle()
    await chatgpt.disconnect()
    await h.manager.refreshStatus('chatgpt')
    const outcome = await h.manager.execute(visionRun())
    expect(outcome.provider).toBe('gemini')
    expect(chatgpt.calls).toHaveLength(0)
    expect(h.usage.getStatus('chatgpt')).toBe('AUTH_REQUIRED')
  })

  it('a provider returns to the pool after its reported reset', async () => {
    const chatgpt = new FakeProvider('chatgpt', false, failWith('chatgpt', 'PLAN_LIMIT', { retryAfter: 60 }))
    const h = createHarness([chatgpt, new FakeProvider('gemini')])
    await settle()
    await h.manager.execute(visionRun())
    expect(h.usage.getStatus('chatgpt')).toBe('LIMIT_REACHED')

    h.clock.now += 61_000
    h.usage.tick()
    chatgpt.behavior = async () => ({ text: 'ok', model: 'm' })
    const outcome = await h.manager.execute(visionRun())
    expect(outcome.provider).toBe('chatgpt')
    expect(h.usage.getStatus('chatgpt')).toBe('AVAILABLE')
  })

  it('throws AllProvidersFailedError with attempts when every provider fails', async () => {
    const h = createHarness([
      new FakeProvider('gemini', false, failWith('gemini', 'NETWORK')),
      new FakeProvider('groq', false, failWith('groq', 'TIMEOUT'))
    ])
    await settle()
    const error = await h.manager.execute({ ...visionRun(), includeLocalFallback: false }).catch((e) => e)
    expect(error).toBeInstanceOf(AllProvidersFailedError)
    expect((error as AllProvidersFailedError).attempts.map((a) => a.error.code)).toEqual(['NETWORK', 'TIMEOUT'])
  })
})
