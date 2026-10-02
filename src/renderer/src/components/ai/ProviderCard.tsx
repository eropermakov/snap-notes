import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type { ApiKeyProviderId, ProviderId, ProviderPublicState } from '@shared/providers'
import { PROVIDER_CATALOG, TIER_TONE } from '@shared/providerCatalog'
import { STATUS_LABELS, errorCodeShort, formatCount, formatUpdatedAgo } from '@shared/usageFormat'
import { useAppStore } from '../../store/useAppStore'
import { Badge, Button, IconButton, LinkButton, Select, cn } from '../../ui'
import { CheckIcon, ChevronRightIcon, ExternalLinkIcon, RefreshIcon, XCircleIcon } from '../icons'
import { ConnectForm, ConnectedCredentials, type Feedback } from './CredentialRows'
import { ResetCountdown, UsageSummaryLine, UsageWindowRow, statusTone, useNow } from './usageBits'
import chatgptMarkWhite from '../../assets/chatgpt/chatgpt-button-white-21.svg'

function isApiKeyProvider(id: ProviderId): id is ApiKeyProviderId {
  return PROVIDER_CATALOG[id].fields.length > 0
}

function FeedbackLine({ feedback }: { feedback: Feedback }): ReactElement | null {
  if (!feedback) return null
  return (
    <p role="status" className={`mt-3 flex items-start gap-1.5 text-sm ${feedback.ok ? 'text-success' : 'text-danger'}`}>
      {feedback.ok ? <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      {feedback.message}
    </p>
  )
}

/** Label on the left, control on the right — the same rhythm as SettingsRow, nested inside a provider. */
function DetailRow({ label, children }: { label: ReactNode; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-fg-secondary">{label}</span>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
    </div>
  )
}

/** Icon tile: two-letter monogram. Brand logos are deliberately not bundled. */
export function ProviderLogo({ id, className }: { id: ProviderId; className?: string }): ReactElement {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-strong)] bg-surface-2 text-sm font-semibold tracking-tight text-fg',
        className
      )}
    >
      {PROVIDER_CATALOG[id].monogram}
    </span>
  )
}

/** Capability words for the card. Vision is stated only when the account's models really take images. */
export function capabilityLabels(p: ProviderPublicState): string[] {
  const labels: string[] = []
  const withVision = p.models.filter((m) => m.vision === true).length
  const withoutVision = p.models.filter((m) => m.vision === false).length
  if (p.configured && p.models.length > 0) {
    // The real catalog is known: say exactly what these models can do.
    const caps = p.capabilities
    if (caps.vision && withVision > 0) {
      labels.push(withoutVision > 0 ? 'Изображения (часть моделей)' : 'Изображения', 'OCR')
    } else if (caps.ocr) {
      labels.push('OCR')
    }
    if (caps.text) labels.push('Текст')
    if (caps.tables && withVision > 0) labels.push('Таблицы')
    return labels
  }
  // Not connected yet / catalog not loaded: the provider's headline capabilities, not a guess.
  const headline = PROVIDER_CATALOG[p.id].headlineCapabilities
  if (headline.includes('vision')) labels.push('Изображения', 'OCR')
  else if (headline.includes('ocr')) labels.push('OCR')
  if (headline.includes('text')) labels.push('Текст')
  if (headline.includes('tables')) labels.push('Таблицы')
  if (headline.includes('codeRecognition')) labels.push('Код')
  return labels
}

