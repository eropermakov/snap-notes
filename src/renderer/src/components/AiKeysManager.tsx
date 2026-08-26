import { useState, type ReactElement } from 'react'
import type { AiKeyEntry, AiProvider } from '@shared/types'
import { EyeIcon, EyeOffIcon, CheckIcon, XCircleIcon, ExternalLinkIcon, PlusIcon, TrashIcon } from './icons'

const PROVIDER_INFO: Record<AiProvider, { label: string; keyUrl: string | null; placeholder: string; description?: string }> = {
  gemini: { label: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey', placeholder: 'AIza...' },
  groq: { label: 'Groq', keyUrl: 'https://console.groq.com/keys', placeholder: 'gsk_...' },
  local: {
    label: 'Локально (офлайн)',
    keyUrl: null,
    placeholder: '',
    description:
      'Работает на вашем компьютере без лимитов, ключ не нужен. При первом использовании один раз скачивает языковые данные (нужен интернет), дальше работает офлайн. Понимает только сырой текст — без умной структуры (таблицы/кнопки/списки)'
  }
}

interface Props {
  keys: AiKeyEntry[]
  usage: Record<string, number>
  onChange: (keys: AiKeyEntry[]) => void
}

export default function AiKeysManager({ keys, usage, onChange }: Props): ReactElement {
  const addKey = (provider: AiProvider): void => {
    if (provider === 'local' && keys.some((k) => k.provider === 'local')) return
    const id = crypto.randomUUID()
    const sameProviderCount = keys.filter((k) => k.provider === provider).length
    const label =
      provider === 'local' || sameProviderCount === 0
        ? PROVIDER_INFO[provider].label
        : `${PROVIDER_INFO[provider].label} #${sameProviderCount + 1}`
    onChange([...keys, { id, provider, label, apiKey: provider === 'local' ? 'local' : '' }])
  }
  const updateKey = (id: string, patch: Partial<AiKeyEntry>): void => {
    onChange(keys.map((k) => (k.id === id ? { ...k, ...patch } : k)))
  }
  const removeKey = (id: string): void => {
    onChange(keys.filter((k) => k.id !== id))
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">Источники распознавания</label>
      <p className="mb-3 text-xs text-muted">
        Порядок важен: если верхний источник недоступен (лимит, ошибка) — приложение автоматически пробует
        следующий.
      </p>

      {keys.length === 0 && (
        <p className="mb-3 rounded-lg border border-dashed border-surface-border p-3 text-sm text-muted">
          Источников пока нет — без них распознавание текста работать не будет.
        </p>
      )}

      <div className="space-y-3">
        {keys.map((key, index) => (
          <AiKeyRow
            key={key.id}
            index={index}
            entry={key}
            usageToday={usage[key.id] ?? 0}
            onUpdate={(patch) => updateKey(key.id, patch)}
            onRemove={() => removeKey(key.id)}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => addKey('gemini')}
          className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-bg px-3 py-1.5 text-sm text-ink transition hover:border-accent active:scale-[0.97]"
        >
          <PlusIcon className="h-3.5 w-3.5" /> Добавить ключ Gemini
        </button>
        <button
          onClick={() => addKey('groq')}
          className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-bg px-3 py-1.5 text-sm text-ink transition hover:border-accent active:scale-[0.97]"
        >
          <PlusIcon className="h-3.5 w-3.5" /> Добавить ключ Groq
        </button>
        <button
          onClick={() => addKey('local')}
          disabled={keys.some((k) => k.provider === 'local')}
          className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-bg px-3 py-1.5 text-sm text-ink transition hover:border-accent active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          <PlusIcon className="h-3.5 w-3.5" /> Добавить локальное распознавание
        </button>
      </div>
    </div>
  )
}

interface RowProps {
  index: number
  entry: AiKeyEntry
  usageToday: number
  onUpdate: (patch: Partial<AiKeyEntry>) => void
  onRemove: () => void
}

type TestState = 'idle' | 'testing' | 'ok' | 'error'

function AiKeyRow({ index, entry, usageToday, onUpdate, onRemove }: RowProps): ReactElement {
  const [visible, setVisible] = useState(false)
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMessage, setTestMessage] = useState('')
  const info = PROVIDER_INFO[entry.provider]
  const isLocal = entry.provider === 'local'

  const handleTest = async (): Promise<void> => {
    setTestState('testing')
    const result = await window.api.settings.testApiKey(entry.provider, entry.apiKey)
    setTestState(result.ok ? 'ok' : 'error')
    setTestMessage(result.message)
  }

  return (
    <div className="rounded-xl border border-surface-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-full bg-accent-light px-2 py-0.5 text-xs font-medium text-accent">{index + 1}</span>
          <span className="truncate text-sm font-medium text-ink">{entry.label}</span>
          {usageToday > 0 && <span className="shrink-0 text-xs text-muted">· {usageToday} сегодня</span>}
        </div>
        <button onClick={onRemove} className="shrink-0 text-muted transition hover:text-danger active:scale-[0.97]" title="Удалить">
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      {isLocal ? (
        <>
          <p className="mb-2 text-xs text-muted">{info.description}</p>
          <button
            onClick={() => void handleTest()}
            disabled={testState === 'testing'}
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            {testState === 'testing' ? 'Подготовка...' : 'Проверить'}
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-surface-border bg-bg px-3 py-2 transition-colors focus-within:border-accent">
            <input
              type={visible ? 'text' : 'password'}
              value={entry.apiKey}
              onChange={(e) => {
                onUpdate({ apiKey: e.target.value })
                setTestState('idle')
              }}
              placeholder={info.placeholder}
              className="w-full bg-transparent font-mono text-sm text-ink placeholder:text-muted focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="shrink-0 text-muted transition hover:text-ink active:scale-[0.97]"
              title={visible ? 'Скрыть' : 'Показать'}
            >
              {visible ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            </button>
          </div>
          <button
            onClick={() => void handleTest()}
            disabled={!entry.apiKey.trim() || testState === 'testing'}
            className="shrink-0 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            {testState === 'testing' ? 'Проверка...' : 'Проверить'}
          </button>
        </div>
      )}

      {testState === 'ok' && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-success">
          <CheckIcon className="h-3.5 w-3.5" /> {testMessage}
        </p>
      )}
      {testState === 'error' && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-danger">
          <XCircleIcon className="h-3.5 w-3.5 shrink-0" /> {testMessage}
        </p>
      )}

      {info.keyUrl && (
        <button
          onClick={() => void window.api.app.openExternal(info.keyUrl as string)}
          className="mt-1.5 flex items-center gap-1 text-xs text-accent hover:underline"
        >
          Получить бесплатный ключ {info.label} <ExternalLinkIcon className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
