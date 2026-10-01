import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type { ApiKeyProviderId, ProviderId, ProviderPublicState } from '@shared/providers'
import { errorCodeShort, formatUpdatedAgo } from '@shared/usageFormat'
import { useAppStore } from '../../store/useAppStore'
import { Button, Input, LinkButton, Select, IconButton, cn } from '../../ui'
import { CheckIcon, ChevronRightIcon, ExternalLinkIcon, PlusIcon, TrashIcon, XCircleIcon, EyeIcon, EyeOffIcon, RefreshIcon } from '../icons'
import { ResetCountdown, StatusPill, UsageWindowRow, useNow } from './usageBits'
import chatgptMarkWhite from '../../assets/chatgpt/chatgpt-button-white-21.svg'

const KEY_LINKS: Record<ApiKeyProviderId, { url: string; placeholder: string }> = {
  gemini: { url: 'https://aistudio.google.com/apikey', placeholder: 'AIza...' },
  groq: { url: 'https://console.groq.com/keys', placeholder: 'gsk_...' },
  openai: { url: 'https://platform.openai.com/api-keys', placeholder: 'sk-...' },
  anthropic: { url: 'https://platform.claude.com/settings/keys', placeholder: 'sk-ant-...' }
}

const KIND_LABEL: Record<ProviderId, string> = {
  chatgpt: 'Аккаунт ChatGPT · использует план ChatGPT',
  claude: 'Подписка Claude',
  gemini: 'Gemini API · ключ',
  groq: 'Groq API · ключ',
  openai: 'OpenAI API · оплата по факту (это не ChatGPT Plus)',
  anthropic: 'Anthropic API · оплата по факту (это не Claude Pro)',
  tesseract: 'Локально · офлайн'
}

function isApiKeyProvider(id: ProviderId): id is ApiKeyProviderId {
  return id === 'gemini' || id === 'groq' || id === 'openai' || id === 'anthropic'
}

type Feedback = { ok: boolean; message: string } | null

