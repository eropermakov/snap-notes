import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { OPTIONAL_HOTKEYS, type HotkeyKind, type StorageStats, type ThemeId } from '@shared/types'
import { useAppStore, type SettingsCategory } from '../store/useAppStore'
import AiRecognitionSettings from './ai/AiRecognitionSettings'
import UsageCenter from './ai/UsageCenter'
import ThemePicker from './ThemePicker'
import { HotkeyField } from './HotkeyRecorder'
import {
  Button,
  ConfirmDialog,
  NumberField,
  Page,
  PageHeader,
  Section,
  SegmentedControl,
  SettingsGroup,
  SettingsRow,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
  Toggle
} from '../ui'
import {
  DatabaseIcon,
  DownloadIcon,
  FolderIcon,
  GaugeIcon,
  HardDriveIcon,
  InfoIcon,
  KeyboardIcon,
  ResetIcon,
  ScanDocIcon,
  SlidersIcon
} from './icons'
import { formatBytes } from '../utils/format'

interface CategoryInfo {
  id: SettingsCategory
  label: string
  icon: ReactNode
  description?: string
}

const GROUPS: { title?: string; items: CategoryInfo[] }[] = [
  {
    items: [
      { id: 'general', label: 'Общие', icon: <SlidersIcon /> },
      { id: 'hotkeys', label: 'Хоткеи', icon: <KeyboardIcon />, description: 'Глобальные сочетания работают, даже когда окно Snap Notes свёрнуто.' }
    ]
  },
  {
    title: 'ИИ',
    items: [
      {
        id: 'recognition',
        label: 'ИИ и распознавание',
        icon: <ScanDocIcon />,
        description: 'Как текст со скриншотов превращается в заметку, какие ИИ-сервисы подключены и в каком порядке они используются.'
      },
      {
        id: 'usage',
        label: 'Использование',
        icon: <GaugeIcon />,
        description:
          'Проценты, остатки и время сброса показываются, только если их сообщает сам провайдер. Если провайдер ничего не сообщает, Snap Notes не угадывает.'
      }
    ]
  },
  {
    title: 'Данные',
    items: [
      { id: 'storage', label: 'Хранилище', icon: <HardDriveIcon /> },
      { id: 'data', label: 'Экспорт и сброс', icon: <DatabaseIcon /> }
    ]
  },
  { items: [{ id: 'about', label: 'О программе', icon: <InfoIcon /> }] }
]

const CATEGORIES = GROUPS.flatMap((g) => g.items)

export function settingsCategoryLabel(id: SettingsCategory): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? 'Настройки'
}

export const SETTINGS_CATEGORIES = CATEGORIES.map(({ id, label }) => ({ id, label }))

export function SettingsSidebar(): ReactElement {
  const category = useAppStore((s) => s.settingsCategory)
  const openSettings = useAppStore((s) => s.openSettings)
  return (
    <>
      <SidebarHeader title="Настройки" />
      <nav aria-label="Категории настроек" className="min-h-0 flex-1 overflow-y-auto pb-3">
        {GROUPS.map((group, i) => (
          <SidebarSection key={group.title ?? i} title={group.title}>
            {group.items.map((c) => (
              <SidebarItem key={c.id} icon={c.icon} label={c.label} active={category === c.id} onClick={() => openSettings(c.id)} />
            ))}
          </SidebarSection>
        ))}
      </nav>
    </>
  )
}

export default function Settings(): ReactElement {
  const stored = useAppStore((s) => s.settingsCategory)
  // The former "Источники" page is part of "ИИ и распознавание" now; old links keep working.
  const category: SettingsCategory = stored === 'providers' ? 'recognition' : stored
  const info = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0]
  return (
    // Re-mount per category so each page starts at the top.
    <Page key={category}>
      <PageHeader title={info.label} description={info.description} />
      {category === 'general' && <GeneralPage />}
      {category === 'hotkeys' && <HotkeysPage />}
      {category === 'recognition' && <RecognitionPage />}
      {category === 'usage' && <UsageCenter />}
      {category === 'storage' && <StoragePage />}
      {category === 'data' && <DataPage />}
      {category === 'about' && <AboutPage />}
    </Page>
  )
}

