import type { ProviderErrorCode, ProviderStatus, RoutingNotice, UsageAccuracy, UsageWindow } from './providers'

/** "2 ч 13 мин", "5 мин", "40 с" — compact Russian duration. */
export function formatDurationShort(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return hours > 0 ? `${days} д ${hours} ч` : `${days} д`
  if (hours > 0) return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`
  if (minutes > 0) return `${minutes} мин`
  return `${seconds} с`
}

/** Live countdown "02:14:37" (hours may exceed 24). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

/** Local wall-clock reset, e.g. "сегодня в 21:00" or "30 сент. в 21:00". Stored value is UTC ms. */
export function formatResetClock(resetAt: number, now = Date.now()): string {
  const date = new Date(resetAt)
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const today = new Date(now)
  const sameDay = date.toDateString() === today.toDateString()
  if (sameDay) return `сегодня в ${time}`
  const tomorrow = new Date(now + 86400000)
  if (date.toDateString() === tomorrow.toDateString()) return `завтра в ${time}`
  return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} в ${time}`
}

/** Prefix for values that Snap Notes estimated rather than the provider reported. */
export function accuracyPrefix(accuracy: UsageAccuracy | undefined): string {
  return accuracy === 'estimated' ? '~' : ''
}

const CODE_SHORT: Record<ProviderErrorCode, string> = {
  AUTH: 'нужен вход',
  AUTH_EXPIRED: 'вход истёк',
  NO_PERMISSION: 'нет доступа',
  RATE_LIMIT: 'лимит запросов',
  PLAN_LIMIT: 'лимит исчерпан',
  INSUFFICIENT_CREDITS: 'нет средств',
  MODEL_UNAVAILABLE: 'модель недоступна',
  NETWORK: 'нет связи',
  TIMEOUT: 'не ответил',
  INVALID_RESPONSE: 'некорректный ответ',
  PROVIDER_DOWN: 'недоступен',
  CANCELLED: 'отменено',
  UNSUPPORTED: 'не поддерживает',
  UNKNOWN: 'ошибка'
}

export function errorCodeShort(code: ProviderErrorCode): string {
  return CODE_SHORT[code]
}

export const STATUS_LABELS: Record<ProviderStatus, string> = {
  AVAILABLE: 'Доступен',
  LIMIT_LOW: 'Лимит заканчивается',
  LIMIT_REACHED: 'Лимит исчерпан',
  RATE_LIMITED: 'Временный лимит',
  AUTH_REQUIRED: 'Не подключён',
  AUTH_EXPIRED: 'Нужно войти снова',
  UNAVAILABLE: 'Недоступен',
  OFFLINE: 'Нет сети',
  ERROR: 'Ошибка',
  UNKNOWN: 'Неизвестно'
}

/**
 * One line for a toast after a fallback, e.g.
 * "Распознано: Gemini · ChatGPT: лимит исчерпан, сброс через 2 ч 13 мин".
 * Only provider-reported reset times appear here.
 */
export function formatRoutingNotice(notice: RoutingNotice, now = Date.now()): string {
  if (notice.offlineFallback) {
    return 'Облачное распознавание недоступно. Использован офлайн-режим.'
  }
  const parts = notice.skipped.map((s) => {
    const reset = s.resetAt && s.resetAt > now ? `, сброс через ${formatDurationShort(s.resetAt - now)}` : ''
    return `${s.name}: ${errorCodeShort(s.code)}${reset}`
  })
  return [`Распознано: ${notice.usedProviderName}`, ...parts].join(' · ')
}

/**
 * Lowest remaining percentage the provider itself reported, ignoring per-minute buckets that are
 * about to refill. undefined = not known; the UI must then not show any percentage.
 */
export function reportedRemainingPercent(windows: UsageWindow[], now = Date.now()): number | undefined {
  let lowest: number | undefined
  for (const w of windows) {
    if (w.remainingPercent === undefined) continue
    if (w.accuracy !== 'exact' && w.accuracy !== 'provider_reported') continue
    if (w.resetAt !== undefined && w.resetAt - now <= 60_000) continue
    lowest = lowest === undefined ? w.remainingPercent : Math.min(lowest, w.remainingPercent)
  }
  return lowest
}

/** "Обновлено 32 с назад" / "Обновлено 5 мин назад". */
export function formatUpdatedAgo(updatedAt: number, now = Date.now()): string {
  const diff = Math.max(0, now - updatedAt)
  if (diff < 10_000) return 'Обновлено только что'
  return `Обновлено ${formatDurationShort(diff)} назад`
}

export function formatCount(value: number): string {
  return value.toLocaleString('ru-RU')
}
