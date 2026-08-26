import type { ReactElement } from 'react'
import { useAppStore } from '../store/useAppStore'
import { ChevronLeftIcon, ExternalLinkIcon } from './icons'
import { formatAccelerator } from './HotkeyRecorder'

export default function Instructions(): ReactElement {
  const settings = useAppStore((s) => s.settings)
  const backToNotes = useAppStore((s) => s.backToNotes)
  const openSettings = useAppStore((s) => s.openSettings)

  const region = settings?.hotkeys.region ?? 'Control+Shift+S'
  const fullscreen = settings?.hotkeys.fullscreen ?? 'Control+Shift+F'
  const documentHotkey = settings?.hotkeys.document ?? 'Control+Shift+D'
  const longScreenshotHotkey = settings?.hotkeys.longScreenshot ?? 'Control+Shift+L'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <button onClick={backToNotes} className="rounded-full p-2 text-muted hover:bg-bg" title="Назад">
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold text-ink">Инструкция</h1>
        </div>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Как начать за 3 шага</h2>
          <ol className="space-y-3 text-sm text-ink/90">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-light text-xs font-semibold text-accent">
                1
              </span>
              <span>
                Получите бесплатный API-ключ Gemini и вставьте его в{' '}
                <button onClick={openSettings} className="text-accent hover:underline">
                  настройках
                </button>
                .
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-light text-xs font-semibold text-accent">
                2
              </span>
              <span>Запомните хоткеи ниже — их можно изменить в настройках в любой момент.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-light text-xs font-semibold text-accent">
                3
              </span>
              <span>
                Выделите текст на экране хоткеем — он сам появится в открытой заметке (или в новой, если ни одна не
                открыта).
              </span>
            </li>
          </ol>
        </section>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Хоткеи</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-bg px-3.5 py-2.5">
              <span className="text-sm text-ink">Скриншот области экрана</span>
              <kbd className="rounded bg-surface px-2 py-1 font-mono text-xs text-ink shadow-card">
                {formatAccelerator(region)}
              </kbd>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-bg px-3.5 py-2.5">
              <span className="text-sm text-ink">Скриншот всего экрана</span>
              <kbd className="rounded bg-surface px-2 py-1 font-mono text-xs text-ink shadow-card">
                {formatAccelerator(fullscreen)}
              </kbd>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-bg px-3.5 py-2.5">
              <span className="text-sm text-ink">Документ из скриншота</span>
              <kbd className="rounded bg-surface px-2 py-1 font-mono text-xs text-ink shadow-card">
                {formatAccelerator(documentHotkey)}
              </kbd>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-bg px-3.5 py-2.5">
              <span className="text-sm text-ink">Долгий скриншот (старт/стоп)</span>
              <kbd className="rounded bg-surface px-2 py-1 font-mono text-xs text-ink shadow-card">
                {formatAccelerator(longScreenshotHotkey)}
              </kbd>
            </div>
          </div>
        </section>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Документ из скриншота</h2>
          <p className="text-sm text-muted">
            Хоткей выше или кнопка со значком страницы над основной «+» на экране заметок — заскриньте область с
            текстом и фото, и всё встанет в заметку по порядку: текст как текст, фотографии — вырезанными картинками
            на своих местах. Работает только с ключом Gemini.
          </p>
        </section>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Долгий скриншот</h2>
          <p className="text-sm text-muted">
            Нажмите хоткей и выделите область — начнётся запись. Плавно прокручивайте страницу до конца, затем
            нажмите тот же хоткей ещё раз, чтобы остановить: кадры склеятся в одну длинную картинку и лягут в новую
            заметку. Если прокручивать слишком быстро, часть содержимого между кадрами может потеряться — лучше
            скроллить не спеша. Не подходит для областей с закреплённой (не прокручивающейся) шапкой — лучше
            выделять область без неё.
          </p>
        </section>

        <section className="mb-6 rounded-2xl border border-surface-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Частые вопросы</h2>
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-medium text-ink">Хоткей не срабатывает</p>
              <p className="mt-1 text-muted">
                Возможно, комбинация занята другим приложением. Откройте настройки и назначьте другую — Snap Notes
                сразу сообщит, если комбинация недоступна.
              </p>
            </div>
            <div>
              <p className="font-medium text-ink">Ошибка с API-ключом</p>
              <p className="mt-1 text-muted">
                Проверьте ключ кнопкой «Проверить ключ» в настройках. Если ключ недействителен или превышен лимит
                запросов, приложение покажет точную причину.
              </p>
            </div>
            <div>
              <p className="font-medium text-ink">Как работает анти-дубль</p>
              <p className="mt-1 text-muted">
                Перед добавлением текста Snap Notes сравнивает его с уже сохранённым в заметке. Если текст совпадает
                или очень похож — он не добавляется повторно, чтобы не засорять заметку.
              </p>
            </div>
          </div>
        </section>

        <button
          onClick={() => void window.api.app.openExternal('https://aistudio.google.com/apikey')}
          className="flex items-center gap-1.5 text-sm text-accent hover:underline"
        >
          Получить бесплатный ключ Gemini <ExternalLinkIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