function ModelPicker({ provider }: { provider: ProviderPublicState }): ReactElement | null {
  const settings = useAppStore((s) => s.settings)
  const updateAiSettings = useAppStore((s) => s.updateAiSettings)
  const [refreshing, setRefreshing] = useState(false)
  if (!settings || !provider.configured || provider.local) return null
  const grouped = provider.models.some((m) => m.free !== undefined)
  const option = (m: ProviderPublicState['models'][number]): ReactElement => (
    <option key={m.id} value={m.id}>
      {m.free === true ? 'FREE · ' : m.free === false ? 'PAID · ' : ''}
      {m.displayName}
      {m.vision === true ? ' · изображения' : m.vision === false ? ' · только текст' : ''}
    </option>
  )
  return (
    <DetailRow label={<label htmlFor={`model-${provider.id}`}>Модель</label>}>
      <Select
        id={`model-${provider.id}`}
        value={provider.selectedModel}
        onChange={(e) => void updateAiSettings({ models: { ...settings.ai.models, [provider.id]: e.target.value } })}
        wrapperClassName="w-[280px]"
      >
        <option value="auto">{provider.id === 'openrouter' ? 'Автоматически (бесплатные)' : 'Автоматически'}</option>
        {grouped ? (
          <>
            <optgroup label="Бесплатные">{provider.models.filter((m) => m.free === true).map(option)}</optgroup>
            <optgroup label="Платные">{provider.models.filter((m) => m.free !== true).map(option)}</optgroup>
          </>
        ) : (
          provider.models.map(option)
        )}
      </Select>
      <IconButton
        label={refreshing ? 'Обновляю список…' : 'Обновить список моделей'}
        icon={<RefreshIcon className={cn('h-4 w-4', refreshing && 'animate-spin')} />}
        disabled={refreshing}
        onClick={async () => {
          setRefreshing(true)
          await window.api.providers.refreshModels(provider.id)
          setRefreshing(false)
        }}
      />
    </DetailRow>
  )
}

/** Usage block: provider-reported windows, credits, a documented allocation, then Snap Notes' own counter (labelled local). */
export function ProviderUsageBlock({ provider, compact = false }: { provider: ProviderPublicState; compact?: boolean }): ReactElement | null {
  const now = useNow(5000)
  const usage = provider.usage
  const showReset = usage.resetAt !== undefined && usage.resetAt > now
  const windows = compact ? usage.windows.slice(0, 2) : usage.windows
  if (!provider.configured && !showReset) return null
  const hasReported = windows.length > 0 || usage.credits?.balance !== undefined
  return (
    <div className="mt-2 rounded-xl border border-line bg-canvas px-3 py-1.5">
      {showReset && (
        <p className="py-1.5 text-sm font-medium text-fg">
          <ResetCountdown resetAt={usage.resetAt!} accuracy={usage.resetAccuracy} providerId={provider.id} />
        </p>
      )}
      {windows.map((w) => (
        <UsageWindowRow key={w.id} window={w} providerId={provider.id} />
      ))}
      {usage.credits?.balance !== undefined && (
        <p className="tabular py-1.5 text-sm text-fg">
          Баланс (сообщает провайдер): {usage.credits.balance.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} {usage.credits.currency ?? ''}
        </p>
      )}
      {usage.allocation && (
        <div className="py-1.5 text-sm">
          <p className="text-fg">{usage.allocation.label}</p>
          {usage.allocation.resetAt !== undefined && usage.allocation.resetAt > now && (
            <p className="text-fg-secondary">
              {usage.allocation.resetRule} · <ResetCountdown resetAt={usage.allocation.resetAt} accuracy="estimated" providerId={provider.id} />
            </p>
          )}
        </div>
      )}
      {!hasReported && !usage.allocation && usage.note && <p className="py-1.5 text-sm text-fg-secondary">{usage.note}</p>}
      {!hasReported && !usage.allocation && !usage.note && !provider.local && (
        <p className="py-1.5 text-sm text-fg-secondary">Провайдер не сообщает остаток лимита — Snap Notes его не угадывает.</p>
      )}
      {usage.allocation && usage.note && <p className="pb-1 text-xs text-fg-secondary">{usage.note}</p>}
      {provider.localUsage && !provider.local && (
        <p className="tabular border-t border-line py-1.5 text-xs text-fg-secondary" title="Считает сам Snap Notes. Это не остаток лимита у провайдера.">
          Локальный счётчик Snap Notes · сегодня: {formatCount(provider.localUsage.requests)} запросов
          {provider.localUsage.failures ? `, из них с ошибкой: ${formatCount(provider.localUsage.failures)}` : ''}
          {provider.localUsage.tokens ? `, ~${formatCount(provider.localUsage.tokens)} токенов` : ''}
        </p>
      )}
      {usage.windows.length > 0 && (
        <p className="pb-1.5 text-xs text-fg-muted">
          {formatUpdatedAgo(usage.updatedAt, now)}
          {usage.source ? ` · ${usage.source}` : ''}
          {usage.stale ? ' · данные могли устареть' : ''}
        </p>
      )}
    </div>
  )
}

