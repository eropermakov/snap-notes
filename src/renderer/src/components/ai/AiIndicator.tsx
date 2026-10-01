import { useMemo, useState, type ReactElement } from 'react'
import { isBlockingStatus, type ProviderPublicState } from '@shared/providers'
import { STATUS_LABELS, reportedRemainingPercent } from '@shared/usageFormat'
import { useAppStore } from '../../store/useAppStore'
import { ResetCountdown, statusTone, useNow } from './usageBits'
import { Button, Divider, NavRailItem, Popover, StatusDot, type BadgeTone } from '../../ui'
import { GaugeIcon, SparkleIcon } from '../icons'

const MODE_SHORT = { best: 'Качество', balanced: 'Авто', economy: 'Эконом', offline: 'Офлайн' } as const

/** Mirrors the router's choice for display only: first configured, unblocked provider by priority. */
function pickPrimary(providers: ProviderPublicState[], priority: string[], preferred: string | null): ProviderPublicState | undefined {
  const usable = providers.filter((p) => p.configured && !p.local && p.integrationEnabled)
  if (preferred) {
    const chosen = providers.find((p) => p.id === preferred && p.configured)
    if (chosen) return chosen
  }
  const sorted = [...usable].sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id))
  return sorted.find((p) => !isBlockingStatus(p.status)) ?? providers.find((p) => p.id === 'tesseract')
}

/** Rail item showing which recognition source is in use; details in a popover, full view in Settings → Использование. */
export default function AiIndicator(): ReactElement | null {
  const settings = useAppStore((s) => s.settings)
  const providers = useAppStore((s) => s.providers)
  const openSettings = useAppStore((s) => s.openSettings)
  const section = useAppStore((s) => s.section)
  const category = useAppStore((s) => s.settingsCategory)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const now = useNow(30_000)

  const primary = useMemo(
    () => (settings ? pickPrimary(providers, settings.ai.priority, settings.ai.preferredProvider) : undefined),
    [providers, settings]
  )
  if (!settings) return null
  const mode = settings.ai.mode
  const listed = providers.filter((p) => p.configured || p.local || (p.id === 'chatgpt' && p.connection.connected))
  const cloud = mode !== 'offline' && primary && !primary.local ? primary : undefined

  let summary: string
  if (!cloud) summary = 'Tesseract'
  else {
    const remaining = reportedRemainingPercent(cloud.usage.windows, now)
    summary = `${cloud.name}${remaining !== undefined ? ` · ${Math.round(remaining)}%` : ''}`
  }
  const tone: BadgeTone = cloud ? statusTone(cloud.status) : 'neutral'
  const inUsage = section === 'settings' && (category === 'usage' || category === 'recognition' || category === 'providers')

  return (
    <>
      <NavRailItem
        ref={setAnchor}
        label={`ИИ: ${MODE_SHORT[mode]} · ${summary}`}
        icon={<SparkleIcon className="h-5 w-5" />}
        active={open || inUsage}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        badge={
          tone !== 'neutral' ? (
            <span
              className={`absolute right-2 top-2 h-2 w-2 rounded-full ring-2 ring-[var(--bg-secondary)] ${
                tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-danger'
              }`}
            />
          ) : undefined
        }
      />
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} placement="right-end" offset={10} className="w-72 p-1.5" aria-label="Распознавание">
        <div className="px-2.5 pb-2 pt-2">
          <p className="text-xs font-medium text-fg-muted">Распознавание</p>
          <p className="mt-1 text-md font-semibold text-fg">
            {MODE_SHORT[mode]} · {cloud ? cloud.name : 'Tesseract'}
          </p>
        </div>
        <Divider className="mx-1" />
        <div className="max-h-64 overflow-y-auto px-2.5 py-2">
          {listed.map((p) => {
            const remaining = reportedRemainingPercent(p.usage.windows, now)
            const reset = p.usage.resetAt && p.usage.resetAt > now ? p.usage.resetAt : undefined
            return (
              <div key={p.id} className="py-1.5">
                <div className="flex items-center justify-between gap-3">
                  <StatusDot tone={p.local ? 'neutral' : statusTone(p.status)}>
                    <span className="text-base text-fg">{p.name}</span>
                  </StatusDot>
                  <span className="tabular text-sm text-fg-secondary">
                    {p.local ? 'без ограничений' : remaining !== undefined ? `${Math.round(remaining)}%` : STATUS_LABELS[p.status]}
                  </span>
                </div>
                {reset && (
                  <p className="mt-0.5 pl-3 text-xs text-fg-muted">
                    <ResetCountdown resetAt={reset} accuracy={p.usage.resetAccuracy} providerId={p.id} />
                  </p>
                )}
              </div>
            )
          })}
        </div>
        <Divider className="mx-1" />
        <div className="flex gap-1 p-1">
          <Button
            variant="ghost"
            size="sm"
            icon={<GaugeIcon className="h-4 w-4" />}
            className="flex-1 justify-start"
            onClick={() => {
              setOpen(false)
              openSettings('usage')
            }}
          >
            Использование
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start"
            onClick={() => {
              setOpen(false)
              openSettings('recognition')
            }}
          >
            Настройки ИИ
          </Button>
        </div>
      </Popover>
    </>
  )
}