function FeedbackLine({ feedback }: { feedback: Feedback }): ReactElement | null {
  if (!feedback) return null
  return (
    <p role="status" className={`mt-3 flex items-center gap-1.5 text-sm ${feedback.ok ? 'text-success' : 'text-danger'}`}>
      {feedback.ok ? <CheckIcon className="h-3.5 w-3.5 shrink-0" /> : <XCircleIcon className="h-3.5 w-3.5 shrink-0" />}
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

function ModelPicker({ provider }: { provider: ProviderPublicState }): ReactElement | null {
  const settings = useAppStore((s) => s.settings)
  const updateAiSettings = useAppStore((s) => s.updateAiSettings)
  const [refreshing, setRefreshing] = useState(false)
  if (!settings || !provider.configured || provider.local) return null
  return (
    <DetailRow label={<label htmlFor={`model-${provider.id}`}>Модель</label>}>
      <Select
        id={`model-${provider.id}`}
        value={provider.selectedModel}
        onChange={(e) => void updateAiSettings({ models: { ...settings.ai.models, [provider.id]: e.target.value } })}
        wrapperClassName="w-[240px]"
      >
        <option value="auto">Автоматически</option>
        {provider.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName}
            {m.vision === true ? ' · изображения' : m.vision === false ? ' · только текст' : ''}
          </option>
        ))}
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

/** Compact usage block: provider-reported windows, a reset countdown, or an honest "managed by …". */
export function ProviderUsageBlock({ provider, compact = false }: { provider: ProviderPublicState; compact?: boolean }): ReactElement | null {
  const now = useNow(5000)
  const usage = provider.usage
  const showReset = usage.resetAt !== undefined && usage.resetAt > now
  const windows = compact ? usage.windows.slice(0, 2) : usage.windows
  if (!provider.configured && !showReset) return null
  return (
    <div className="mt-2 rounded-xl bg-surface-1 px-3 py-1.5">
      {showReset && (
        <p className="py-1.5 text-sm font-medium text-fg">
          <ResetCountdown resetAt={usage.resetAt!} accuracy={usage.resetAccuracy} providerId={provider.id} />
        </p>
      )}
      {windows.map((w) => (
        <UsageWindowRow key={w.id} window={w} providerId={provider.id} />
      ))}
      {windows.length === 0 && usage.note && <p className="py-1.5 text-sm text-fg-secondary">{usage.note}</p>}
      {windows.length === 0 && !usage.note && !provider.local && (
        <p className="py-1.5 text-sm text-fg-secondary">Провайдер не сообщает остаток лимита — Snap Notes его не угадывает.</p>
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

function ApiKeysBody({
  provider,
  setFeedback
}: {
  provider: ProviderPublicState & { id: ApiKeyProviderId }
  setFeedback: (f: Feedback) => void
}): ReactElement {
  const keys = provider.connection.keys ?? []
  const [adding, setAdding] = useState(keys.length === 0)
  const [draft, setDraft] = useState('')
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const link = KEY_LINKS[provider.id]

  if (!provider.integrationEnabled) return <p className="text-sm text-fg-secondary">{provider.integrationNote}</p>

  const save = async (): Promise<void> => {
    setSaving(true)
    setFeedback(null)
    const result = await window.api.providers.setKey(provider.id, { apiKey: draft })
    setSaving(false)
    setFeedback({ ok: result.ok, message: result.message ?? (result.ok ? 'Ключ сохранён' : 'Не удалось сохранить ключ') })
    // The key never comes back to the renderer: once saved, the field is cleared.
    if (result.saved) {
      setDraft('')
      setAdding(false)
    }
  }

  return (
    <div>
      {keys.length > 0 && (
        <ul className="mb-2 divide-y divide-line">
          {keys.map((key) => (
            <li key={key.id} className="group flex h-9 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-base text-fg">
                {key.label} <span className="text-fg-muted">••••••••••••</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span
                  className={`text-xs ${key.secure ? 'text-fg-muted' : 'text-warning'}`}
                  title={
                    key.secure
                      ? 'Зашифрован средствами Windows (DPAPI) и доступен только вашей учётной записи'
                      : 'Защищённое хранилище Windows было недоступно — ключ пока хранится по-старому'
                  }
                >
                  {key.secure ? 'Защищён' : 'Не защищён'}
                </span>
                <IconButton
                  size="sm"
                  tone="danger"
                  label="Удалить ключ"
                  icon={<TrashIcon className="h-3.5 w-3.5" />}
                  className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  onClick={() => void window.api.providers.removeKey(provider.id, key.id)}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex items-center gap-2">
          <Input
            type={visible ? 'text' : 'password'}
            value={draft}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim() && !saving) void save()
            }}
            placeholder={link.placeholder}
            aria-label={`API-ключ ${provider.name}`}
            size="sm"
            wrapperClassName="flex-1"
            className="font-mono text-sm"
            trailing={
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                className="shrink-0 text-fg-muted hover:text-fg"
                aria-label={visible ? 'Скрыть ключ' : 'Показать ключ'}
              >
                {visible ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </button>
            }
          />
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={!draft.trim()} loading={saving}>
            {saving ? 'Проверяю…' : 'Сохранить'}
          </Button>
          {keys.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Отмена
            </Button>
          )}
        </div>
      ) : (
        <Button variant="ghost" size="sm" icon={<PlusIcon className="h-3.5 w-3.5" />} className="-ml-2.5" onClick={() => setAdding(true)}>
          {keys.length ? 'Добавить ещё ключ' : 'Добавить ключ'}
        </Button>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <LinkButton onClick={() => void window.api.app.openExternal(link.url)}>
          Получить ключ {provider.name} <ExternalLinkIcon className="h-3 w-3" />
        </LinkButton>
        {keys.length > 1 && <span className="text-xs text-fg-muted">Если у ключа кончился лимит, Snap Notes сам переключится на следующий.</span>}
      </div>
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

/**
 * One recognition source as an expandable settings row: name, kind and status at a glance;
 * keys, model, usage and actions only when opened (progressive disclosure).
 */
export default function ProviderCard({ provider, onConnectAlternative, defaultOpen = false, forceOpen }: CardProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [testing, setTesting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  const test = async (): Promise<void> => {
    setTesting(true)
    const result = await window.api.providers.test(provider.id)
    setTesting(false)
    setFeedback({ ok: result.ok, message: result.message })
  }

  const disconnect = async (): Promise<void> => {
    setConfirmDisconnect(false)
    const result = await window.api.providers.disconnect(provider.id)
    setFeedback(result.ok ? { ok: true, message: 'Отключено' } : { ok: false, message: result.message ?? 'Не удалось отключить' })
  }

  const statusLabel =
    provider.id === 'tesseract'
      ? 'Офлайн · без ограничений'
      : provider.id === 'chatgpt' && provider.connection.connected && !provider.connection.planUsageEnabled
        ? 'План не разрешён'
        : undefined

  const bodyId = `provider-body-${provider.id}`
  const hasActions = provider.id !== 'claude' && provider.integrationEnabled

  return (
    <div id={`provider-${provider.id}`} className="scroll-mt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-3 py-3 text-left outline-offset-[-2px]"
      >
        <ChevronRightIcon
          className={cn('h-4 w-4 shrink-0 text-fg-muted transition-transform duration-base ease-out group-hover:text-fg-secondary', open && 'rotate-90')}
        />
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-fg">{provider.name}</p>
          <p className="truncate text-sm text-fg-secondary">{KIND_LABEL[provider.id]}</p>
        </div>
        {provider.integrationEnabled && <StatusPill status={provider.status} label={statusLabel} />}
      </button>

      {open && (
        <div id={bodyId} className="pb-5 pl-7">
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

          {isApiKeyProvider(provider.id) && (
            <ApiKeysBody provider={provider as ProviderPublicState & { id: ApiKeyProviderId }} setFeedback={setFeedback} />
          )}

          {provider.id === 'tesseract' && (
            <p className="text-sm text-fg-secondary">
              Работает на этом компьютере, ничего никуда не отправляет. Понимает только текст — без таблиц и структуры. При первом
              запуске один раз скачивает языковые данные. Всегда используется последним, если облако недоступно.
            </p>
          )}

          {hasActions && (
            <div className="mt-2">
              <ModelPicker provider={provider} />
              <ProviderUsageBlock provider={provider} />
            </div>
          )}

          {provider.lastError && provider.lastError.code !== 'CANCELLED' && (
            <p className="mt-3 text-sm text-danger">
              Последняя ошибка: {errorCodeShort(provider.lastError.code)} — {provider.lastError.message}
            </p>
          )}

          {hasActions && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(provider.configured || provider.local) && (
                <Button size="sm" onClick={() => void test()} loading={testing}>
                  {testing ? 'Проверка…' : 'Проверить подключение'}
                </Button>
              )}
              {!provider.local && (provider.connection.connected || (provider.connection.keys?.length ?? 0) > 0) && (
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
                {isApiKeyProvider(provider.id)
                  ? 'Удалить все ключи этого источника с компьютера?'
                  : 'Выйти из аккаунта и отозвать доступ Snap Notes?'}
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
