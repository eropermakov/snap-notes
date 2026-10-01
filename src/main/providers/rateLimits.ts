import type { UsageMeasurement, UsageWindow } from '../../shared/providers'

/** Anything that can look up a response header case-insensitively. */
export type HeaderSource = Headers | Record<string, string | string[] | undefined> | null | undefined

export function getHeader(headers: HeaderSource, name: string): string | undefined {
  if (!headers) return undefined
  if (typeof (headers as Headers).get === 'function') {
    const value = (headers as Headers).get(name)
    return value === null ? undefined : value
  }
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (key.toLowerCase() !== lower) continue
    if (Array.isArray(value)) return value[0]
    return value ?? undefined
  }
  return undefined
}

/**
 * Parses Go-style durations used by OpenAI and Groq reset headers: "1s", "6m0s", "20ms",
 * "2m59.56s", "1h2m3s", "7.66s". A bare number is treated as seconds. Returns seconds.
 */
export function parseDurationSeconds(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const text = value.trim()
  if (!text) return undefined
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/g
  let total = 0
  let consumed = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const amount = Number(match[1])
    const unit = match[2]
    total += unit === 'h' ? amount * 3600 : unit === 'm' ? amount * 60 : unit === 's' ? amount : amount / 1000
    consumed += match[0].length
  }
  if (consumed === 0 || consumed !== text.length) return undefined
  return total
}

/** retry-after: delta-seconds or an HTTP date. Returns seconds (>= 0). */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (value === undefined) return undefined
  const text = value.trim()
  if (!text) return undefined
  const seconds = Number(text)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds
  const date = Date.parse(text)
  if (Number.isFinite(date)) return Math.max(0, (date - now) / 1000)
  return undefined
}

