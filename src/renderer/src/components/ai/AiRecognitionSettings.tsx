import { useState, type DragEvent, type ReactElement } from 'react'
import type { AiPreference, AiUsageMode, ProviderId, ProviderPublicState } from '@shared/providers'
import { useAppStore } from '../../store/useAppStore'
import { Button, ChoiceList, IconButton, Section, Select, SettingsGroup, SettingsRow, Toggle, cn } from '../../ui'
import { ArrowDownIcon, ArrowUpIcon, GripIcon } from '../icons'
import ProviderCard from './ProviderCard'
import { StatusPill } from './usageBits'
import { PROVIDER_CATALOG } from '@shared/providerCatalog'

const MODES: { value: AiUsageMode; label: string; description: string }[] = [
  { value: 'best', label: 'Лучшее качество', description: 'Скриншот сразу получает модель с распознаванием изображений.' },
  {
    value: 'balanced',
    label: 'Сбалансированно',
    description: 'Сначала локальное распознавание; сложные таблицы, код и интерфейсы уходят модели с изображениями.'
  },
  { value: 'economy', label: 'Экономно', description: 'Tesseract распознаёт локально, ИИ получает только текст — в разы меньше расход.' },
  { value: 'offline', label: 'Только офлайн', description: 'Только Tesseract. Ни скриншоты, ни текст никуда не отправляются.' }
]

/** Drag & drop priority for cloud providers; Tesseract is pinned last. Arrow buttons give keyboard access. */
function PriorityList({ providers }: { providers: ProviderPublicState[] }): ReactElement {
  const settings = useAppStore((s) => s.settings)
  const updateAiSettings = useAppStore((s) => s.updateAiSettings)
  const [dragging, setDragging] = useState<ProviderId | null>(null)
  if (!settings) return <div />

  const byId = new Map(providers.map((p) => [p.id, p]))
  const order = settings.ai.priority.filter((id) => byId.has(id) && byId.get(id)!.integrationEnabled && byId.get(id)!.configured)

  const move = (id: ProviderId, to: number): void => {
    const current = settings.ai.priority.filter((p) => p !== id)
    // Translate the visible index (enabled providers only) into the stored list.
    const anchor = order.filter((p) => p !== id)[to]
    const index = anchor ? current.indexOf(anchor) : current.length
    current.splice(index, 0, id)
    void updateAiSettings({ priority: current })
  }

  const onDrop = (e: DragEvent, targetIndex: number): void => {
    e.preventDefault()
    if (dragging) move(dragging, targetIndex)
    setDragging(null)
  }

  const tesseract = byId.get('tesseract')

  return (
    <ol className="divide-y divide-line border-y border-line">
      {order.map((id, index) => {
        const p = byId.get(id)!
        return (
          <li
            key={id}
            draggable
            onDragStart={() => setDragging(id)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, index)}
            className={cn('group flex h-11 items-center gap-3 transition-colors duration-fast', dragging === id && 'bg-hover')}
          >
            <GripIcon className="h-4 w-4 shrink-0 cursor-grab text-fg-muted" />
            <span className="tabular w-4 text-sm text-fg-muted">{index + 1}</span>
            <span className="flex-1 text-base text-fg">{p.name}</span>
            <StatusPill status={p.status} />
            <span className="flex gap-0.5 opacity-0 transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100">
              <IconButton size="sm" label="Выше" icon={<ArrowUpIcon className="h-3.5 w-3.5" />} disabled={index === 0} onClick={() => move(id, index - 1)} />
              <IconButton
                size="sm"
                label="Ниже"
                icon={<ArrowDownIcon className="h-3.5 w-3.5" />}
                disabled={index === order.length - 1}
                onClick={() => move(id, index + 1)}
              />
            </span>
          </li>
        )
      })}
      {tesseract && (
        <li className="flex h-11 items-center gap-3">
          <span className="w-4" />
          <span className="tabular w-4 text-sm text-fg-muted">{order.length + 1}</span>
          <span className="flex-1 text-base text-fg">Tesseract</span>
          <span className="text-sm text-fg-muted">всегда последний · офлайн</span>
        </li>
      )}
    </ol>
  )
}

const PREFERENCES: { value: AiPreference; label: string; description: string }[] = [
  { value: 'free', label: 'Бесплатные источники', description: 'Сначала бесплатные тарифы, потом платные. Порядок внутри группы — ваш.' },
  { value: 'quality', label: 'Лучшее качество', description: 'Сначала самые сильные модели.' },
  { value: 'speed', label: 'Самые быстрые', description: 'Сначала самые быстрые источники.' },
  { value: 'custom', label: 'Свой порядок', description: 'Источники пробуются строго в том порядке, который вы задали ниже.' }
]

