import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { OPTIONAL_HOTKEYS, type CardSize, type HotkeyKind, type OcrFeedback, type StorageStats, type ThemeId } from '@shared/types'
import { SORT_LABELS, type SortOrder } from '@shared/noteList'
import { BUNDLED_EDITOR_FONTS, EDITOR_FONTS, FONT_SIZE_MAX, FONT_SIZE_MIN } from '@shared/settingsSanitize'
import { useAppStore, type SettingsCategory } from '../store/useAppStore'
import AiRecognitionSettings from './ai/AiRecognitionSettings'
import UsageCenter from './ai/UsageCenter'
import ThemePicker from './ThemePicker'
import { HotkeyField } from './HotkeyRecorder'
import {
  Button,
  ConfirmDialog,
  NumberField,
  Select,
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
  EditIcon,
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
      { id: 'editor', label: 'Редактор', icon: <EditIcon />, description: 'Шрифт и размер текста в заметках. Интерфейс приложения не меняется, а код всегда набирается моноширинным шрифтом.' },
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
      {category === 'editor' && <EditorPage />}
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
      <Section title="Заметки">
        <SettingsGroup>
          <SettingsRow
            title="Порядок заметок"
            description="Закреплённые заметки всегда выше остальных."
            control={
              <Select
                aria-label="Порядок заметок"
                value={settings.sortOrder}
                onChange={(e) => void updateSettings({ sortOrder: e.target.value as SortOrder })}
                wrapperClassName="w-52"
              >
                {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </Select>
            }
          />
          <SettingsRow
            title="Размер карточек"
            description="Ширина, отступы и длина предпросмотра."
            control={
              <SegmentedControl
                aria-label="Размер карточек"
                value={settings.cardSize}
                onChange={(value: CardSize) => void updateSettings({ cardSize: value })}
                options={[
                  { value: 'small', label: 'Малые' },
                  { value: 'medium', label: 'Средние' },
                  { value: 'large', label: 'Крупные' }
                ]}
              />
            }
          />
          <SettingsRow
            title="Компактная сетка"
            description="Меньше промежутков и короче предпросмотр — больше заметок на экране."
            control={<Toggle aria-label="Компактная сетка" checked={settings.compactGrid} onChange={(checked) => void updateSettings({ compactGrid: checked })} />}
          />
          <SettingsRow
            title="Открывать последнюю заметку при запуске"
            description="Если заметка уже удалена, откроется обычный экран со списком."
            control={<Toggle aria-label="Открывать последнюю заметку при запуске" checked={settings.restoreLastNote} onChange={(checked) => void updateSettings({ restoreLastNote: checked })} />}
          />
          <SettingsRow
            title="Сворачивать боковую панель в узком окне"
            description="В узком окне панель выезжает по кнопке и не занимает место. Ваш выбор (открыта или закрыта) запоминается."
            control={<Toggle aria-label="Сворачивать боковую панель в узком окне" checked={settings.autoCollapseSidebar} onChange={(checked) => void updateSettings({ autoCollapseSidebar: checked })} />}
          />
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
  { kind: 'openApp', label: 'Открыть Snap Notes', description: 'Показать окно приложения.' },
  { kind: 'quickNote', label: 'Быстрая заметка', description: 'Маленькое окно поверх любой программы: напишите и нажмите Ctrl+Enter. Главное окно не открывается.' },
  { kind: 'repeatCapture', label: 'Повторить последний захват', description: 'Снова захватить ту же область экрана. Если экраны изменились — предложит выделить заново.' },
  { kind: 'ocrClipboard', label: 'Распознать картинку из буфера', description: 'Текст с изображения, которое сейчас в буфере обмена.' },
  { kind: 'globalSearch', label: 'Поиск по заметкам', description: 'Показать Snap Notes и сразу открыть поиск.' }
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
          <SettingsRow
            title="Когда распознавание закончилось"
            description="Короткое окошко «Добавлено в …» с кнопками «Отменить» и «Открыть». Звук тихий и короткий."
            control={
              <SegmentedControl
                aria-label="Уведомление о завершении распознавания"
                value={settings.ocrFeedback}
                onChange={(value: OcrFeedback) => void updateSettings({ ocrFeedback: value })}
                options={[
                  { value: 'none', label: 'Ничего' },
                  { value: 'visual', label: 'Окошко' },
                  { value: 'sound', label: 'Окошко и звук' }
                ]}
              />
            }
          />
          <SettingsRow
            title="Распознавать в фоне"
            description="Скриншоты встают в очередь и распознаются по порядку, пока вы продолжаете работу. Если выключить, снимки сохраняются, но обрабатываются только после включения."
            control={
              <Toggle
                aria-label="Распознавать в фоне"
                checked={settings.ocrQueueEnabled}
                onChange={(checked) => void updateSettings({ ocrQueueEnabled: checked })}
              />
            }
          />
          <SettingsRow
            title="Убирать повторы при распознавании"
            description="Убирает зациклившийся ответ ИИ (одна и та же строка много раз подряд) и строки, которые уже были в конце предыдущего снимка, если вы снимали длинную страницу по частям. Оригинал снимка остаётся в заметке."
            control={
              <Toggle
                aria-label="Убирать повторы при распознавании"
                checked={settings.ocrTrimRepeats}
                onChange={(checked) => void updateSettings({ ocrTrimRepeats: checked })}
              />
            }
          />
          <SettingsRow
            title="Одновременных запросов к ИИ"
            description="По умолчанию 1 — самый бережный к лимитам вариант. Текст в заметке в любом случае встаёт в порядке снимков."
            control={
              <Select
                aria-label="Одновременных запросов к ИИ"
                value={String(settings.ocrMaxConcurrent)}
                onChange={(e) => void updateSettings({ ocrMaxConcurrent: Number(e.target.value) })}
                wrapperClassName="w-24"
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </Select>
            }
          />
          <SettingsRow
            title="Предлагать распознать картинку из буфера"
            description="Когда вы копируете изображение, появится маленькая подсказка. Для одной и той же картинки — только один раз."
            control={
              <Toggle
                aria-label="Предлагать распознать картинку из буфера"
                checked={settings.suggestClipboardOcr}
                onChange={(checked) => void updateSettings({ suggestClipboardOcr: checked })}
              />
            }
          />
        </SettingsGroup>
      </Section>
    </>
  )
}

