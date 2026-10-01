import type { ReactElement, ReactNode } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Kbd, LinkButton, Page, PageHeader, Section, SettingsGroup, SettingsRow, SidebarHeader, SidebarItem, SidebarSection } from '../ui'
import { ExternalLinkIcon } from './icons'
import { formatAccelerator } from './HotkeyRecorder'

const TOC = [
  { id: 'help-start', label: 'Как начать' },
  { id: 'help-hotkeys', label: 'Хоткеи захвата' },
  { id: 'help-app-keys', label: 'Клавиши приложения' },
  { id: 'help-document', label: 'Документ из скриншота' },
  { id: 'help-long', label: 'Долгий скриншот' },
  { id: 'help-faq', label: 'Частые вопросы' }
]

export function HelpSidebar(): ReactElement {
  return (
    <>
      <SidebarHeader title="Справка" />
      <SidebarSection>
        {TOC.map((t) => (
          <SidebarItem
            key={t.id}
            label={t.label}
            onClick={() => document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
        ))}
      </SidebarSection>
    </>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }): ReactElement {
  return (
    <li className="flex gap-4 py-3">
      <span className="tabular w-4 shrink-0 text-base text-fg-muted">{n}</span>
      <span className="text-base text-fg">{children}</span>
    </li>
  )
}

function Shortcut({ keys }: { keys: string }): ReactElement {
  return <Kbd>{keys}</Kbd>
}

export default function Instructions(): ReactElement {
  const settings = useAppStore((s) => s.settings)
  const openSettings = useAppStore((s) => s.openSettings)

  const hk = settings?.hotkeys
  const region = hk?.region ?? 'Control+Shift+S'
  const fullscreen = hk?.fullscreen ?? 'Control+Shift+F'
  const documentHotkey = hk?.document ?? 'Control+Shift+D'
  const longScreenshotHotkey = hk?.longScreenshot ?? 'Control+Shift+L'

  return (
    <Page>
      <PageHeader title="Справка" description="Snap Notes превращает текст с экрана в аккуратные заметки." />

      <Section id="help-start" title="Как начать">
        <ol className="divide-y divide-line border-y border-line">
          <Step n={1}>
            Подключите источник распознавания в{' '}
            <LinkButton className="text-base" onClick={() => openSettings('providers')}>
              настройках
            </LinkButton>{' '}
            — например, аккаунт ChatGPT или бесплатный ключ Gemini. Без него работает локальный Tesseract.
          </Step>
          <Step n={2}>Запомните хоткеи ниже — их можно изменить в настройках в любой момент.</Step>
          <Step n={3}>
            Выделите текст на экране хоткеем — он сам появится в открытой заметке (или в новой, если ни одна не открыта).
          </Step>
        </ol>
      </Section>

      <Section id="help-hotkeys" title="Хоткеи захвата" description="Работают глобально, даже когда окно свёрнуто в трей.">
        <SettingsGroup>
          <SettingsRow title="Скриншот области экрана" control={<Shortcut keys={formatAccelerator(region)} />} />
          <SettingsRow title="Скриншот всего экрана" control={<Shortcut keys={formatAccelerator(fullscreen)} />} />
          <SettingsRow title="Документ из скриншота" control={<Shortcut keys={formatAccelerator(documentHotkey)} />} />
          <SettingsRow title="Долгий скриншот (старт/стоп)" control={<Shortcut keys={formatAccelerator(longScreenshotHotkey)} />} />
        </SettingsGroup>
      </Section>

      <Section id="help-app-keys" title="Клавиши приложения">
        <SettingsGroup>
          <SettingsRow title="Команды и быстрый переход" control={<Shortcut keys="Ctrl + K" />} />
          <SettingsRow title="Новая заметка" control={<Shortcut keys="Ctrl + N" />} />
          <SettingsRow title="Поиск по заметкам" control={<Shortcut keys="Ctrl + F" />} />
          <SettingsRow title="Показать или скрыть боковую панель" control={<Shortcut keys="Ctrl + \" />} />
          <SettingsRow title="Настройки" control={<Shortcut keys="Ctrl + ," />} />
          <SettingsRow title="Закрыть заметку или окно" control={<Shortcut keys="Esc" />} />
          <SettingsRow title="Действия с заметкой" description="Правый клик по карточке или строке в списке." control={<Shortcut keys="ПКМ" />} />
        </SettingsGroup>
      </Section>

      <Section id="help-document" title="Документ из скриншота">
        <p className="text-base text-fg-secondary">
          Хоткей выше или кнопка со значком сканирования в шапке заметок — заскриньте область с текстом и фото, и всё встанет в
          заметку по порядку: текст как текст, фотографии — вырезанными картинками на своих местах. Работает только с ключом
          Gemini.
        </p>
      </Section>

      <Section id="help-long" title="Долгий скриншот">
        <p className="text-base text-fg-secondary">
          Нажмите хоткей и выделите область — начнётся запись. Плавно прокручивайте страницу до конца, затем нажмите тот же хоткей
          ещё раз, чтобы остановить: кадры склеятся в одну длинную картинку. Если задан ключ Gemini — склеенный скриншот
          дополнительно распознаётся: текст добавится как обычный текст заметки, а фотографии внутри — вырезанными картинками на
          своих местах. Без ключа Gemini заметка получит просто длинную картинку целиком.
        </p>
        <p className="mt-3 text-base text-fg-secondary">
          Если прокручивать слишком быстро, часть содержимого между кадрами может потеряться — лучше скроллить не спеша. Не
          подходит для областей с закреплённой (не прокручивающейся) шапкой — лучше выделять область без неё.
        </p>
      </Section>

      <Section id="help-faq" title="Частые вопросы">
        <div className="divide-y divide-line border-y border-line">
          {[
            [
              'Хоткей не срабатывает',
              'Возможно, комбинация занята другим приложением. Откройте настройки и назначьте другую — Snap Notes сразу сообщит, если комбинация недоступна.'
            ],
            [
              'Ошибка с API-ключом',
              'Откройте Настройки → Источники и нажмите «Проверить подключение». Если ключ недействителен или превышен лимит запросов, приложение покажет точную причину.'
            ],
            [
              'Как работает анти-дубль',
              'Перед добавлением текста Snap Notes сравнивает его с уже сохранённым в заметке. Если текст совпадает или очень похож — он не добавляется повторно.'
            ],
            ['Куда делась удалённая заметка', 'В корзину: она в боковой панели раздела «Заметки». Оттуда заметку можно восстановить.']
          ].map(([q, a]) => (
            <div key={q} className="py-3.5">
              <p className="text-base font-medium text-fg">{q}</p>
              <p className="mt-1 text-base text-fg-secondary">{a}</p>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <LinkButton onClick={() => void window.api.app.openExternal('https://aistudio.google.com/apikey')}>
            Получить бесплатный ключ Gemini <ExternalLinkIcon className="h-3 w-3" />
          </LinkButton>
        </div>
      </Section>
    </Page>
  )
}
