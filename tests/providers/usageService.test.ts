import { describe, expect, it, vi } from 'vitest'
import { UsageService } from '../../src/main/providers/usageService'
import { ProviderError } from '../../src/main/providers/errors'
import { formatCountdown } from '../../src/shared/usageFormat'
import type { UsageWindow } from '../../src/shared/providers'

function setup() {
  const clock = { now: Date.UTC(2026, 8, 30, 12, 0, 0) }
  let pending: { fn: () => void; at: number } | null = null
  const usage = new UsageService({
    now: () => clock.now,
    setTimer: (fn, ms) => {
      pending = { fn, at: clock.now + ms }
      return pending
    },
    clearTimer: () => {
      pending = null
    }
  })
  usage.register('chatgpt', { local: false, configured: true })
  usage.register('gemini', { local: false, configured: true })
  usage.register('tesseract', { local: true, configured: true })
  /** Advances the fake clock and fires the single scheduled timer if it is due. */
  const advance = (ms: number): void => {
    clock.now += ms
    const due = pending
    if (due && due.at <= clock.now) {
      pending = null
      due.fn()
    }
  }
  return { usage, clock, advance, timer: () => pending }
}

function window(partial: Partial<UsageWindow>): UsageWindow {
  return { id: 'w', label: 'w', measurement: 'requests', accuracy: 'provider_reported', ...partial }
}

describe('UsageService', () => {
  it('limit reached with a provider-reported reset returns to the pool after the reset', () => {
    const { usage, clock, advance } = setup()
    const onReset = vi.fn()
    usage.onReset(onReset)

    usage.recordError(new ProviderError('chatgpt', 'PLAN_LIMIT', { retryAfter: 2 * 3600 + 14 * 60 }))
    expect(usage.getStatus('chatgpt')).toBe('LIMIT_REACHED')
    const snapshot = usage.getUsage('chatgpt')
    expect(snapshot.resetAt).toBe(clock.now + (2 * 3600 + 14 * 60) * 1000)
    expect(snapshot.resetAccuracy).toBe('provider_reported')
    expect(formatCountdown(snapshot.resetAt! - clock.now)).toBe('02:14:00')

    advance(2 * 3600 * 1000)
    expect(usage.getStatus('chatgpt')).toBe('LIMIT_REACHED')
    advance(15 * 60 * 1000)
    expect(usage.getStatus('chatgpt')).toBe('AVAILABLE')
    expect(usage.getUsage('chatgpt').stale).toBe(true)
    expect(usage.getUsage('chatgpt').resetAt).toBeUndefined()
    expect(onReset).toHaveBeenCalledWith('chatgpt')
  })

  it('limit reached WITHOUT a reported reset shows no reset time but rechecks internally', () => {
    const { usage, advance } = setup()
    usage.recordError(new ProviderError('chatgpt', 'PLAN_LIMIT'))
    expect(usage.getStatus('chatgpt')).toBe('LIMIT_REACHED')
    expect(usage.getUsage('chatgpt').resetAt).toBeUndefined()
    advance(16 * 60 * 1000)
    expect(usage.getStatus('chatgpt')).toBe('AVAILABLE')
  })

  it('schedules exactly one timer for the earliest reset (no per-second polling)', () => {
    const { usage, clock, timer } = setup()
    usage.recordError(new ProviderError('chatgpt', 'RATE_LIMIT', { retryAfter: 600 }))
    usage.recordError(new ProviderError('gemini', 'RATE_LIMIT', { retryAfter: 30 }))
    expect(timer()!.at).toBe(clock.now + 30_000 + 250)
  })

  it('marks LIMIT_LOW only from provider-reported remaining below 20%', () => {
    const { usage, clock } = setup()
    usage.recordSuccess('gemini', [window({ limit: 100, remaining: 10, remainingPercent: 10, resetAt: clock.now + 3600_000 })])
    expect(usage.getStatus('gemini')).toBe('LIMIT_LOW')

    usage.recordSuccess('chatgpt', [
      window({ limit: 100, remaining: 10, remainingPercent: 10, accuracy: 'estimated', resetAt: clock.now + 3600_000 })
    ])
    expect(usage.getStatus('chatgpt')).toBe('AVAILABLE')
  })

  it('ignores transient per-minute windows for LIMIT_LOW', () => {
    const { usage, clock } = setup()
    usage.recordSuccess('gemini', [window({ limit: 100, remaining: 5, remainingPercent: 5, resetAt: clock.now + 6_000 })])
    expect(usage.getStatus('gemini')).toBe('AVAILABLE')
  })

  it('an exhausted reported window blocks until its reset', () => {
    const { usage, clock, advance } = setup()
    usage.recordSuccess('gemini', [window({ limit: 1000, remaining: 0, remainingPercent: 0, resetAt: clock.now + 120_000 })])
    expect(usage.getStatus('gemini')).toBe('RATE_LIMITED')
    advance(121_000)
    expect(usage.getStatus('gemini')).toBe('AVAILABLE')
  })

  it('auth expiry persists until reconnect and success clears it', () => {
    const { usage } = setup()
    usage.recordError(new ProviderError('chatgpt', 'AUTH_EXPIRED'))
    expect(usage.getStatus('chatgpt')).toBe('AUTH_EXPIRED')
    usage.resetProvider('chatgpt')
    expect(usage.getStatus('chatgpt')).toBe('AVAILABLE')
  })

  it('offline network marks cloud providers OFFLINE but not local ones', () => {
    const { usage } = setup()
    usage.setOnline(false)
    expect(usage.getStatus('gemini')).toBe('OFFLINE')
    expect(usage.getStatus('tesseract')).toBe('AVAILABLE')
    usage.setOnline(true)
    expect(usage.getStatus('gemini')).toBe('AVAILABLE')
  })

  it('estimated resets are labelled as estimates', () => {
    const { usage, clock } = setup()
    usage.recordError(new ProviderError('gemini', 'PLAN_LIMIT', { resetAt: clock.now + 3600_000, resetIsEstimate: true }))
    expect(usage.getUsage('gemini').resetAccuracy).toBe('estimated')
  })

  it('a cancelled request does not change state', () => {
    const { usage } = setup()
    usage.recordError(new ProviderError('gemini', 'CANCELLED'))
    expect(usage.getStatus('gemini')).toBe('AVAILABLE')
    expect(usage.getLastError('gemini')).toBeUndefined()
  })
})