function ManageUsageLink({ provider }: { provider: ProviderPublicState }): ReactElement | null {
  if (provider.local) return null
  return (
    <LinkButton onClick={() => void window.api.providers.openManageUsage(provider.id)}>
      Управление использованием <ExternalLinkIcon className="h-3 w-3" />
    </LinkButton>
  )
}

function GetKeyLink({ provider, label = 'Получить ключ' }: { provider: ProviderPublicState; label?: string }): ReactElement | null {
  if (!PROVIDER_CATALOG[provider.id].keyUrl) return null
  return (
    <LinkButton onClick={() => void window.api.providers.openKeyPage(provider.id)} aria-label={`${label} ${PROVIDER_CATALOG[provider.id].name} — открыть официальную страницу`}>
      {label} <ExternalLinkIcon className="h-3 w-3" />
    </LinkButton>
  )
}

function ContinueWithChatGptButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }): ReactElement {
  // Brand-mandated "Sign in with ChatGPT" button: keeps its own colours by design.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 items-center gap-2 rounded-full bg-[#0d0d0d] px-4 text-base font-medium text-white transition-colors duration-fast hover:bg-black disabled:opacity-60"
    >
      <img src={chatgptMarkWhite} alt="" className="h-[18px] w-[18px]" />
      Продолжить с ChatGPT
    </button>
  )
}

function ChatGptBody({ provider, setFeedback }: { provider: ProviderPublicState; setFeedback: (f: Feedback) => void }): ReactElement {
  const [busy, setBusy] = useState(false)
  const connection = provider.connection

  const connect = async (reconsent = false): Promise<void> => {
    setBusy(true)
    setFeedback(null)
    const result = await window.api.providers.connect('chatgpt', { reconsent })
    setBusy(false)
    if (!result.ok && result.message) setFeedback({ ok: false, message: result.message })
  }

  if (!provider.integrationEnabled) {
    return <p className="text-sm text-fg-secondary">{provider.integrationNote}</p>
  }

  if (busy || connection.connecting) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-base text-fg">Откройте браузер и подтвердите доступ для Snap Notes…</p>
        <Button
          size="sm"
          onClick={() => {
            void window.api.providers.cancelConnect('chatgpt')
            setBusy(false)
          }}
        >
          Отмена
        </Button>
      </div>
    )
  }

  if (!connection.connected) {
    return (
      <div>
        <p className="mb-3 text-sm text-fg-secondary">
          Используйте свой план ChatGPT для распознавания в Snap Notes — без API-ключа. Вход выполняется в вашем браузере через
          официальный «Sign in with ChatGPT»: Snap Notes не видит ваш пароль. Лимиты и расход видны в настройках ChatGPT.
        </p>
        <ContinueWithChatGptButton onClick={() => void connect(false)} />
      </div>
    )
  }

  return (
    <div>
      <p className="text-base text-fg">
        {connection.accountName ?? connection.accountEmail ?? 'Аккаунт ChatGPT'}
        {connection.accountName && connection.accountEmail && <span className="text-fg-secondary"> · {connection.accountEmail}</span>}
      </p>
      {connection.planUsageEnabled ? (
        <p className="mt-0.5 text-sm text-success">Используется план ChatGPT</p>
      ) : (
        <div className="mt-2 rounded-xl bg-warning-soft px-3 py-2.5">
          <p className="text-sm text-fg">
            Вход выполнен, но использование плана ChatGPT не разрешено — Snap Notes не будет отправлять запросы ChatGPT.
          </p>
          <div className="mt-2">
            <Button variant="primary" size="sm" onClick={() => void connect(true)}>
              Разрешить использование плана
            </Button>
          </div>
        </div>
      )}
      {provider.status === 'AUTH_EXPIRED' && (
        <div className="mt-2">
          <Button variant="primary" size="sm" onClick={() => void connect(false)}>
            Войти снова
          </Button>
        </div>
      )}
    </div>
  )
}

interface CardProps {
  provider: ProviderPublicState
  onConnectAlternative?: (id: ProviderId) => void
  /** Start expanded (onboarding, or when navigated to). */
  defaultOpen?: boolean
  /** Controlled expansion from the parent list (e.g. "connect Anthropic API" jumps here). */
  forceOpen?: boolean
}

