import { describe, expect, it, vi } from 'vitest'
import { ChatGptProvider, mapChatGptError } from '../../src/main/providers/impl/chatgpt'
import { ChatGPTError } from '../../src/main/vendor/siwc-local/errors'
import type { ChatGPTClient, SessionState, StreamResponseOptions } from '../../src/main/vendor/siwc-local/types'
import { UsageService } from '../../src/main/providers/usageService'

const IMAGE = Buffer.from('png')

function fakeClient(overrides: Partial<ChatGPTClient> = {}, session: SessionState = { status: 'connected', sharing: true, identity: { email: 'user@example.com', name: 'User' } }) {
  const listeners = new Set<(s: SessionState) => void>()
  const client: ChatGPTClient = {
    signIn: vi.fn(async () => session),
    cancelSignIn: vi.fn(),
    getSession: vi.fn(async () => session),
    listProfiles: vi.fn(async () => []),
    selectProfile: vi.fn(async () => session),
    listModels: vi.fn(async () => [
      { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol' },
      { slug: 'gpt-6-luna', displayName: 'GPT-6 Luna' }
    ]),
    subscribe: vi.fn((listener) => {
      listeners.add(listener)
      listener(session)
      return () => listeners.delete(listener)
    }),
    disconnect: vi.fn(async () => {}),
    streamResponse: vi.fn(async () => ({ text: '{"blocks":[]}', usage: { inputTokens: 10, outputTokens: 2 } })),
    ...overrides
  }
  return client
}

function provider(client: ChatGPTClient | null, model = 'auto') {
  return new ChatGptProvider({ getClient: () => client, getModel: () => model, integrationEnabled: true })
}

describe('ChatGPT plan provider', () => {
  it('exposes account label and plan-usage permission, never tokens', async () => {
    const p = provider(fakeClient())
    const info = await p.getConnectionInfo()
    expect(info).toEqual({ connected: true, connecting: false, planUsageEnabled: true, accountName: 'User', accountEmail: 'user@example.com' })
    expect(JSON.stringify(info)).not.toMatch(/token/i)
  })

  it('signed in without plan-usage permission is not available for routing', async () => {
    const p = provider(fakeClient({}, { status: 'connected', sharing: false }))
    expect(await p.isAvailable()).toBe(false)
    expect((await p.getConnectionInfo()).planUsageEnabled).toBe(false)
  })

  it('usage is "managed by ChatGPT": no windows, no percentages, official link', async () => {
    const usage = await provider(fakeClient()).getUsage()
    expect(usage.windows).toEqual([])
    expect(usage.accuracy).toBe('unknown')
    expect(usage.manageUrl).toBe('https://chatgpt.com/settings/usage')
  })

  it('sends the screenshot as an input_image part with store/stream handled by the SDK', async () => {
    const client = fakeClient()
    const result = await provider(client).runVision({ operation: 'OCR_VISION', prompt: 'p', image: IMAGE, mimeType: 'image/png' })
    const call = (client.streamResponse as ReturnType<typeof vi.fn>).mock.calls[0][0] as StreamResponseOptions
    expect(call.model).toBe('gpt-6.1-sol')
    expect(Array.isArray(call.input) && call.input[0].content).toEqual([
      { type: 'input_text', text: 'p' },
      { type: 'input_image', image_url: `data:image/png;base64,${IMAGE.toString('base64')}` }
    ])
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 })
  })

  it('learns that a model rejects images and tries the next listed model', async () => {
    const client = fakeClient({
      streamResponse: vi.fn(async (options: StreamResponseOptions) => {
        if (options.model === 'gpt-6.1-sol') {
          throw new ChatGPTError('subscription_sharing_unsupported_capability', 'x', false, 400)
        }
        return { text: 'ok' }
      })
    })
    const p = provider(client)
    const result = await p.runVision({ operation: 'OCR_VISION', prompt: 'p', image: IMAGE, mimeType: 'image/png' })
    expect(result.model).toBe('gpt-6-luna')
    // Second request skips the model that rejected images.
    await p.runVision({ operation: 'OCR_VISION', prompt: 'p', image: IMAGE, mimeType: 'image/png' })
    expect((client.streamResponse as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as StreamResponseOptions).model)).toEqual([
      'gpt-6.1-sol',
      'gpt-6-luna',
      'gpt-6-luna'
    ])
  })

  it('never sends an image to a model the catalog marks as text-only', async () => {
    const client = fakeClient({ listModels: vi.fn(async () => [{ slug: 'text-only', displayName: 'T', inputModalities: ['text'] }]) })
    const p = provider(client)
    expect(await p.canServeVision()).toBe(false)
    const error = await p.runVision({ operation: 'OCR_VISION', prompt: 'p', image: IMAGE, mimeType: 'image/png' }).catch((e) => e)
    expect(error.code).toBe('UNSUPPORTED')
    expect(client.streamResponse).not.toHaveBeenCalled()
  })

  it('usage limit → PLAN_LIMIT without an invented reset time', async () => {
    const client = fakeClient({
      streamResponse: vi.fn(async () => {
        throw new ChatGPTError('subscription_sharing_usage_limit_exceeded', 'limit', false, 429)
      })
    })
    const error = await provider(client).runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e)
    expect(error.code).toBe('PLAN_LIMIT')
    expect(error.resetAt).toBeUndefined()
    expect(error.retryAfter).toBeUndefined()

    const usage = new UsageService({ setTimer: () => null, clearTimer: () => {} })
    usage.register('chatgpt', { local: false, configured: true })
    usage.recordError(error)
    expect(usage.getStatus('chatgpt')).toBe('LIMIT_REACHED')
    expect(usage.getUsage('chatgpt').resetAt).toBeUndefined()
  })

  it('an official retry-after header on a limit becomes a provider-reported reset', () => {
    const error = mapChatGptError(new ChatGPTError('subscription_sharing_usage_limit_exceeded', 'x', false, 429, { retryAfterSeconds: 120 }))
    expect(error).toMatchObject({ code: 'PLAN_LIMIT', retryAfter: 120 })
  })

  it('expired OAuth (unusable refresh token) → AUTH_EXPIRED', async () => {
    for (const code of ['invalid_grant', 'refresh_token_expired', 'refresh_token_reused', 'token_expired']) {
      const client = fakeClient({
        streamResponse: vi.fn(async () => {
          throw new ChatGPTError(code, 'expired')
        })
      })
      expect(await provider(client).runText({ operation: 'OCR_CLEANUP', prompt: 'x' }).catch((e) => e.code)).toBe('AUTH_EXPIRED')
    }
  })

  it('sharing not enabled / not eligible → NO_PERMISSION (falls back)', () => {
    expect(mapChatGptError(new ChatGPTError('sharing_not_enabled', 'x')).code).toBe('NO_PERMISSION')
    expect(mapChatGptError(new ChatGPTError('subscription_sharing_user_not_eligible', 'x', false, 403))).toMatchObject({
      code: 'NO_PERMISSION',
      canFallback: true
    })
  })

  it('disconnect revokes through the SDK and drops cached models', async () => {
    const client = fakeClient()
    const p = provider(client)
    await p.getAvailableModels()
    await p.disconnect()
    expect(client.disconnect).toHaveBeenCalledOnce()
  })

  it('disconnect that cannot confirm remote revocation reports it honestly', async () => {
    const client = fakeClient({
      disconnect: vi.fn(async () => {
        throw new ChatGPTError('revocation_failed', 'x', true)
      })
    })
    const error = await provider(client).disconnect().catch((e) => e)
    expect(error.message).toMatch(/не подтверждён/)
  })

  it('without secure storage the provider refuses to connect', async () => {
    const error = await provider(null).connect().catch((e) => e)
    expect(error.code).toBe('AUTH')
  })

  it('does not loop when the SDK re-publishes an unchanged session on every getSession()', async () => {
    // Like the real SDK: every getSession() publishes to subscribers, changed or not.
    const session: SessionState = { status: 'disconnected', sharing: false }
    const subscribers = new Set<(s: SessionState) => void>()
    const client = fakeClient({
      subscribe: vi.fn((listener: (s: SessionState) => void) => {
        subscribers.add(listener)
        listener(session)
        return () => subscribers.delete(listener)
      }),
      getSession: vi.fn(async () => {
        for (const s of subscribers) s({ ...session })
        return { ...session }
      })
    })
    const p = provider(client)
    let notifications = 0
    // The production listener refreshes status, which calls getSession() again.
    p.onSessionChange(() => {
      notifications++
      void p.getSession()
    })
    await Promise.all([p.getSession(), p.isAvailable(), p.getConnectionInfo(), p.getSession()])
    await new Promise((r) => setTimeout(r, 20))
    expect(notifications).toBe(1)
    expect((client.getSession as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('lock contention is not reported as an expired sign-in', async () => {
    const { sessionNeedsReauth } = await import('../../src/main/providers/impl/chatgpt')
    expect(sessionNeedsReauth({ status: 'reauth_required', sharing: false, error: { code: 'storage_busy', message: '', retryable: true } })).toBe(false)
    expect(sessionNeedsReauth({ status: 'reauth_required', sharing: false, error: { code: 'invalid_grant', message: '', retryable: false } })).toBe(true)
    expect(sessionNeedsReauth({ status: 'reauth_required', sharing: false })).toBe(true)
  })

  it('a disabled integration flag makes it unavailable', async () => {
    const p = new ChatGptProvider({ getClient: () => fakeClient(), getModel: () => 'auto', integrationEnabled: false })
    expect(await p.isAvailable()).toBe(false)
    expect(p.getIntegration().enabled).toBe(false)
  })
})
