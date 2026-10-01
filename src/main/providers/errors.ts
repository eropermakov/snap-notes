import type { ProviderErrorCode, ProviderErrorInfo, ProviderId } from '../../shared/providers'

const USER_MESSAGES: Record<ProviderErrorCode, string> = {
  AUTH: 'Ключ или вход не приняты. Проверьте подключение в настройках.',
  AUTH_EXPIRED: 'Срок входа истёк. Подключитесь заново.',
  NO_PERMISSION: 'Нет разрешения на этот запрос.',
  RATE_LIMIT: 'Слишком много запросов. Нужно немного подождать.',
  PLAN_LIMIT: 'Лимит использования исчерпан.',
  INSUFFICIENT_CREDITS: 'Недостаточно средств или кредитов на счёте.',
  MODEL_UNAVAILABLE: 'Выбранная модель недоступна.',
  NETWORK: 'Нет связи с сервисом.',
  TIMEOUT: 'Сервис не ответил вовремя.',
  INVALID_RESPONSE: 'Сервис вернул некорректный ответ.',
  PROVIDER_DOWN: 'Сервис временно недоступен.',
  CANCELLED: 'Запрос отменён.',
  UNSUPPORTED: 'Этот источник не поддерживает такой запрос.',
  UNKNOWN: 'Неизвестная ошибка.'
}

export function defaultMessage(code: ProviderErrorCode): string {
  return USER_MESSAGES[code]
}

export interface ProviderErrorOptions {
  message?: string
  /** Seconds, from an official retry-after header or equivalent response field. */
  retryAfter?: number
  /** UTC ms, only when the provider reported it (or a documented policy, see resetAccuracy). */
  resetAt?: number
  /** resetAt follows a documented provider policy rather than a response field (shown with "~"). */
  resetIsEstimate?: boolean
  canFallback?: boolean
  /** Kept in the main process for logs; never sent to the renderer. */
  originalError?: unknown
  /** HTTP status, when there was one. */
  status?: number
}

/** The only error type provider implementations may throw. The UI works with these codes, never SDK text. */
export class ProviderError extends Error {
  readonly provider: ProviderId
  readonly code: ProviderErrorCode
  readonly retryAfter?: number
  readonly resetAt?: number
  readonly resetIsEstimate: boolean
  readonly canFallback: boolean
  readonly originalError?: unknown
  readonly status?: number

  constructor(provider: ProviderId, code: ProviderErrorCode, options: ProviderErrorOptions = {}) {
    super(options.message ?? USER_MESSAGES[code])
    this.name = 'ProviderError'
    this.provider = provider
    this.code = code
    this.retryAfter = options.retryAfter
    this.resetAt = options.resetAt
    this.resetIsEstimate = options.resetIsEstimate === true
    // Everything except a user cancellation may move on to the next provider.
    this.canFallback = options.canFallback ?? code !== 'CANCELLED'
    this.originalError = options.originalError
    this.status = options.status
  }

  toInfo(now = Date.now()): ProviderErrorInfo {
    return {
      provider: this.provider,
      code: this.code,
      message: this.message,
      ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      ...(this.resetAt !== undefined ? { resetAt: this.resetAt } : {}),
      canFallback: this.canFallback,
      at: now
    }
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError
}

/** Maps an HTTP status (plus optional body code) to a normalized code. Shared by the REST providers. */
export function codeFromHttpStatus(status: number): ProviderErrorCode {
  if (status === 401) return 'AUTH'
  if (status === 403) return 'NO_PERMISSION'
  if (status === 402) return 'INSUFFICIENT_CREDITS'
  if (status === 404) return 'MODEL_UNAVAILABLE'
  if (status === 408) return 'TIMEOUT'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 500) return 'PROVIDER_DOWN'
  return 'UNKNOWN'
}

/** Normalizes a thrown fetch/abort/unknown error. */
export function normalizeThrown(provider: ProviderId, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string } }
  const name = e?.name ?? ''
  const message = String(e?.message ?? '')
  const code = String(e?.code ?? e?.cause?.code ?? '')
  if (name === 'AbortError' && /user|cancel/i.test(message)) return new ProviderError(provider, 'CANCELLED', { originalError: err })
  if (name === 'TimeoutError' || /timeout|timed out/i.test(message)) return new ProviderError(provider, 'TIMEOUT', { originalError: err })
  if (name === 'AbortError') return new ProviderError(provider, 'CANCELLED', { originalError: err })
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH|UND_ERR/i.test(code) ||
    /fetch failed|network|getaddrinfo|socket/i.test(message)
  ) {
    return new ProviderError(provider, 'NETWORK', { originalError: err })
  }
  return new ProviderError(provider, 'UNKNOWN', { originalError: err })
}