/** What the right side of the header says: "✓ Подключён · Доступен", "Не подключён", "Офлайн · без ограничений". */
function ConnectionStatus({ provider }: { provider: ProviderPublicState }): ReactElement {
  if (provider.id === 'tesseract') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-fg">
        <CheckIcon className="h-3.5 w-3.5 text-success" /> Всегда доступен
      </span>
    )
  }
  if (!provider.integrationEnabled) return <span className="text-sm text-fg-secondary">Недоступно</span>
  const connected = provider.configured && provider.status !== 'AUTH_REQUIRED' && provider.status !== 'AUTH_EXPIRED'
  if (!connected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-fg-secondary">
        <span aria-hidden className="h-2 w-2 rounded-full border border-fg-muted" />
        {provider.status === 'AUTH_EXPIRED' ? STATUS_LABELS.AUTH_EXPIRED : 'Не подключён'}
      </span>
    )
  }
  const tone = statusTone(provider.status)
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-fg">
      <CheckIcon className="h-3.5 w-3.5 text-success" />
      <span className="font-medium">Подключён</span>
      <span aria-hidden className="text-fg-muted">·</span>
      <span className={tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-fg-secondary'}>{STATUS_LABELS[provider.status]}</span>
    </span>
  )
}

/**
 * One recognition source as a card: icon, name, connection state, tier, capabilities, usage at a
 * glance, "Get API key". Details (credentials, model, usage, actions) open in place.
 */