function GeneralPage(): ReactElement | null {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  if (!settings) return null
  return (
    <>
      <Section title="Внешний вид">
        <SettingsGroup>
          <ThemePicker value={settings.theme} onChange={(theme: ThemeId) => void updateSettings({ theme })} />
        </SettingsGroup>
      </Section>
      <Section title="Система">
        <SettingsGroup>
          <SettingsRow
            title="Запускать при старте Windows"
            description="Snap Notes будет автоматически запускаться после входа в систему."
            control={
              <Toggle
                aria-label="Запускать при старте Windows"
                checked={settings.launchAtStartup}
                onChange={(checked) => void updateSettings({ launchAtStartup: checked })}
              />
            }
          />
          <SettingsRow
            title="Сворачивать в трей при закрытии"
            description="Кнопка закрытия окна не завершает работу приложения — оно останется в трее."
            control={
              <Toggle
                aria-label="Сворачивать в трей при закрытии"
                checked={settings.minimizeToTray}
                onChange={(checked) => void updateSettings({ minimizeToTray: checked })}
              />
            }
          />
        </SettingsGroup>
      </Section>
    </>
  )
}

const HOTKEYS: { kind: HotkeyKind; label: string; description: string }[] = [
  { kind: 'region', label: 'Захват в заметку', description: 'Выделите область — материал встанет в открытую заметку, в место курсора.' },
  { kind: 'document', label: 'Захват в новую заметку', description: 'Новая заметка со структурой, фото и коротким названием.' },
  { kind: 'session', label: 'Сессия захвата', description: 'Несколько фрагментов подряд в одну заметку. Повторное нажатие, Enter или Esc — завершить.' },
  { kind: 'longScreenshot', label: 'Прокручиваемый захват', description: 'Нажмите, прокрутите страницу и нажмите ещё раз — получится документ.' },
  { kind: 'fullscreen', label: 'Захват всего экрана', description: 'Распознать всё, что сейчас на экране.' },
  { kind: 'copyForAi', label: 'Скопировать заметку для AI', description: 'Открытая заметка в чистом Markdown — для ChatGPT, Claude и других.' },
  { kind: 'openApp', label: 'Открыть Snap Notes', description: 'Показать окно приложения.' }
]

function HotkeysPage(): ReactElement | null {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const pushToast = useAppStore((s) => s.pushToast)
  const [errors, setErrors] = useState<Partial<Record<HotkeyKind, string>>>({})
  if (!settings) return null

  const handleChange = async (kind: HotkeyKind, accelerator: string): Promise<void> => {
    const result = await updateSettings({ hotkeys: { ...settings.hotkeys, [kind]: accelerator } })
    if (!result) return
    setErrors(Object.fromEntries(HOTKEYS.map((h) => [h.kind, result[h.kind]?.error])))
    const own = result[kind]
    if (!accelerator) pushToast('success', 'Хоткей отключён')
    else if (own?.ok) pushToast('success', 'Хоткей обновлён')
    else pushToast('error', `Не удалось назначить хоткей: ${own?.error ?? 'неизвестная ошибка'}`)
  }

  return (
    <>
      <Section title="Сочетания клавиш">
        <SettingsGroup>
          {HOTKEYS.map((h) => {
            const optional = OPTIONAL_HOTKEYS.includes(h.kind)
            return (
              <SettingsRow
                key={h.kind}
                title={h.label}
                description={h.description}
                error={errors[h.kind]}
                control={
                  <div className="flex items-center gap-1.5">
                    <HotkeyField
                      value={settings.hotkeys[h.kind]}
                      invalid={Boolean(errors[h.kind])}
                      onChange={(acc) => void handleChange(h.kind, acc)}
                      aria-label={h.label}
                    />
                    {optional && settings.hotkeys[h.kind] && (
                      <Button size="sm" variant="ghost" onClick={() => void handleChange(h.kind, '')}>
                        Отключить
                      </Button>
                    )}
                  </div>
                }
              />
            )
          })}
        </SettingsGroup>
      </Section>

      <Section title="Захват">
        <SettingsGroup>
          <SettingsRow
            title="Если ни одна заметка не открыта"
            description="Самое быстрое — сразу создавать новую заметку. Или спрашивать, куда добавить."
            control={
              <SegmentedControl
                aria-label="Если заметка не открыта"
                value={settings.captureNoNote}
                onChange={(value) => void updateSettings({ captureNoNote: value })}
                options={[
                  { value: 'new', label: 'Новая заметка' },
                  { value: 'ask', label: 'Спрашивать' }
                ]}
              />
            }
          />
        </SettingsGroup>
      </Section>
    </>
  )
}