/** Settings → ИИ и распознавание: mode, automatic routing, source cards, advanced. */
export default function AiRecognitionSettings(): ReactElement {
  const settings = useAppStore((s) => s.settings)
  const providers = useAppStore((s) => s.providers)
  const updateAiSettings = useAppStore((s) => s.updateAiSettings)
  if (!settings) return <div />
  const ai = settings.ai

  const cloudInUse = ai.mode !== 'offline' && providers.some((p) => !p.local && p.configured)

  return (
    <>
      <Section title="Режим" description="Как Snap Notes распознаёт скриншоты. Источник выбирается автоматически.">
        <ChoiceList aria-label="Режим использования ИИ" value={ai.mode} onChange={(mode) => void updateAiSettings({ mode })} options={MODES} />
        <p className="mt-3 text-sm text-fg-secondary">
          {ai.mode === 'offline' ? (
            <>Всё распознаётся на этом компьютере. Ни скриншоты, ни текст, ни фрагменты заметок не уходят во внешние сервисы.</>
          ) : (
            <>
              <span className="font-medium text-fg">Облачная обработка.</span>{' '}
              {ai.mode === 'economy'
                ? 'Выбранному ИИ отправляется текст, распознанный локально (скриншот остаётся на компьютере).'
                : 'Выделенная область экрана или распознанный из неё текст может отправляться выбранному ИИ-провайдеру.'}{' '}
              Другие заметки, названия окон и ключи не отправляются.
              {!cloudInUse && ' Сейчас не подключён ни один облачный источник — работает только Tesseract.'}
            </>
          )}
        </p>
      </Section>

      {ai.mode !== 'offline' && (
        <Section
          title="Что предпочитать"
          description="Для скриншота нужен источник, который умеет читать изображения; чисто текстовые модели получают текст после Tesseract."
        >
          <ChoiceList
            aria-label="Что предпочитать при автоматическом выборе"
            value={ai.prefer}
            onChange={(prefer) => void updateAiSettings({ prefer })}
            options={PREFERENCES}
          />
        </Section>
      )}

      <Section title="Источники" description={sourcesSummary(providers)}>
        <ProvidersList />
      </Section>

      {ai.mode !== 'offline' && ai.prefer === 'custom' && (
        <Section
          title="Порядок источников"
          description="Перетащите, чтобы изменить порядок. Источник без нужной возможности (например, распознавания изображений) пропускается автоматически."
        >
          <PriorityList providers={providers} />
        </Section>
      )}

      <Section title="Дополнительно">
        <SettingsGroup>
          {ai.mode !== 'offline' && (
            <SettingsRow
              title="Источник"
              description="Принудительно использовать один источник вместо автоматического выбора."
              control={
                <Select
                  aria-label="Источник"
                  value={ai.preferredProvider ?? 'auto'}
                  onChange={(e) =>
                    void updateAiSettings({ preferredProvider: e.target.value === 'auto' ? null : (e.target.value as ProviderId) })
                  }
                  wrapperClassName="w-[220px]"
                >
                  <option value="auto">Автоматически</option>
                  {providers
                    .filter((p) => p.configured)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Select>
              }
            />
          )}
          <SettingsRow
            title="Автоматический переход на другой источник"
            description="Если у источника закончился лимит, ошибка, нет сети или нет ответа — попробовать следующий. Заметка всё равно будет создана: в крайнем случае текст распознаёт Tesseract."
            control={
              <Toggle
                aria-label="Автоматический переход на другой источник"
                checked={ai.autoFallback}
                onChange={(checked) => void updateAiSettings({ autoFallback: checked })}
              />
            }
          />
          <SettingsRow
            title="Беречь заканчивающиеся лимиты"
            description="Если провайдер сообщает, что осталось меньше 20%, сначала использовать другие источники."
            control={
              <Toggle
                aria-label="Беречь заканчивающиеся лимиты"
                checked={ai.protectLowLimits}
                onChange={(checked) => void updateAiSettings({ protectLowLimits: checked })}
              />
            }
          />
          <SettingsRow
            title="Подробный журнал"
            description="Записывать в журнал фрагменты ответов ИИ. По умолчанию в журнал попадают только технические данные — без ключей, токенов и текста заметок."
            control={
              <Toggle
                aria-label="Подробный журнал"
                checked={ai.debugContentLogging}
                onChange={(checked) => void updateAiSettings({ debugContentLogging: checked })}
              />
            }
          />
          <ExportKeysRow />
        </SettingsGroup>
      </Section>
    </>
  )
}

function sourcesSummary(providers: ProviderPublicState[]): string {
  const cloud = providers.filter((p) => !p.local && p.integrationEnabled && PROVIDER_CATALOG[p.id].fields.length + (p.id === 'chatgpt' ? 1 : 0) > 0)
  const connected = cloud.filter((p) => p.configured).length
  return `Подключено ${connected} из ${cloud.length}. Ключи хранятся зашифрованными средствами Windows и не покидают этот компьютер.`
}

/** Settings → … → Дополнительно → Экспорт API-ключей. The warning and the Save dialog are native, in the main process. */
function ExportKeysRow(): ReactElement {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    const response = await window.api.providers.exportKeys()
    setBusy(false)
    if (response.cancelled) return
    setResult({
      ok: response.ok,
      message: response.ok
        ? `Сохранено ключей и параметров: ${response.count}. Храните файл как пароль.`
        : (response.message ?? 'Не удалось сохранить файл.')
    })
  }

  return (
    <SettingsRow
      title="Экспорт API-ключей"
      description="Сохранить все ваши ключи в файл .env, например чтобы перенести их в другую программу. Файл содержит секреты в открытом виде — перед сохранением будет предупреждение."
      control={
        <Button size="sm" loading={busy} onClick={() => void run()}>
          Экспортировать…
        </Button>
      }
    >
      {result && (
        <p role="status" className={cn('text-sm', result.ok ? 'text-success' : 'text-danger')}>
          {result.message}
        </p>
      )}
    </SettingsRow>
  )
}

/** Every provider as a card. Fixed (priority) order, so a card never jumps while it is being set up. */
export function ProvidersList(): ReactElement {
  const providers = useAppStore((s) => s.providers)
  const [focused, setFocused] = useState<ProviderId | null>(null)

  const jumpTo = (id: ProviderId): void => {
    setFocused(id)
    requestAnimationFrame(() => document.getElementById(`provider-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} onConnectAlternative={jumpTo} forceOpen={focused === provider.id} />
      ))}
    </div>
  )
}
