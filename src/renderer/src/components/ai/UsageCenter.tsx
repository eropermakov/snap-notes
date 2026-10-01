import { useEffect, useState, type ReactElement } from 'react'
import type { ActivitySummary, ProviderPublicState } from '@shared/providers'
import { PROVIDER_NAMES } from '@shared/providers'
import { formatCount, reportedRemainingPercent } from '@shared/usageFormat'
import { useAppStore } from '../../store/useAppStore'
import { EmptyState, LinkButton, Section } from '../../ui'
import { ExternalLinkIcon } from '../icons'
import { ProviderUsageBlock } from './ProviderCard'
import { StatusPill, useNow } from './usageBits'

function UsageRow({ provider }: { provider: ProviderPublicState }): ReactElement {
  const now = useNow(5000)
  const remaining = reportedRemainingPercent(provider.usage.windows, now)
  const connection = provider.connection
  const subtitle =
    provider.id === 'chatgpt'
      ? connection.connected
        ? connection.planUsageEnabled
          ? `Подключён${connection.accountEmail ? ` · ${connection.accountEmail}` : ''} · используется план ChatGPT`
          : 'Подключён · использование плана не разрешено'
        : 'Не подключён'
      : provider.id === 'claude'
        ? 'Недоступно для сторонних приложений'
        : provider.local
          ? 'Офлайн · без ограничений'
          : provider.configured
            ? 'Подключён'
            : 'Не настроен'

  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-base font-medium text-fg">{provider.name}</p>
          <p className="text-sm text-fg-secondary">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {remaining !== undefined && (
            <span className="tabular text-base font-medium text-fg" title="Сообщено провайдером">
              {Math.round(remaining)}% осталось
            </span>
          )}
          {provider.integrationEnabled && <StatusPill status={provider.status} />}
        </div>
      </div>
      {provider.id === 'claude' ? (
        <p className="mt-2 text-sm text-fg-secondary">{provider.integrationNote}</p>
      ) : (
        <ProviderUsageBlock provider={provider} />
      )}
      {!provider.local && (provider.configured || provider.id === 'chatgpt' || provider.id === 'claude') && (
        <div className="mt-2">
          <LinkButton onClick={() => void window.api.providers.openManageUsage(provider.id)}>
            {provider.id === 'chatgpt'
              ? 'Открыть использование ChatGPT'
              : provider.id === 'claude'
                ? 'Открыть использование Claude'
                : 'Управление использованием'}
            <ExternalLinkIcon className="h-3 w-3" />
          </LinkButton>
        </div>
      )}
    </div>
  )
}

/** Settings → Использование: provider-reported limits plus Snap Notes' own activity today. */
export default function UsageCenter(): ReactElement {
  const providers = useAppStore((s) => s.providers)
  const [activity, setActivity] = useState<ActivitySummary | null>(null)

  useEffect(() => {
    // Opening the Usage Center is one of the moments usage is refreshed (no paid requests).
    void window.api.providers.refreshUsage()
    void window.api.providers.activitySummary().then(setActivity)
  }, [])

  const visible = providers.filter((p) => p.configured || p.local || p.id === 'chatgpt' || p.id === 'claude')
  const activityRows = activity ? Object.entries(activity.byProvider).sort((a, b) => (b[1]?.requests ?? 0) - (a[1]?.requests ?? 0)) : []

  return (
    <>
      <Section title="Лимиты источников">
        <div className="divide-y divide-line border-y border-line">
          {visible.map((provider) => (
            <UsageRow key={provider.id} provider={provider} />
          ))}
        </div>
      </Section>

      <Section
        title="Активность Snap Notes сегодня"
        description="Сколько запросов отправил сам Snap Notes. Это не остаток лимита у провайдера — лимиты могут расходоваться и в других приложениях."
      >
        {activityRows.length === 0 ? (
          <EmptyState size="sm" title="Сегодня запросов не было" className="border-y border-line" />
        ) : (
          <table className="tabular w-full text-base">
            <thead>
              <tr className="border-b border-line text-left text-sm text-fg-secondary">
                <th className="py-2 font-normal">Источник</th>
                <th className="py-2 text-right font-normal">Запросы</th>
                <th className="py-2 text-right font-normal">Ошибки</th>
                <th className="py-2 text-right font-normal">Токены</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {activityRows.map(([id, row]) => (
                <tr key={id}>
                  <td className="py-2.5 text-fg">{PROVIDER_NAMES[id as keyof typeof PROVIDER_NAMES] ?? id}</td>
                  <td className="py-2.5 text-right text-fg">{formatCount(row?.requests ?? 0)}</td>
                  <td className="py-2.5 text-right text-fg-secondary">{formatCount(row?.failures ?? 0)}</td>
                  <td className="py-2.5 text-right text-fg-secondary">{row?.totalTokens ? formatCount(row.totalTokens) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  )
}