function RecognitionPage(): ReactElement {
  return <AiRecognitionSettings />
}

function StoragePage(): ReactElement | null {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const pushToast = useAppStore((s) => s.pushToast)
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [retentionDraft, setRetentionDraft] = useState(String(settings?.screenshotCacheRetentionHours ?? 24))
  const [trashRetentionDraft, setTrashRetentionDraft] = useState(String(settings?.trashRetentionDays ?? 30))

  useEffect(() => {
    void window.api.settings.getStorageStats().then(setStats)
  }, [])

  if (!settings) return null

  const handleClearCache = async (): Promise<void> => {
    await window.api.settings.clearScreenshotCache()
    setStats(await window.api.settings.getStorageStats())
    pushToast('success', 'Кэш скриншотов очищен')
  }

  const value = (v: ReactNode): ReactNode => <span className="tabular text-base text-fg-secondary">{v}</span>

  return (
    <>
      <Section title="Занято">
        <SettingsGroup>
          <SettingsRow title="Заметки" control={value(stats ? `${stats.notesCount} · ${formatBytes(stats.notesBytes)}` : '—')} />
          <SettingsRow title="Символов всего" control={value(stats ? stats.totalCharacters.toLocaleString('ru-RU') : '—')} />
          <SettingsRow
            title="Кэш скриншотов"
            control={
              <>
                {value(stats ? `${stats.screenshotCacheCount} · ${formatBytes(stats.screenshotCacheBytes)}` : '—')}
                <Button size="sm" onClick={() => void handleClearCache()} className="ml-2">
                  Очистить
                </Button>
              </>
            }
          />
        </SettingsGroup>
      </Section>

      <Section title="Хранение">
        <SettingsGroup>
          <SettingsRow
            title="Кэшировать скриншоты"
            description="Хранить скриншоты локально ограниченное время — можно очистить вручную или дождаться автоочистки."
            control={
              <Toggle
                aria-label="Кэшировать скриншоты"
                checked={settings.screenshotCacheEnabled}
                onChange={(checked) => void updateSettings({ screenshotCacheEnabled: checked })}
              />
            }
          />
          {settings.screenshotCacheEnabled && (
            <SettingsRow
              title="Срок хранения кэша"
              description="От 1 до 168 часов."
              control={
                <NumberField
                  aria-label="Срок хранения кэша, часов"
                  min={1}
                  max={168}
                  suffix="ч"
                  value={retentionDraft}
                  onChange={setRetentionDraft}
                  onCommit={() => {
                    const hours = Math.min(168, Math.max(1, Number(retentionDraft) || 24))
                    setRetentionDraft(String(hours))
                    void updateSettings({ screenshotCacheRetentionHours: hours })
                  }}
                />
              }
            />
          )}
          <SettingsRow
            title="Срок хранения в корзине"
            description="Удалённые заметки удаляются окончательно по истечении срока. От 1 до 365 дней."
            control={
              <NumberField
                aria-label="Срок хранения в корзине, дней"
                min={1}
                max={365}
                suffix="дн."
                value={trashRetentionDraft}
                onChange={setTrashRetentionDraft}
                onCommit={() => {
                  const days = Math.min(365, Math.max(1, Number(trashRetentionDraft) || 30))
                  setTrashRetentionDraft(String(days))
                  void updateSettings({ trashRetentionDays: days })
                }}
              />
            }
          />
        </SettingsGroup>
      </Section>
    </>
  )
}