export default function ProviderCard({ provider, onConnectAlternative, defaultOpen = false, forceOpen }: CardProps): ReactElement {
  const entry = PROVIDER_CATALOG[provider.id]
  const [open, setOpen] = useState(defaultOpen)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [testing, setTesting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  const test = async (): Promise<void> => {
    setTesting(true)
    setFeedback(null)
    const result = await window.api.providers.test(provider.id)
    setTesting(false)
    setFeedback({ ok: result.ok, message: result.message })
  }

  const disconnect = async (): Promise<void> => {
    setConfirmDisconnect(false)
    const result = await window.api.providers.disconnect(provider.id)
    setFeedback(result.ok ? { ok: true, message: 'Отключено' } : { ok: false, message: result.message ?? 'Не удалось отключить' })
  }

  const bodyId = `provider-body-${provider.id}`
  const hasActions = provider.id !== 'claude' && provider.integrationEnabled
  const apiKey = isApiKeyProvider(provider.id)
  const hasCredentials = (provider.connection.keys?.length ?? 0) > 0
  const showForm = apiKey && !provider.configured && !hasCredentials
  const capabilities = capabilityLabels(provider)
  const connected = provider.configured && provider.status !== 'AUTH_REQUIRED' && provider.status !== 'AUTH_EXPIRED'

  return (
    <div
      id={`provider-${provider.id}`}
      className={cn(
        'scroll-mt-6 rounded-2xl border bg-surface-1 transition-colors duration-fast',
        open ? 'border-[var(--border-strong)] bg-surface-2 shadow-card' : 'border-[var(--border-card)] shadow-card hover:border-[var(--border-strong)] hover:bg-surface-2'
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3.5 rounded-2xl p-4 text-left"
      >
        <ProviderLogo id={provider.id} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-md font-semibold text-fg">{entry.name}</p>
            <ConnectionStatus provider={provider} />
          </div>
          <p className="mt-0.5 text-sm text-fg-secondary">{entry.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <Badge tone={TIER_TONE[entry.tier]}>{entry.tierLabel}</Badge>
            {capabilities.length > 0 && <span className="text-sm text-fg-secondary">{capabilities.join(' · ')}</span>}
          </div>
        </div>
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 self-center rounded-lg border border-[var(--border-strong)] bg-canvas px-2.5 py-1 text-sm font-medium text-fg">
          {provider.id === 'claude' ? 'Подробнее' : connected || provider.id === 'tesseract' ? 'Настроить' : 'Подключить'}
          <ChevronRightIcon className={cn('h-3.5 w-3.5 text-fg-secondary transition-transform duration-base ease-out', open && 'rotate-90')} />
        </span>
      </button>

      {/* Always visible: usage at a glance and the official key page. */}
      {!provider.local && provider.id !== 'chatgpt' && (provider.configured || entry.keyUrl) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 pl-[72px]">
          <div className="min-w-0">{provider.configured ? <UsageSummaryLine provider={provider} /> : <span className="text-sm text-fg-secondary">{entry.id === 'openrouter' ? 'Бесплатные модели доступны после подключения' : 'Ключ ещё не добавлен'}</span>}</div>
          <GetKeyLink provider={provider} />
        </div>
      )}

      {open && (
        <div id={bodyId} className="border-t border-line px-4 pb-5 pl-[72px] pt-4">
          {entry.notes.length > 0 && (
            <ul className="mb-4 space-y-1.5">
              {entry.notes.map((note) => (
                <li key={note} className="text-sm text-fg-secondary">
                  {note}
                </li>
              ))}
            </ul>
          )}

          {provider.id === 'chatgpt' && <ChatGptBody provider={provider} setFeedback={setFeedback} />}

          {provider.id === 'claude' && (
            <div>
              <p className="text-sm text-fg-secondary">{provider.integrationNote}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <Button variant="secondary" size="sm" onClick={() => onConnectAlternative?.('anthropic')}>
                  Подключить Anthropic API
                </Button>
                <ManageUsageLink provider={provider} />
              </div>
            </div>
          )}

          {apiKey && !provider.integrationEnabled && <p className="text-sm text-fg-secondary">{provider.integrationNote}</p>}
          {apiKey && provider.integrationEnabled && (
            showForm ? (
              <ConnectForm provider={provider as ProviderPublicState & { id: ApiKeyProviderId }} setFeedback={setFeedback} />
            ) : (
              <ConnectedCredentials provider={provider as ProviderPublicState & { id: ApiKeyProviderId }} setFeedback={setFeedback} />
            )
          )}

          {provider.id === 'tesseract' && (
            <p className="text-sm text-fg-secondary">
              Работает на этом компьютере, ничего никуда не отправляет. Понимает только текст — без таблиц и структуры. При первом
              запуске один раз скачивает языковые данные. Всегда используется последним, если облако недоступно.
            </p>
          )}

          {hasActions && (provider.configured || provider.id === 'chatgpt') && (
            <div className="mt-3">
              <ModelPicker provider={provider} />
              {provider.id === 'openrouter' && provider.selectedModel === 'auto' && (
                <p className="pb-1 text-xs text-fg-secondary">
                  «Автоматически» берёт бесплатную модель, подходящую для задачи; для скриншота — только с поддержкой изображений. Если таких нет — Tesseract → бесплатная текстовая модель.
                </p>
              )}
              <ProviderUsageBlock provider={provider} />
            </div>
          )}

          {provider.lastError && provider.lastError.code !== 'CANCELLED' && (
            <p className="mt-3 text-sm text-danger">
              Последняя ошибка: {errorCodeShort(provider.lastError.code)} — {provider.lastError.message}
            </p>
          )}

          {hasActions && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {(provider.configured || provider.local || hasCredentials) && (
                <Button size="sm" onClick={() => void test()} loading={testing}>
                  {testing ? 'Проверка…' : 'Проверить подключение'}
                </Button>
              )}
              {!provider.local && (provider.connection.connected || hasCredentials) && (
                <Button variant="danger-ghost" size="sm" onClick={() => setConfirmDisconnect(true)}>
                  Отключить
                </Button>
              )}
              {(provider.configured || provider.id === 'chatgpt') && (
                <span className="ml-2">
                  <ManageUsageLink provider={provider} />
                </span>
              )}
            </div>
          )}

          {confirmDisconnect && (
            <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-danger-soft px-3 py-2.5">
              <p className="flex-1 text-sm text-fg">
                {apiKey ? 'Удалить все сохранённые ключи и данные этого источника с компьютера?' : 'Выйти из аккаунта и отозвать доступ Snap Notes?'}
              </p>
              <Button variant="danger" size="sm" onClick={() => void disconnect()}>
                Отключить
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>
                Отмена
              </Button>
            </div>
          )}

          <FeedbackLine feedback={feedback} />
        </div>
      )}
    </div>
  )
}
