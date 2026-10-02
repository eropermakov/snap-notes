import { useEffect, useRef, useState, type ReactElement } from 'react'
import { StatusDot, type BadgeTone } from '../../ui'
import type { ProviderId, ProviderPublicState, ProviderStatus, UsageAccuracy, UsageWindow } from '@shared/providers'
import {
  STATUS_LABELS,
  accuracyPrefix,
  formatCount,
  formatCountdown,
  formatResetClock
} from '@shared/usageFormat'

/** Re-renders every `intervalMs` with the current time. Purely local: no network. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

interface CountdownProps {
  resetAt: number
  accuracy?: UsageAccuracy
  providerId: ProviderId
  prefix?: string
  className?: string
}

/**
 * "Сброс через 02:14:37". Counts down locally from the stored UTC timestamp; when it reaches zero it
 * asks the main process for one ordinary status refresh (the provider then rejoins the pool).
 */
export function ResetCountdown({ resetAt, accuracy, providerId, prefix = 'Сброс через', className }: CountdownProps): ReactElement {
  const now = useNow(1000)
  const refreshed = useRef(false)
  const remaining = resetAt - now

  useEffect(() => {
    if (remaining <= 0 && !refreshed.current) {
      refreshed.current = true
      void window.api.providers.refreshUsage(providerId)
    }
  }, [remaining, providerId])

  const estimated = accuracy === 'estimated'
  if (remaining <= 0) return <span className={className}>Лимит обновляется…</span>
  return (
    <span
      className={className}
      title={`${formatResetClock(resetAt, now)}${estimated ? ' — оценка Snap Notes по документации провайдера' : ''}`}
    >
      {prefix} {accuracyPrefix(accuracy)}
      <span className="font-mono tabular-nums">{formatCountdown(remaining)}</span>
    </span>
  )
}

export function statusTone(status: ProviderStatus): BadgeTone {
  switch (status) {
    case 'AVAILABLE':
      return 'success'
    case 'LIMIT_LOW':
    case 'RATE_LIMITED':
    case 'UNAVAILABLE':
      return 'warning'
    case 'LIMIT_REACHED':
    case 'AUTH_EXPIRED':
    case 'ERROR':
      return 'danger'
    default:
      return 'neutral'
  }
}

/** Quiet status: coloured dot + text, no pill. */
export function StatusPill({ status, label }: { status: ProviderStatus; label?: string }): ReactElement {
  return <StatusDot tone={statusTone(status)}>{label ?? STATUS_LABELS[status]}</StatusDot>
}

/** One usage window. Bars and numbers appear only for values the provider actually reported. */
export function UsageWindowRow({ window: w, providerId }: { window: UsageWindow; providerId: ProviderId }): ReactElement {
  const estimated = w.accuracy === 'estimated'
  const hasPercent = w.usedPercent !== undefined && w.remainingPercent !== undefined
  const unit = w.measurement === 'tokens' ? 'токенов' : w.measurement === 'requests' ? 'запросов' : ''
  return (
    <div className="py-2" title={estimated ? 'Оценка Snap Notes' : 'Сообщено провайдером'}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-fg">{w.label}</span>
        {w.remaining !== undefined && (
          <span className="tabular text-fg-secondary">
            {accuracyPrefix(w.accuracy)}
            {formatCount(w.remaining)}
            {w.limit !== undefined ? ` / ${formatCount(w.limit)}` : ''} {unit} осталось
          </span>
        )}
      </div>
      {hasPercent && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full ${(w.remainingPercent ?? 100) < 20 ? 'bg-warning' : 'bg-fg-secondary'}`}
            style={{ width: `${Math.min(100, Math.max(0, w.usedPercent ?? 0))}%` }}
          />
        </div>
      )}
      <div className="tabular mt-1 flex justify-between text-xs text-fg-muted">
        {hasPercent ? (
          <span>
            {accuracyPrefix(w.accuracy)}
            {Math.round(w.usedPercent!)}% использовано · {accuracyPrefix(w.accuracy)}
            {Math.round(w.remainingPercent!)}% осталось
          </span>
        ) : (
          <span />
        )}
        {w.resetAt !== undefined && <ResetCountdown resetAt={w.resetAt} accuracy={w.accuracy} providerId={providerId} />}
      </div>
    </div>
  )
}

const MEASURE_UNIT: Record<string, string> = { tokens: 'токенов', requests: 'запросов', credits: 'кредитов' }

/**
 * One line for the collapsed provider card. Numbers appear only when the provider reported them;
 * otherwise the line says so and shows Snap Notes' own counter, clearly labelled as local.
 */
export function UsageSummaryLine({ provider }: { provider: ProviderPublicState }): ReactElement | null {
  const now = useNow(5000)
  const usage = provider.usage
  if (provider.local || !provider.configured) return null
  const reported = usage.windows
    .filter((w) => (w.accuracy === 'exact' || w.accuracy === 'provider_reported') && w.remaining !== undefined)
    // The scarcest window is the one worth showing.
    .sort((a, b) => (a.remainingPercent ?? 100) - (b.remainingPercent ?? 100))[0]
  const blocked = usage.resetAt !== undefined && usage.resetAt > now
  const parts: ReactElement[] = []

  if (reported) {
    parts.push(
      <span key="rem" className="tabular text-fg">
        {accuracyPrefix(reported.accuracy)}
        {formatCount(reported.remaining!)} {MEASURE_UNIT[reported.measurement] ?? ''} осталось
      </span>
    )
  } else if (usage.allocation) {
    parts.push(<span key="alloc">{usage.allocation.label}</span>)
  } else if (usage.credits?.balance !== undefined) {
    parts.push(
      <span key="credits" className="tabular text-fg">
        Баланс: {usage.credits.balance.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} {usage.credits.currency ?? ''}
      </span>
    )
  } else if (provider.localUsage) {
    parts.push(
      <span key="local" title="Считает сам Snap Notes. Это не остаток лимита у провайдера.">
        Локально сегодня: {formatCount(provider.localUsage.requests)} запр.
      </span>
    )
  } else {
    parts.push(<span key="none">Остаток не сообщается</span>)
  }

  const resetAt = blocked ? usage.resetAt : (reported?.resetAt ?? usage.allocation?.resetAt)
  const resetAccuracy = blocked ? usage.resetAccuracy : reported ? reported.accuracy : 'estimated'
  if (resetAt !== undefined && resetAt > now) {
    parts.push(<ResetCountdown key="reset" resetAt={resetAt} accuracy={resetAccuracy} providerId={provider.id} prefix="Сброс через" />)
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-secondary">
      {parts.map((part, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden className="text-fg-muted">·</span>}
          {part}
        </span>
      ))}
    </p>
  )
}