function EditorPage(): ReactElement | null {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [sizeDraft, setSizeDraft] = useState(String(settings?.editorFontSize ?? 14))
  // Only fonts that are really installed are offered.
  const [installed, setInstalled] = useState<string[]>([])

  useEffect(() => {
    const check = (name: string): boolean => {
      try {
        return document.fonts.check(`16px "${name}"`)
      } catch {
        return false
      }
    }
    void document.fonts.ready.then(() => setInstalled(EDITOR_FONTS.filter(check)))
  }, [])

  if (!settings) return null
  const current = settings.editorFontFamily
  const bundled = BUNDLED_EDITOR_FONTS.some((name) => `${name} Variable` === current)
  const options = current && !bundled && !installed.includes(current) ? [current, ...installed] : installed

  return (
    <>
      <Section title="Текст заметок">
        <SettingsGroup>
          <SettingsRow
            title="Шрифт"
            description="12 встроенных шрифтов с кириллицей работают без интернета. Выберите удобный для чтения — пример ниже."
            control={
              <Select aria-label="Шрифт редактора" value={current} onChange={(e) => void updateSettings({ editorFontFamily: e.target.value })} wrapperClassName="w-56">
                <option value="">Как в приложении</option>
                <optgroup label="Встроенные · с кириллицей">
                  {BUNDLED_EDITOR_FONTS.map((name) => <option key={name} value={`${name} Variable`}>{name}</option>)}
                </optgroup>
                <optgroup label="Системные">
                  {options.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              </Select>
            }
          />
          <SettingsRow
            title="Размер шрифта"
            description={`От ${FONT_SIZE_MIN} до ${FONT_SIZE_MAX} px.`}
            control={
              <NumberField
                aria-label="Размер шрифта, px"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                suffix="px"
                value={sizeDraft}
                onChange={setSizeDraft}
                onCommit={() => {
                  const size = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(Number(sizeDraft)) || 14))
                  setSizeDraft(String(size))
                  void updateSettings({ editorFontSize: size })
                }}
              />
            }
          />
        </SettingsGroup>
      </Section>
      <Section title="Пример">
        <div
          className="rich-content rounded-xl border border-line p-4 text-fg"
          style={
            {
              '--editor-font': current ? `"${current}", sans-serif` : 'inherit',
              '--editor-size': `${settings.editorFontSize}px`
            } as CSSProperties
          }
        >
          <p>Хорошие мысли любят свободное место. Запишите главное, добавьте детали и вернитесь к ним, когда будет удобно.</p>
          <p>Обычный текст, <strong>важная мысль</strong> и <em>тихая ремарка</em>. Цифры: 0123456789. English text.</p>
          <pre>
            <code>const code = 'всегда моноширинный'</code>
          </pre>
        </div>
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
