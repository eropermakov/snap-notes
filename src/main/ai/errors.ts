export type AiErrorKind = 'no-key' | 'invalid-key' | 'quota' | 'network' | 'timeout' | 'unknown'

export class AiError extends Error {
  kind: AiErrorKind
  constructor(kind: AiErrorKind, message: string) {
    super(message)
    this.kind = kind
    this.name = 'AiError'
  }
}

export function classifyError(err: unknown): AiError {
  const anyErr = err as { status?: number; code?: string | number; message?: string }
  const message = String(anyErr?.message ?? err ?? '')
  const status = anyErr?.status ?? anyErr?.code

  if (
    status === 401 ||
    status === 403 ||
    /api key not valid|invalid.*api.?key|api_key_invalid|permission_denied|unauthorized/i.test(message)
  ) {
    return new AiError('invalid-key', 'Неверный API-ключ. Проверьте ключ в настройках.')
  }
  if (status === 429 || /quota|rate limit|resource_exhausted|too many requests/i.test(message)) {
    return new AiError('quota', 'Превышен лимит запросов. Попробуйте позже или переключитесь на другой ключ.')
  }
  if (/enotfound|econnrefused|eai_again|network|failed to fetch|fetch failed|getaddrinfo/i.test(message)) {
    return new AiError('network', 'Нет подключения к интернету или сервис недоступен.')
  }
  if (/timeout|aborted/i.test(message)) {
    return new AiError('timeout', 'Превышено время ожидания ответа.')
  }
  return new AiError('unknown', `Ошибка распознавания: ${message || 'неизвестная ошибка'}`)
}

export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AiError('timeout', timeoutMessage))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