function parseCount(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value.trim().replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function parseRfc3339(value: string | undefined): number | undefined {
  if (!value) return undefined
  const ms = Date.parse(value.trim())
  return Number.isFinite(ms) ? ms : undefined
}

interface WindowInput {
  id: string
  label: string
  measurement: UsageMeasurement
  limit?: number
  remaining?: number
  resetAt?: number
  now: number
}

/** Builds a provider-reported window. Returns null when the provider sent neither limit nor remaining. */
export function buildWindow(input: WindowInput): UsageWindow | null {
  const { limit, remaining, resetAt, now } = input
  if (limit === undefined && remaining === undefined) return null
  const window: UsageWindow = {
    id: input.id,
    label: input.label,
    measurement: input.measurement,
    accuracy: 'provider_reported'
  }
  if (limit !== undefined) window.limit = limit
  if (remaining !== undefined) window.remaining = remaining
  if (limit !== undefined && remaining !== undefined && limit > 0) {
    const clampedRemaining = Math.min(Math.max(remaining, 0), limit)
    window.used = limit - clampedRemaining
    window.remainingPercent = (clampedRemaining / limit) * 100
    window.usedPercent = 100 - window.remainingPercent
  }
  if (resetAt !== undefined) {
    window.resetAt = resetAt
    window.resetInSeconds = Math.max(0, Math.round((resetAt - now) / 1000))
  }
  return window
}

function durationReset(headers: HeaderSource, name: string, now: number): number | undefined {
  const seconds = parseDurationSeconds(getHeader(headers, name))
  return seconds === undefined ? undefined : now + seconds * 1000
}

/**
 * OpenAI API: x-ratelimit-{limit,remaining,reset}-{requests,tokens} plus project-scoped variants
 * (x-ratelimit-*-project-{requests,tokens}) when present. Missing headers produce no window.
 */
export function parseOpenAiRateLimits(headers: HeaderSource, now = Date.now()): UsageWindow[] {
  const windows: UsageWindow[] = []
  const scopes: { prefix: string; idPrefix: string; labelSuffix: string }[] = [
    { prefix: '', idPrefix: '', labelSuffix: '' },
    { prefix: 'project-', idPrefix: 'project-', labelSuffix: ' (проект)' }
  ]
  for (const scope of scopes) {
    for (const kind of ['requests', 'tokens'] as const) {
      const window = buildWindow({
        id: `${scope.idPrefix}${kind}`,
        label: `${kind === 'requests' ? 'Запросы' : 'Токены'}${scope.labelSuffix}`,
        measurement: kind,
        limit: parseCount(getHeader(headers, `x-ratelimit-limit-${scope.prefix}${kind}`)),
        remaining: parseCount(getHeader(headers, `x-ratelimit-remaining-${scope.prefix}${kind}`)),
        resetAt: durationReset(headers, `x-ratelimit-reset-${scope.prefix}${kind}`, now),
        now
      })
      if (window) windows.push(window)
    }
  }
  return windows
}

/**
 * Groq: same header names as OpenAI, but documented as requests-per-day (RPD) and tokens-per-minute (TPM).
 */
export function parseGroqRateLimits(headers: HeaderSource, now = Date.now()): UsageWindow[] {
  const windows: UsageWindow[] = []
  const requests = buildWindow({
    id: 'requests-day',
    label: 'Запросы в сутки',
    measurement: 'requests',
    limit: parseCount(getHeader(headers, 'x-ratelimit-limit-requests')),
    remaining: parseCount(getHeader(headers, 'x-ratelimit-remaining-requests')),
    resetAt: durationReset(headers, 'x-ratelimit-reset-requests', now),
    now
  })
  if (requests) windows.push(requests)
  const tokens = buildWindow({
    id: 'tokens-minute',
    label: 'Токены в минуту',
    measurement: 'tokens',
    limit: parseCount(getHeader(headers, 'x-ratelimit-limit-tokens')),
    remaining: parseCount(getHeader(headers, 'x-ratelimit-remaining-tokens')),
    resetAt: durationReset(headers, 'x-ratelimit-reset-tokens', now),
    now
  })
  if (tokens) windows.push(tokens)
  return windows
}

/** Anthropic API: anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset} (reset is RFC 3339). */
export function parseAnthropicRateLimits(headers: HeaderSource, now = Date.now()): UsageWindow[] {
  const kinds: { key: string; label: string; measurement: UsageMeasurement }[] = [
    { key: 'requests', label: 'Запросы', measurement: 'requests' },
    { key: 'tokens', label: 'Токены', measurement: 'tokens' },
    { key: 'input-tokens', label: 'Входные токены', measurement: 'tokens' },
    { key: 'output-tokens', label: 'Выходные токены', measurement: 'tokens' }
  ]
  const windows: UsageWindow[] = []
  for (const kind of kinds) {
    const window = buildWindow({
      id: kind.key,
      label: kind.label,
      measurement: kind.measurement,
      limit: parseCount(getHeader(headers, `anthropic-ratelimit-${kind.key}-limit`)),
      remaining: parseCount(getHeader(headers, `anthropic-ratelimit-${kind.key}-remaining`)),
      resetAt: parseRfc3339(getHeader(headers, `anthropic-ratelimit-${kind.key}-reset`)),
      now
    })
    if (window) windows.push(window)
  }
  return windows
}

export interface GeminiQuotaInfo {
  /** Seconds, from google.rpc.RetryInfo.retryDelay. */
  retryDelaySeconds?: number
  quotaIds: string[]
  quotaMetrics: string[]
  quotaValues: number[]
  /** A violated quota is a per-day quota (resets at midnight Pacific time per Gemini docs). */
  perDay: boolean
}

/**
 * Extracts google.rpc.RetryInfo / QuotaFailure details from a Gemini 429 error body. The SDK puts the
 * JSON body in the error message, so this accepts either a parsed object or a string containing JSON.
 */
export function parseGeminiQuotaError(body: unknown): GeminiQuotaInfo | null {
  let value: unknown = body
  if (typeof value === 'string') {
    const start = value.indexOf('{')
    const end = value.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      value = JSON.parse(value.slice(start, end + 1))
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const error = (root.error && typeof root.error === 'object' ? root.error : root) as Record<string, unknown>
  const details = Array.isArray(error.details) ? error.details : []
  const info: GeminiQuotaInfo = { quotaIds: [], quotaMetrics: [], quotaValues: [], perDay: false }
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue
    const d = detail as Record<string, unknown>
    const type = String(d['@type'] ?? '')
    if (type.endsWith('google.rpc.RetryInfo') && typeof d.retryDelay === 'string') {
      const seconds = parseDurationSeconds(d.retryDelay)
      if (seconds !== undefined) info.retryDelaySeconds = seconds
    }
    if (type.endsWith('google.rpc.QuotaFailure') && Array.isArray(d.violations)) {
      for (const violation of d.violations) {
        if (!violation || typeof violation !== 'object') continue
        const v = violation as Record<string, unknown>
        if (typeof v.quotaId === 'string') info.quotaIds.push(v.quotaId)
        if (typeof v.quotaMetric === 'string') info.quotaMetrics.push(v.quotaMetric)
        const quotaValue = Number(v.quotaValue)
        if (Number.isFinite(quotaValue)) info.quotaValues.push(quotaValue)
      }
    }
  }
  info.perDay = info.quotaIds.some((id) => /PerDay/i.test(id))
  if (info.retryDelaySeconds === undefined && info.quotaIds.length === 0) return null
  return info
}

/** Next midnight in America/Los_Angeles as UTC ms (Gemini documents daily quotas resetting then). */
export function nextPacificMidnight(now = Date.now()): number {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  })
  const parts = Object.fromEntries(format.formatToParts(new Date(now)).map((p) => [p.type, p.value]))
  const secondsIntoDay = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)
  return now + (86400 - secondsIntoDay) * 1000 - (now % 1000)
}
