import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ApiKeyProviderId, ProviderPublicState } from '@shared/providers'
import { PROVIDER_CATALOG, extraFields, primaryKeyField, type ProviderField } from '@shared/providerCatalog'
import { Button, IconButton, Input } from '../../ui'
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from '../icons'

export type Feedback = { ok: boolean; message: string } | null

const REVEAL_MS = 15_000
const MASK = '••••••••••••••••'

interface RowProps {
  provider: ApiKeyProviderId
  label: string
  /** Secret fields are masked; Reveal asks the main process, which returns the value only on this click. */
  secret: boolean
  /** The value itself, only for non-secret fields. */
  plainValue?: string
  secretRef: { keyId?: string; field?: string }
  placeholder?: string
  protectedLabel?: ReactElement | null
  onReplace: (value: string) => Promise<Feedback>
  onDelete?: () => void
  setFeedback: (f: Feedback) => void
}

/** One saved credential: masked value, Reveal (auto-hides), Copy (clipboard cleared by the app), Replace. */
function CredentialRow({ provider, label, secret, plainValue, secretRef, placeholder, protectedLabel, onReplace, onDelete, setFeedback }: RowProps): ReactElement {
  const [revealed, setRevealed] = useState<string | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const toggleReveal = async (): Promise<void> => {
    if (revealed !== null) {
      setRevealed(null)
      return
    }
    const result = await window.api.providers.revealSecret(provider, secretRef)
    if (!result.ok || result.value === undefined) {
      setFeedback({ ok: false, message: 'Не удалось прочитать значение.' })
      return
    }
    setRevealed(result.value)
    if (timer.current) clearTimeout(timer.current)
    // The value does not stay on screen: it hides itself.
    timer.current = setTimeout(() => setRevealed(null), REVEAL_MS)
  }

  const copy = async (): Promise<void> => {
    if (!secret && plainValue) {
      await navigator.clipboard.writeText(plainValue).catch(() => undefined)
      setFeedback({ ok: true, message: 'Скопировано' })
      return
    }
    const result = await window.api.providers.copySecret(provider, secretRef)
    setFeedback({ ok: result.ok, message: result.message ?? (result.ok ? 'Скопировано' : 'Не удалось скопировать') })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    const result = await onReplace(draft)
    setSaving(false)
    setFeedback(result)
    if (result?.ok !== false) {
      setDraft('')
      setReplacing(false)
      setRevealed(null)
    }
  }

  if (replacing) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Input
          type={secret ? 'password' : 'text'}
          value={draft}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-label={`Новое значение: ${label}`}
          size="sm"
          wrapperClassName="flex-1"
          className="font-mono text-sm"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim() && !saving) void save()
            if (e.key === 'Escape') setReplacing(false)
          }}
        />
        <Button variant="primary" size="sm" disabled={!draft.trim()} loading={saving} onClick={() => void save()}>
          {saving ? 'Проверяю…' : 'Сохранить'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setReplacing(false)}>
          Отмена
        </Button>
      </div>
    )
  }

  const shown = secret ? (revealed ?? MASK) : (plainValue ?? '')
  return (
    <li className="group flex min-h-[40px] items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-xs text-fg-secondary">{label}</p>
        <p className="selectable truncate font-mono text-sm text-fg" aria-label={secret && revealed === null ? `${label}: скрыто` : undefined}>
          {shown}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {protectedLabel}
        {secret && (
          <IconButton
            size="sm"
            label={revealed !== null ? 'Скрыть' : 'Показать'}
            icon={revealed !== null ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            onClick={() => void toggleReveal()}
          />
        )}
        <IconButton size="sm" label="Копировать" icon={<CopyIcon className="h-4 w-4" />} onClick={() => void copy()} />
        <Button variant="ghost" size="sm" onClick={() => setReplacing(true)}>
          Заменить
        </Button>
        {onDelete && <IconButton size="sm" tone="danger" label="Удалить ключ" icon={<TrashIcon className="h-3.5 w-3.5" />} onClick={onDelete} />}
      </div>
    </li>
  )
}

function SecureBadge({ secure }: { secure: boolean }): ReactElement {
  return (
    <span
      className={`mr-1 inline-flex items-center gap-1 text-xs ${secure ? 'text-fg-secondary' : 'text-warning'}`}
      title={
        secure
          ? 'Зашифрован средствами Windows (DPAPI) и доступен только вашей учётной записи'
          : 'Защищённое хранилище Windows было недоступно — ключ пока хранится по-старому'
      }
    >
      {secure && <CheckIcon className="h-3 w-3" />}
      {secure ? 'Защищён' : 'Не защищён'}
    </span>
  )
}