function DataPage(): ReactElement {
  const pushToast = useAppStore((s) => s.pushToast)
  const [dataPath, setDataPath] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportingDocx, setExportingDocx] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  useEffect(() => {
    void window.api.settings.getDataPath().then(setDataPath)
  }, [])

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    try {
      const result = await window.api.settings.exportNotes()
      if (result.ok) pushToast('success', `Заметки экспортированы: ${result.path}`)
      else if (!result.canceled) pushToast('error', result.message ?? 'Не удалось экспортировать заметки.')
    } finally {
      setExporting(false)
    }
  }

  const handleExportDocx = async (): Promise<void> => {
    setExportingDocx(true)
    try {
      const result = await window.api.settings.exportNotesDocx()
      if (result.ok) pushToast('success', `Документ Word сохранён: ${result.path}`)
      else if (!result.canceled) pushToast('error', result.message ?? 'Не удалось экспортировать в Word.')
    } finally {
      setExportingDocx(false)
    }
  }

  const handleReset = async (): Promise<void> => {
    setResetOpen(false)
    await window.api.settings.resetAll()
    window.location.reload()
  }

  return (
    <>
      <Section title="Папка данных">
        <SettingsGroup>
          <SettingsRow
            title="Расположение"
            description={<span className="selectable break-all">{dataPath || '…'}</span>}
            control={
              <Button size="sm" icon={<FolderIcon />} onClick={() => void window.api.settings.openDataFolder()}>
                Открыть
              </Button>
            }
          />
        </SettingsGroup>
      </Section>

      <Section title="Экспорт">
        <SettingsGroup>
          <SettingsRow
            title="Word (.docx)"
            description="Один файл со всеми заметками, включая фото. Открывается в Word и Google Docs."
            control={
              <Button size="sm" icon={<DownloadIcon />} loading={exportingDocx} onClick={() => void handleExportDocx()}>
                Экспортировать
              </Button>
            }
          />
          <SettingsRow
            title="Текст (.txt в архиве)"
            description="Каждая заметка — отдельный текстовый файл."
            control={
              <Button size="sm" icon={<DownloadIcon />} loading={exporting} onClick={() => void handleExport()}>
                Экспортировать
              </Button>
            }
          />
        </SettingsGroup>
      </Section>

      <Section title="Опасная зона">
        <SettingsGroup>
          <SettingsRow
            title="Сбросить всё"
            description="Удалить все заметки (включая корзину), ключи, вход в ChatGPT, хоткеи, кэш и настройки."
            control={
              <Button size="sm" variant="danger-ghost" icon={<ResetIcon />} onClick={() => setResetOpen(true)}>
                Сбросить
              </Button>
            }
          />
        </SettingsGroup>
      </Section>

      <ConfirmDialog
        open={resetOpen}
        title="Сбросить всё?"
        description="Будут безвозвратно удалены все заметки (включая корзину), API-ключи, вход в ChatGPT, хоткеи, кэш скриншотов и остальные настройки."
        confirmLabel="Сбросить"
        danger
        onCancel={() => setResetOpen(false)}
        onConfirm={() => void handleReset()}
      />
    </>
  )
}

function AboutPage(): ReactElement {
  const openWhatsNew = useAppStore((s) => s.openWhatsNew)
  const openInstructions = useAppStore((s) => s.openInstructions)
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void window.api.app.getVersion().then(setVersion)
  }, [])

  const handleCheck = async (): Promise<void> => {
    setChecking(true)
    setMessage('')
    try {
      const result = await window.api.app.checkForUpdates()
      setMessage(result.message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <SettingsGroup>
      <SettingsRow title="Snap Notes" description={message || `Версия ${version}`} control={
        <Button size="sm" loading={checking} onClick={() => void handleCheck()}>
          {checking ? 'Проверка…' : 'Проверить обновления'}
        </Button>
      } />
      <SettingsRow title="Что нового" description="Изменения в этой версии." control={<Button size="sm" variant="ghost" onClick={openWhatsNew}>Открыть</Button>} />
      <SettingsRow title="Справка" description="Хоткеи, возможности и частые вопросы." control={<Button size="sm" variant="ghost" onClick={openInstructions}>Открыть</Button>} />
    </SettingsGroup>
  )
}
