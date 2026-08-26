import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { AiKeyEntry, OcrPreset, StorageStats, ThemeId } from '@shared/types'
import { OCR_PRESETS } from '@shared/ocrPresets'
import { useAppStore } from '../store/useAppStore'
import AiKeysManager from './AiKeysManager'
import ThemePicker from './ThemePicker'
import HotkeyRecorder from './HotkeyRecorder'
import Switch from './Switch'
import ConfirmModal from './ConfirmModal'
import { ChevronLeftIcon, FolderIcon, DownloadIcon, ResetIcon } from './icons'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

export default function Settings(): ReactElement {
  const settings = useAppStore((s) => s.settings)
  const backToNotes = useAppStore((s) => s.backToNotes)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const pushToast = useAppStore((s) => s.pushToast)

  const [aiKeysDraft, setAiKeysDraft] = useState<AiKeyEntry[]>(settings?.aiKeys ?? [])
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [hotkeyErrors, setHotkeyErrors] = useState<{
    region?: string
    fullscreen?: string
    document?: string
    longScreenshot?: string
  }>({})
  const [dataPath, setDataPath] = useState('')
  const [version, setVersion] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportingDocx, setExportingDocx] = useState(false)
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [retentionDraft, setRetentionDraft] = useState(String(settings?.screenshotCacheRetentionHours ?? 24))
  const [trashRetentionDraft, setTrashRetentionDraft] = useState(String(settings?.trashRetentionDays ?? 30))
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateCheckMessage, setUpdateCheckMessage] = useState('')
  const aiKeysDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    void window.api.settings.getDataPath().then(setDataPath)
    void window.api.app.getVersion().then(setVersion)
    void window.api.settings.getUsage().then(setUsage)
    void window.api.settings.getStorageStats().then(setStats)
  }, [])

  useEffect(() => {
    return () => {
      if (aiKeysDebounce.current) clearTimeout(aiKeysDebounce.current)
    }
  }, [])

  if (!settings) return <div />

  const handleAiKeysChange = (keys: AiKeyEntry[]): void => {
    setAiKeysDraft(keys)
    if (aiKeysDebounce.current) clearTimeout(aiKeysDebounce.current)
    aiKeysDebounce.current = setTimeout(() => {
      void updateSettings({ aiKeys: keys })
    }, 500)
  }

  const handlePresetChange = (preset: OcrPreset): void => {
    void updateSettings({ ocrPreset: preset })
  }

  const handleThemeChange = (theme: ThemeId): void => {
    void updateSettings({ theme })
  }

  const handleHotkeyChange = async (
    kind: 'region' | 'fullscreen' | 'document' | 'longScreenshot',
    accelerator: string
  ): Promise<void> => {
    const nextHotkeys = { ...settings.hotkeys, [kind]: accelerator }
    const result = await updateSettings({ hotkeys: nextHotkeys })
    if (result) {
      setHotkeyErrors({
        region: result.region.error,
        fullscreen: result.fullscreen.error,
        document: result.document.error,
        longScreenshot: result.longScreenshot.error
      })
      const thisResult = result[kind]
      if (thisResult.ok) {
        pushToast('success', 'Хоткей обновлён')
      } else {
        pushToast('error', `Не удалось назначить хоткей: ${thisResult.error}`)
      }
    }
  }

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    try {
      const result = await window.api.settings.exportNotes()
      if (result.ok) {
        pushToast('success', `Заметки экспортированы: ${result.path}`)
      } else if (!result.canceled) {
        pushToast('error', result.message ?? 'Не удалось экспортировать заметки.')
      }
    } finally {
      setExporting(false)
    }
  }

  const handleExportDocx = async (): Promise<void> => {
    setExportingDocx(true)
    try {
      const result = await window.api.settings.exportNotesDocx()
      if (result.ok) {
        pushToast('success', `Документ Word сохранён: ${result.path}`)
      } else if (!result.canceled) {
        pushToast('error', result.message ?? 'Не удалось экспортировать в Word.')
      }
    } finally {
      setExportingDocx(false)
    }
  }

  const handleClearCache = async (): Promise<void> => {
    await window.api.settings.clearScreenshotCache()
    const fresh = await window.api.settings.getStorageStats()
    setStats(fresh)
    pushToast('success', 'Кэш скриншотов очищен')
  }

  const handleCheckUpdates = async (): Promise<void> => {
    setCheckingUpdate(true)
    setUpdateCheckMessage('')
    try {
      const result = await window.api.app.checkForUpdates()
      setUpdateCheckMessage(result.message)
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleReset = async (): Promise<void> => {
    setResetOpen(false)
    await window.api.settings.resetAll()
    window.location.reload()
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <button onClick={backToNotes} className="rounded-full p-2 text-muted transition hover:bg-surface active:scale-[0.97]" title="Назад">
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold text-ink">Настройки</h1>
        </div>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <AiKeysManager keys={aiKeysDraft} usage={usage} onChange={handleAiKeysChange} />

          {aiKeysDraft.some((k) => k.provider === 'local') && (
            <div className="mt-4 border-t border-surface-border pt-4">
              <Switch
                label="Экономный режим"
                description="Сначала бесплатное локальное распознавание, затем облачный ИИ только причёсывает уже готовый текст — расходует в разы меньше лимита, чем отправка картинки целиком"
                checked={settings.useHybridPipeline}
                onChange={(checked) => void updateSettings({ useHybridPipeline: checked })}
              />
            </div>
          )}
        </section>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Стиль распознавания</h2>
          <p className="mb-3 text-xs text-muted">Как причёсывать текст со скриншотов.</p>
          <div className="grid grid-cols-2 gap-2">
            {OCR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetChange(preset.id)}
                className={`rounded-lg border p-2.5 text-left transition active:scale-[0.98] ${
                  settings.ocrPreset === preset.id
                    ? 'border-accent bg-accent-light'
                    : 'border-surface-border hover:border-accent/50'
                }`}
              >
                <p className="text-sm font-medium text-ink">{preset.label}</p>
                <p className="text-xs text-muted">{preset.description}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Тема оформления</h2>
          <ThemePicker value={settings.theme} onChange={handleThemeChange} />
        </section>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Хоткеи</h2>
          <div className="divide-y divide-surface-border">
            <HotkeyRecorder
              label="Скриншот области экрана"
              value={settings.hotkeys.region}
              error={hotkeyErrors.region}
              onChange={(acc) => void handleHotkeyChange('region', acc)}
            />
            <HotkeyRecorder
              label="Скриншот всего экрана"
              value={settings.hotkeys.fullscreen}
              error={hotkeyErrors.fullscreen}
              onChange={(acc) => void handleHotkeyChange('fullscreen', acc)}
            />
            <HotkeyRecorder
              label="Документ из скриншота"
              value={settings.hotkeys.document}
              error={hotkeyErrors.document}
              onChange={(acc) => void handleHotkeyChange('document', acc)}
            />
            <HotkeyRecorder
              label="Долгий скриншот (старт/стоп)"
              value={settings.hotkeys.longScreenshot}
              error={hotkeyErrors.longScreenshot}
              onChange={(acc) => void handleHotkeyChange('longScreenshot', acc)}
            />
          </div>
        </section>

        <section className="mb-6 divide-y divide-surface-border rounded-2xl border border-surface-border bg-surface p-5">
          <Switch
            label="Запускать при старте Windows"
            description="Snap Notes будет автоматически запускаться после входа в систему"
            checked={settings.launchAtStartup}
            onChange={(checked) => void updateSettings({ launchAtStartup: checked })}
          />
          <Switch
            label="Сворачивать в трей при закрытии"
            description="Кнопка закрытия окна не завершает работу приложения — оно останется в трее"
            checked={settings.minimizeToTray}
            onChange={(checked) => void updateSettings({ minimizeToTray: checked })}
          />
        </section>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Хранилище</h2>
          {stats && (
            <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted">Заметки</p>
                <p className="font-medium text-ink">
                  {stats.notesCount} · {formatBytes(stats.notesBytes)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">Символов всего</p>
                <p className="font-medium text-ink">{stats.totalCharacters.toLocaleString('ru-RU')}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Кэш скриншотов</p>
                <p className="font-medium text-ink">
                  {stats.screenshotCacheCount} · {formatBytes(stats.screenshotCacheBytes)}
                </p>
              </div>
            </div>
          )}

          <Switch
            label="Кэшировать скриншоты"
            description="Хранить скриншоты локально ограниченное время — можно очистить вручную или дождаться автоочистки"
            checked={settings.screenshotCacheEnabled}
            onChange={(checked) => void updateSettings({ screenshotCacheEnabled: checked })}
          />

          {settings.screenshotCacheEnabled && (
            <div className="mb-3 mt-2 flex items-center gap-2">
              <label className="text-sm text-ink">Хранить, часов:</label>
              <input
                type="number"
                min={1}
                max={168}
                value={retentionDraft}
                onChange={(e) => setRetentionDraft(e.target.value)}
                onBlur={() => {
                  const hours = Math.min(168, Math.max(1, Number(retentionDraft) || 24))
                  setRetentionDraft(String(hours))
                  void updateSettings({ screenshotCacheRetentionHours: hours })
                }}
                className="w-20 rounded-lg border border-surface-border bg-bg px-2 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
              />
            </div>
          )}

          <button
            onClick={() => void handleClearCache()}
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-surface-border bg-bg px-3.5 py-2 text-sm font-medium text-ink transition hover:border-accent active:scale-[0.97]"
          >
            Очистить кэш скриншотов
          </button>
        </section>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Корзина</h2>
          <p className="mb-3 text-xs text-muted">Удалённые заметки хранятся в корзине и удаляются окончательно автоматически по истечении срока.</p>
          <div className="flex items-center gap-2">
            <label className="text-sm text-ink">Хранить, дней:</label>
            <input
              type="number"
              min={1}
              max={365}
              value={trashRetentionDraft}
              onChange={(e) => setTrashRetentionDraft(e.target.value)}
              onBlur={() => {
                const days = Math.min(365, Math.max(1, Number(trashRetentionDraft) || 30))
                setTrashRetentionDraft(String(days))
                void updateSettings({ trashRetentionDays: days })
              }}
              className="w-20 rounded-lg border border-surface-border bg-bg px-2 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
            />
          </div>
        </section>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Данные</h2>
          <p className="mb-3 break-all text-xs text-muted">{dataPath}</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void window.api.settings.openDataFolder()}
              className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-bg px-3.5 py-2 text-sm font-medium text-ink transition hover:border-accent active:scale-[0.97]"
            >
              <FolderIcon className="h-4 w-4" /> Открыть папку
            </button>
            <button
              onClick={() => void handleExport()}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-bg px-3.5 py-2 text-sm font-medium text-ink transition hover:border-accent active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
            >
              <DownloadIcon className="h-4 w-4" /> {exporting ? 'Экспорт...' : 'Экспортировать в .txt (архив)'}
            </button>
            <button
              onClick={() => void handleExportDocx()}
              disabled={exportingDocx}
              className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-bg px-3.5 py-2 text-sm font-medium text-ink transition hover:border-accent active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
              title="Один .docx-файл со всеми заметками, включая фото — открывается в Word и Google Docs"
            >
              <DownloadIcon className="h-4 w-4" /> {exportingDocx ? 'Экспорт...' : 'Экспортировать в Word (.docx)'}
            </button>
            <button
              onClick={() => setResetOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-danger/40 bg-surface px-3.5 py-2 text-sm font-medium text-danger transition hover:bg-danger-light active:scale-[0.97]"
            >
              <ResetIcon className="h-4 w-4" /> Сбросить всё
            </button>
          </div>
        </section>

        <div className="text-center">
          <p className="text-xs text-muted">Snap Notes {version}</p>
          <button
            onClick={() => void handleCheckUpdates()}
            disabled={checkingUpdate}
            className="mt-1 text-xs text-accent hover:underline disabled:opacity-50"
          >
            {checkingUpdate ? 'Проверка...' : 'Проверить обновления'}
          </button>
          {updateCheckMessage && <p className="mt-1 text-xs text-muted">{updateCheckMessage}</p>}
        </div>
      </div>

      <ConfirmModal
        open={resetOpen}
        title="Сбросить всё?"
        description="Будут безвозвратно удалены все заметки (включая корзину), API-ключи, хоткеи, кэш скриншотов и остальные настройки."
        confirmLabel="Сбросить"
        danger
        onCancel={() => setResetOpen(false)}
        onConfirm={() => void handleReset()}
      />
    </div>
  )
}