/** Connected provider: its key(s) and extra fields, each with Reveal / Copy / Replace. */
export function ConnectedCredentials({
  provider,
  setFeedback
}: {
  provider: ProviderPublicState & { id: ApiKeyProviderId }
  setFeedback: (f: Feedback) => void
}): ReactElement {
  const keys = provider.connection.keys ?? []
  const fieldStates = provider.connection.fields ?? []
  const keyField = primaryKeyField(provider.id)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const addKey = async (): Promise<void> => {
    setSaving(true)
    const result = await window.api.providers.setKey(provider.id, { apiKey: draft })
    setSaving(false)
    setFeedback({ ok: result.ok, message: result.message ?? (result.ok ? 'Ключ сохранён' : 'Не удалось сохранить ключ') })
    if (result.saved) {
      setDraft('')
      setAdding(false)
    }
  }

  return (
    <div>
      <ul className="divide-y divide-line">
        {keys.map((key) => (
          <CredentialRow
            key={key.id}
            provider={provider.id}
            label={keys.length > 1 ? `${keyField.label} · ${key.label}` : keyField.label}
            secret
            secretRef={{ keyId: key.id }}
            placeholder={keyField.placeholder}
            protectedLabel={<SecureBadge secure={key.secure} />}
            setFeedback={setFeedback}
            onReplace={async (value) => {
              const result = await window.api.providers.setKey(provider.id, { apiKey: value, keyId: key.id })
              return { ok: result.ok, message: result.message ?? (result.ok ? 'Ключ заменён' : 'Не удалось сохранить ключ') }
            }}
            onDelete={() => void window.api.providers.removeKey(provider.id, key.id)}
          />
        ))}
        {extraFields(provider.id).map((field) => {
          const state = fieldStates.find((f) => f.id === field.id)
          if (!state?.set) return null
          return (
            <CredentialRow
              key={field.id}
              provider={provider.id}
              label={field.label}
              secret={field.secret}
              plainValue={state.value}
              secretRef={{ field: field.id }}
              placeholder={field.placeholder}
              setFeedback={setFeedback}
              onReplace={async (value) => {
                const result = await window.api.providers.setFields(provider.id, { [field.id]: value })
                return { ok: result.ok, message: result.ok ? 'Сохранено' : (result.message ?? 'Не удалось сохранить') }
              }}
            />
          )
        })}
      </ul>

      {adding ? (
        <div className="mt-1 flex items-center gap-2 py-2">
          <Input
            type="password"
            value={draft}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder={keyField.placeholder}
            aria-label={`Ещё один ключ ${provider.name}`}
            size="sm"
            wrapperClassName="flex-1"
            className="font-mono text-sm"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim() && !saving) void addKey()
            }}
          />
          <Button variant="primary" size="sm" disabled={!draft.trim()} loading={saving} onClick={() => void addKey()}>
            {saving ? 'Проверяю…' : 'Сохранить'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
            Отмена
          </Button>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-x-3">
          <Button variant="ghost" size="sm" icon={<PlusIcon className="h-3.5 w-3.5" />} className="-ml-2.5" onClick={() => setAdding(true)}>
            Добавить ещё ключ
          </Button>
          {keys.length > 1 && <span className="text-xs text-fg-secondary">Если у ключа кончился лимит, Snap Notes сам переключится на следующий.</span>}
        </div>
      )}
    </div>
  )
}

/** Provider not connected yet: every needed field in one small form, then one Connect button. */
export function ConnectForm({
  provider,
  setFeedback
}: {
  provider: ProviderPublicState & { id: ApiKeyProviderId }
  setFeedback: (f: Feedback) => void
}): ReactElement {
  const fields: ProviderField[] = PROVIDER_CATALOG[provider.id].fields
  const [values, setValues] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const saved = provider.connection.fields ?? []

  // Fields already saved (for example Account ID after a key was rejected) do not need retyping.
  const valueOf = (field: ProviderField): string => values[field.id] ?? ''
  const isFilled = (field: ProviderField): boolean =>
    valueOf(field).trim().length > 0 || (field.id === 'apiKey' ? (provider.connection.keys?.length ?? 0) > 0 : Boolean(saved.find((f) => f.id === field.id)?.set))
  const ready = fields.filter((f) => f.required).every(isFilled) && fields.some((f) => valueOf(f).trim())

  const connect = async (): Promise<void> => {
    setSaving(true)
    setFeedback(null)
    const extra: Record<string, string> = {}
    for (const field of fields) if (field.id !== 'apiKey' && valueOf(field).trim()) extra[field.id] = valueOf(field)
    if (Object.keys(extra).length > 0) {
      const result = await window.api.providers.setFields(provider.id, extra)
      if (!result.ok) {
        setSaving(false)
        setFeedback({ ok: false, message: result.message ?? 'Не удалось сохранить данные подключения' })
        return
      }
    }
    const key = valueOf(fields.find((f) => f.id === 'apiKey')!)
    if (key.trim()) {
      const result = await window.api.providers.setKey(provider.id, { apiKey: key })
      setFeedback({ ok: result.ok, message: result.message ?? (result.ok ? 'Подключено' : 'Не удалось сохранить ключ') })
      // The key never comes back to the renderer: once saved, the field is cleared.
      if (result.saved) setValues({})
    } else {
      setFeedback({ ok: true, message: 'Сохранено' })
      setValues({})
    }
    setSaving(false)
  }

  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !saving) void connect()
      }}
    >
      {fields.map((field) => {
        const alreadySaved = field.id !== 'apiKey' && saved.find((f) => f.id === field.id)?.set
        return (
          <label key={field.id} className="block">
            <span className="mb-1 block text-sm text-fg-secondary">{field.label}</span>
            <Input
              type={field.secret && !visible[field.id] ? 'password' : 'text'}
              value={valueOf(field)}
              autoComplete="off"
              spellCheck={false}
              placeholder={alreadySaved ? 'сохранено — оставьте пустым, чтобы не менять' : field.placeholder}
              size="sm"
              className="font-mono text-sm"
              onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
              trailing={
                field.secret ? (
                  <button
                    type="button"
                    onClick={() => setVisible((v) => ({ ...v, [field.id]: !v[field.id] }))}
                    className="shrink-0 rounded-sm text-fg-secondary hover:text-fg"
                    aria-label={visible[field.id] ? 'Скрыть' : 'Показать'}
                  >
                    {visible[field.id] ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                  </button>
                ) : null
              }
            />
          </label>
        )
      })}
      <div className="pt-1">
        <Button type="submit" variant="primary" size="sm" disabled={!ready} loading={saving}>
          {saving ? 'Проверяю…' : 'Подключить'}
        </Button>
      </div>
    </form>
  )
}
