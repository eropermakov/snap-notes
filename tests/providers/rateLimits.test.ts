import { describe, expect, it } from 'vitest'
import {
  nextPacificMidnight,
  parseAnthropicRateLimits,
  parseDurationSeconds,
  parseGeminiQuotaError,
  parseGroqRateLimits,
  parseOpenAiRateLimits,
  parseRetryAfter
} from '../../src/main/providers/rateLimits'

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0)

describe('parseDurationSeconds', () => {
  it.each([
    ['1s', 1],
    ['6m0s', 360],
    ['20ms', 0.02],
    ['2m59.56s', 179.56],
    ['7.66s', 7.66],
    ['1h2m3s', 3723],
    ['17', 17]
  ])('%s → %f seconds', (input, expected) => {
    expect(parseDurationSeconds(input)).toBeCloseTo(expected, 5)
  })

  it('rejects garbage instead of guessing', () => {
    expect(parseDurationSeconds('soon')).toBeUndefined()
    expect(parseDurationSeconds('5 minutes')).toBeUndefined()
    expect(parseDurationSeconds('')).toBeUndefined()
    expect(parseDurationSeconds(undefined)).toBeUndefined()
  })
})

describe('parseRetryAfter', () => {
  it('reads delta-seconds and HTTP dates', () => {
    expect(parseRetryAfter('2', NOW)).toBe(2)
    expect(parseRetryAfter(new Date(NOW + 30_000).toUTCString(), NOW)).toBeCloseTo(30, 0)
    expect(parseRetryAfter('nonsense', NOW)).toBeUndefined()
  })
})

describe('OpenAI rate-limit headers', () => {
  it('parses the documented example exactly', () => {
    const headers = new Headers({
      'x-ratelimit-limit-requests': '60',
      'x-ratelimit-limit-tokens': '150000',
      'x-ratelimit-remaining-requests': '59',
      'x-ratelimit-remaining-tokens': '149984',
      'x-ratelimit-reset-requests': '1s',
      'x-ratelimit-reset-tokens': '6m0s'
    })
    const windows = parseOpenAiRateLimits(headers, NOW)
    const requests = windows.find((w) => w.id === 'requests')!
    const tokens = windows.find((w) => w.id === 'tokens')!
    expect(requests).toMatchObject({ limit: 60, remaining: 59, used: 1, measurement: 'requests', accuracy: 'provider_reported' })
    expect(requests.resetAt).toBe(NOW + 1000)
    expect(tokens).toMatchObject({ limit: 150000, remaining: 149984, used: 16 })
    expect(tokens.resetAt).toBe(NOW + 360_000)
    expect(tokens.remainingPercent).toBeCloseTo(99.989, 2)
  })

  it('includes project-scoped limits when present', () => {
    const headers = new Headers({
      'x-ratelimit-limit-project-tokens': '60000',
      'x-ratelimit-remaining-project-tokens': '57000',
      'x-ratelimit-reset-project-tokens': '3s'
    })
    const windows = parseOpenAiRateLimits(headers, NOW)
    expect(windows).toHaveLength(1)
    expect(windows[0]).toMatchObject({ id: 'project-tokens', limit: 60000, remaining: 57000, resetAt: NOW + 3000 })
  })

  it('returns no windows when headers are missing (never invents numbers)', () => {
    expect(parseOpenAiRateLimits(new Headers(), NOW)).toEqual([])
    expect(parseOpenAiRateLimits(undefined, NOW)).toEqual([])
  })

  it('handles partial headers: remaining without limit has no percentages', () => {
    const windows = parseOpenAiRateLimits({ 'X-RateLimit-Remaining-Requests': '5' }, NOW)
    expect(windows).toHaveLength(1)
    expect(windows[0].remaining).toBe(5)
    expect(windows[0].limit).toBeUndefined()
    expect(windows[0].remainingPercent).toBeUndefined()
    expect(windows[0].resetAt).toBeUndefined()
  })

  it('ignores malformed values', () => {
    const windows = parseOpenAiRateLimits({ 'x-ratelimit-limit-requests': 'lots', 'x-ratelimit-reset-requests': '??' }, NOW)
    expect(windows).toEqual([])
  })
})

describe('Groq rate-limit headers', () => {
  it('labels requests as per day and tokens as per minute (Groq docs)', () => {
    const headers = new Headers({
      'x-ratelimit-limit-requests': '14400',
      'x-ratelimit-limit-tokens': '18000',
      'x-ratelimit-remaining-requests': '14370',
      'x-ratelimit-remaining-tokens': '17997',
      'x-ratelimit-reset-requests': '2m59.56s',
      'x-ratelimit-reset-tokens': '7.66s'
    })
    const [requests, tokens] = parseGroqRateLimits(headers, NOW)
    expect(requests).toMatchObject({ id: 'requests-day', limit: 14400, remaining: 14370 })
    expect(requests.resetAt).toBe(NOW + 179_560)
    expect(tokens).toMatchObject({ id: 'tokens-minute', limit: 18000, remaining: 17997 })
  })
})

describe('Anthropic rate-limit headers', () => {
  it('parses RFC 3339 resets and all documented buckets', () => {
    const reset = '2026-09-30T12:01:00Z'
    const headers = new Headers({
      'anthropic-ratelimit-requests-limit': '50',
      'anthropic-ratelimit-requests-remaining': '49',
      'anthropic-ratelimit-requests-reset': reset,
      'anthropic-ratelimit-input-tokens-limit': '40000',
      'anthropic-ratelimit-input-tokens-remaining': '39000',
      'anthropic-ratelimit-input-tokens-reset': reset
    })
    const windows = parseAnthropicRateLimits(headers, NOW)
    expect(windows.map((w) => w.id)).toEqual(['requests', 'input-tokens'])
    expect(windows[0].resetAt).toBe(Date.parse(reset))
    expect(windows[0].resetInSeconds).toBe(60)
  })
})

describe('Gemini quota errors', () => {
  const body = JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '250' }]
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' }
      ]
    }
  })

  it('reads RetryInfo and QuotaFailure from the SDK error message', () => {
    const info = parseGeminiQuotaError(`got status: 429 Too Many Requests. ${body}`)!
    expect(info.retryDelaySeconds).toBe(34)
    expect(info.perDay).toBe(true)
    expect(info.quotaValues).toEqual([250])
  })

  it('returns null for unrelated errors', () => {
    expect(parseGeminiQuotaError('socket hang up')).toBeNull()
    expect(parseGeminiQuotaError({ error: { details: [] } })).toBeNull()
  })

  it('computes the next midnight in Pacific time', () => {
    // 12:00 UTC on Sep 30 = 05:00 PDT → midnight PDT is 07:00 UTC on Oct 1.
    expect(nextPacificMidnight(NOW)).toBe(Date.UTC(2026, 9, 1, 7, 0, 0))
  })
})
