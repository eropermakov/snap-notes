# Snap Notes — контекст проекта (для продолжения в новом чате)

Вставьте этот файл целиком первым сообщением в новый чат, чтобы Claude сразу понимал текущее состояние проекта.

## Что это

Snap Notes — десктоп-приложение для Windows (Electron + React + TypeScript), заметки в стиле Google Keep/Docs с суперспособностью: глобальный хоткей делает скриншот экрана, распознаёт текст (Gemini / Groq / локальный офлайн-OCR) и аккуратно причёсывает его прямо в открытой заметке.

- **Путь проекта:** `D:\SirVault\WeewScan 1`
- **Репозиторий:** https://github.com/eropermakov/snap-notes (код запушен, история коммитов сохранена)
- **Релизы:** https://github.com/eropermakov/snap-notes/releases — там же лежат `.exe`-установщики
- **Текущая версия:** 1.4.0
- **Язык интерфейса:** русский, везде

## Стек

Electron + React 19 + TypeScript (через `electron-vite`), Tailwind CSS (v3, через CSS-переменные для тем), Framer Motion, Zustand, `electron-store`, `electron-updater`, `@google/genai` (Gemini), Groq (обычный REST-фетч, OpenAI-совместимый), `tesseract.js` (локальный OCR), `auto-launch`, `adm-zip`, `sanitize-html`, `string-similarity`, `react-masonry-css`, `electron-builder` (NSIS-установщик).

## Как запустить

```bash
npm install
npm run dev          # разработка, окно с hot-reload
npm run typecheck    # проверка типов
npm run build         # прод-сборка в out/
npm run dist          # собрать установщик локально (release/)
npm run release       # собрать И опубликовать релиз на GitHub (нужен GH_TOKEN)
```

`GH_TOKEN` уже сохранён как **постоянная переменная окружения пользователя** на этой машине (через `setx`), так что `npm run release` можно гонять без повторного ввода токена в новых терминалах (в уже открытых терминалах нужно их перезапустить, чтобы переменная подхватилась).

## Полный список того, что уже сделано

### Базовая функциональность (v1.0)
- Сетка/список заметок с поиском, закреплением, удалением
- Глобальные хоткеи (настраиваемые, с детектом конфликтов) — выделение области экрана и захват всего экрана
- Оверлей выделения области — **предзагружен и живёт в фоне** (не пересоздаётся на каждый захват — так быстрее)
- Первый визард настройки, трей, автозапуск через Windows, сворачивание в трей
- Экспорт заметок в `.zip`, полный сброс данных

### Большой апдейт v1.1
- **Редактор** — закреплённая панель справа (не модалка), rich-text: жирный/подчёркнутый/зачёркнутый/выделение цветом/заголовок/списки/чек-листы (через `document.execCommand` в `contentEditable`)
- **Тело заметки хранится как HTML** (было — plain text), с миграцией старых заметок и двойной санитизацией (`sanitize-html` в main-процессе + собственный DOMParser-санитайзер в renderer перед `dangerouslySetInnerHTML`)
- **Умная структура распознавания**: ИИ-провайдеры возвращают не голый текст, а JSON-массив типизированных блоков (`paragraph`/`heading`/`list`/`table`/`button`/`label`) — см. `src/shared/ocrBlocks.ts`. Дальше **чистый код без ИИ** (`renderBlocksToHtml`) превращает это в HTML: кнопки → чипы, таблицы → `<table>`, списки → `<ul>/<ol>`. При дописывании в существующую заметку в промпт передаётся хвост уже написанного текста для контекста.
- **4 пресета стиля распознавания**: Как есть / Формально / Свободно / Структурно (`src/shared/ocrPresets.ts`)
- **8 тем**: зелёная/красная/синяя/жёлтая × светлая/тёмная, через CSS custom properties + атрибут `data-theme` на `<html>` (`src/shared/themes.ts`, `src/renderer/src/styles/index.css`)
- **Несколько источников распознавания с фолбэком по порядку**: Gemini, Groq, локальный Tesseract (`src/main/ai/` — `gemini.ts`, `groq.ts`, `local.ts`, `router.ts`). Пользователь добавляет сколько угодно ключей в Настройках, приложение пробует их по очереди при ошибке/лимите
- **«Экономный режим»** — если есть и локальный, и облачный источник: сначала бесплатный Tesseract вытаскивает сырой текст, потом облачная модель только причёсывает уже готовый текст (намного дешевле по токенам, чем слать картинку) — `extractHtmlHybrid` в `router.ts`, тумблер в Настройках
- **Корзина**: мягкое удаление (`deletedAt` в заметке), авто-очистка по таймеру (настраиваемый срок хранения), ручное восстановление/удаление, отдельная вкладка
- **Эмодзи-аватарки заметок**: подсказки по ключевым словам без AI-запросов (`src/shared/emojiSuggest.ts`) + сетка популярных эмодзи
- **Эвристика неполноты** (НЕ фактчекинг!) — если распознанный текст похож на обрезанный (обрыв на полуслове, многоточие и т.п.), в заметку добавляется красная пометка `⚠️ Похоже, текст поместился не полностью` (`src/shared/completeness.ts`). Осознанно НЕ делали проверку достоверности информации — это ненадёжно
- **Кэш скриншотов**: TTL, ручная и авто-очистка, статистика по размеру в Настройках (`src/main/screenshotCache.ts`)
- **Автообновление через GitHub Releases** (`src/main/updater.ts`, `electron-updater`): проверка при старте + раз в 4 часа, автозагрузка в фоне, баннер «Перезапустить» снизу экрана (`UpdateBanner.tsx`), плюс ручная кнопка «Проверить обновления» в Настройках
- **Версионирование + changelog**: `CHANGELOG.md` (для людей) + `src/shared/changelog.ts` (структурированные данные для диалога «Что нового» в приложении) — **держать в синхроне вручную**
- **Редизайн** в духе Google Docs (нейтральные фоны вместо тёплого крема, через семантические цветовые токены `bg`/`surface`/`accent`/`success`/`warning`/`danger`)

### Архитектура ИИ-провайдеров (v1.4)
- Код: `src/main/providers/` — `AIProvider` (types.ts), `ProviderManager` (manager.ts, единственная точка входа для OCR и UI), `planRoute`/`runWithFallback` (router.ts, чистые функции), `UsageService` (статусы, лимиты, один таймер до ближайшего сброса), `ActivityLog` (собственная статистика — НЕ остаток лимита), `RecognitionService` (режимы best/balanced/economy/offline), `settingsMigration.ts`, `featureFlags.ts`. Реализации — `impl/` (chatgpt, claudeSubscription, gemini, groq, openaiApi, anthropicApi, tesseract). Общие типы — `src/shared/providers.ts`
- **ChatGPT-план**: официальный Sign in with ChatGPT; SDK `@siwc/local` не опубликован в npm → лежит в `src/main/vendor/siwc-local/` (лицензия **только для некоммерческого использования**, изменения описаны в NOTICE.md). Остаток лимита OpenAI программно не отдаёт → только «Управление использованием»
- **Claude-подписка**: Anthropic запрещает сторонним приложениям вход через claude.ai — провайдер-заглушка без кода аутентификации; для Claude используется Anthropic API
- Ключи — `userData/secrets.json`, шифрование Electron safeStorage (DPAPI). В renderer ключи и токены не попадают никогда (`getPublicSettings`, `ProviderPublicState`)
- Тесты: `npm test` (vitest, только моки, реальные API не вызываются) — `tests/providers/`
- Журнал: `userData/logs/snap-notes.log` (без ключей/токенов/текста)
- Проверка вживую без трогания своего профиля: `electron . --user-data-dir=<временная папка>`

### Блочный формат заметок (v1.4)
- `src/shared/blocks.ts` — типы блоков, `htmlToBlocks`/`blocksToHtml` (круговой обмен с сохранением `data-block`/`data-src`), санитайзинг inline-HTML; `blockExport.ts` — Markdown / «для AI» / текст / rich HTML / TSV / CSV
- Файл заметки: `version: 2`, `blocks`, `sources` (оригинальный скриншот, приложение, окно, способ распознавания) **и** `body` (HTML). Редактор пока правит HTML, блоки выводятся из него при каждом сохранении; `body` оставлен и для совместимости со старыми версиями
- Миграция v1→v2 при запуске, копия старых файлов — `userData/backups/notes-v1-<время>/`
- Распознавание → блоки: `src/main/captureContent.ts` (JSON ИИ → `aiBlocks.ts`, офлайн — `localLayout.ts` по координатам строк Tesseract, очистка — `ocrCleanup.ts`, промпты — `ocrPrompts.ts`)
- Действия над фрагментом: `src/main/noteActions.ts` («Привести в порядок», меню ИИ), экспорт/копирование — `src/main/noteExport.ts`

### Интерфейс захвата (v1.4)
- HUD — отдельное окно поверх всех (`src/main/hud.ts`, `components/capture/CaptureHud.tsx`, маршрут `#hud`): прогресс, «Отменить» / «Открыть», счётчик сессии, выбор заметки
- Сессия захвата и выбор цели — `src/main/capturePipeline.ts`; окно выделения получает режим сессии (`overlay:mode`)
- Редактор: `components/editor/` — `caret.ts` (позиция курсора + перенос захвата в неё), `FragmentTools` (меню фрагмента, оригинал, источник, проверка), `UncertainHover`, `TableToolbar`, `CodeTools`
- Синхронизация редактора: внешние изменения заметки приходят как `noteRevisions[id]` в store; эхо собственных сохранений не сливается повторно
- Живые тесты в изолированном профиле — через CDP (`--remote-debugging-port`) и тестовые хоткеи Ctrl+Alt+Shift+F6…F12

### Дизайн-система и редизайн интерфейса (v1.4)
- Каркас: `AppShell` = панель разделов слева (`components/shell/AppNavRail.tsx`, только глобальные режимы: Заметки / статус ИИ / Справка / Настройки) + контекстная боковая панель (своя у каждого раздела) + рабочая область. Навигация в store: `section`, `notesFilter` (all/pinned/trash — корзина это фильтр заметок), `settingsCategory`.
- Токены — CSS-переменные в `src/renderer/src/styles/index.css` (`--bg-primary`, `--surface-1/2`, `--text-primary/secondary/muted`, `--accent`…), классы Tailwind в `tailwind.config.js` (`bg-canvas`, `bg-surface-1`, `text-fg-secondary`, `border-line`…). Старых токенов (`bg-bg`, `text-ink`, `text-muted`, `shadow-card`) больше нет. Модификатор прозрачности (`bg-accent/50`) с этими цветами НЕ работает — Tailwind молча не генерирует класс; использовать `opacity-*` или `color-mix` в CSS.
- Общие компоненты — `src/renderer/src/ui/` (Button, IconButton, Input, Select, Toggle, SegmentedControl, ChoiceList, Popover, Menu/DropdownMenu/useContextMenu, Tooltip, Modal/ConfirmDialog, Page/Section/SettingsGroup/SettingsRow, EmptyState, Sidebar*). Новый UI собирать из них, а не из локальных классов.
- Действия с заметкой — одно место: `components/notes/NoteMenuItems.tsx` (используется в «…» карточки, правом клике, боковой панели и редакторе).
- Палитра команд Ctrl+K — `components/CommandPalette.tsx`; редкие действия добавлять туда, а не новыми кнопками на экран.
- Адаптив: `hooks/useLayout.ts` (narrow < 1000px — боковая панель становится выдвижной, редактор на всю ширину).

### Осознанно НЕ сделано / отложено
- **Google Docs интеграция** — пользователь попросил отложить («пока без гугл докса»), не делали
- **Настоящий Grok (xAI)** — раньше давали $25 бесплатно, теперь нет, платный с нуля — не подключали. Пользователь путал его с **Groq** (другая компания, реально бесплатный) — вот его и подключили
- **DeepSeek** — их публичный API не принимает изображения (только текст), для OCR не годится — пропустили
- **Настоящий фактчекинг заметок** — сознательно не делали, ненадёжно и может ввести в заблуждение; вместо этого — честная эвристика неполноты (см. выше)
- **Code signing установщика** — нет сертификата, Windows SmartScreen может предупредить при установке, это ожидаемо

## Структура проекта

```
src/
├── shared/                  # общий код main+renderer (без Node/DOM-специфики)
│   ├── types.ts              # Note, AppSettings и все остальные общие типы
│   ├── ipc.ts                 # имена IPC-каналов
│   ├── ocrBlocks.ts           # JSON-блоки распознавания + рендер в HTML (без ИИ)
│   ├── ocrPresets.ts          # промпты для 4 пресетов стиля
│   ├── themes.ts               # 8 тем
│   ├── changelog.ts            # данные для диалога "что нового"
│   ├── emojiSuggest.ts          # эвристика подбора эмодзи
│   ├── completeness.ts           # эвристика "текст обрезан"
│   └── htmlText.ts                # html ↔ plain text конвертация
├── main/
│   ├── index.ts               # точка входа, жизненный цикл окна/трея/хоткеев
│   ├── ai/                     # gemini.ts, groq.ts, local.ts (tesseract), router.ts (фолбэк), usage.ts (счётчик запросов), errors.ts
│   ├── notesStore.ts            # CRUD заметок + корзина, JSON-файлы в userData/notes
│   ├── settingsStore.ts          # electron-store, миграция старых настроек
│   ├── screenshot.ts              # захват + предзагруженный оверлей выделения
│   ├── screenshotCache.ts          # TTL-кэш скриншотов
│   ├── capturePipeline.ts           # склейка: скриншот → OCR → дедуп → сохранение в заметку
│   ├── updater.ts                    # electron-updater обёртка
│   ├── htmlSanitize.ts                # sanitize-html конфиг (allowlist тегов/классов)
│   ├── hotkeys.ts, tray.ts, autoLaunch.ts, exportData.ts, windows.ts, ipc.ts
├── preload/                  # contextBridge → window.api
└── renderer/src/
    ├── components/            # NoteCard, NoteEditor (+RichTextEditor), Settings, AiKeysManager,
    │                           # ThemePicker, Trash, EmojiPicker, OnboardingWizard, WhatsNewDialog,
    │                           # UpdateBanner, OverlaySelector, ...
    ├── store/useAppStore.ts    # Zustand — единственный источник состояния renderer'а
    ├── utils/sanitizeHtml.ts   # DOMParser-санитайзер для отображения (defense in depth)
    └── styles/index.css        # CSS-переменные тем + rich-content стили (чипы, чек-листы, таблицы)
```

## Данные пользователя (на этой машине)

- Заметки: `%APPDATA%/snap-notes/notes/*.json` (мягкое удаление через `deletedAt`)
- Настройки + ключи: `%APPDATA%/snap-notes/config.json` (зашифровано через `electron-store`)
- Кэш скриншотов: `%APPDATA%/snap-notes/screenshot-cache`
- Кэш языковых данных Tesseract: `%APPDATA%/snap-notes/tesseract-cache`

## Как выпускать новую версию (памятка)

1. Внести изменения в код
2. Поднять `version` в `package.json`
3. Добавить запись в начало `CHANGELOG.md` **и** в начало массива `CHANGELOG` в `src/shared/changelog.ts` (иначе диалог «Что нового» не покажет новый текст)
4. `npm run typecheck` — проверить, что всё чисто
5. `git add -A && git commit -m "..." && git push`
6. `npm run release` — соберёт и опубликует на GitHub. **Важно:** первый раз после смены `package.json → build.publish` конфига electron-builder иногда создаёт релиз черновиком (draft) — если после `npm run release` релиза не видно на странице https://github.com/eropermakov/snap-notes/releases, проверить через GitHub API (`curl -H "Authorization: token $GH_TOKEN" https://api.github.com/repos/eropermakov/snap-notes/releases`, смотреть поле `"draft"`) и при необходимости запустить `npm run release` ещё раз — на повторном прогоне обычно публикуется как надо.
7. У уже установленных копий (начиная с 1.1.1) автообновление сработает само в течение максимум 4 часов, либо сразу через кнопку «Проверить обновления» в Настройках.

## Известные грабли, на которые уже наступали

- **Стоит несколько версий Node/npm или PATH не подхватывается** в persistent-шеллах — каждую bash-команду в этом окружении приходится начинать с `export PATH="/c/Program Files/nodejs:$PATH"`.
- **Стрелка "автообновление не работает"**: если пользователь ставил приложение ДО того, как в код был добавлен `electron-updater` (или до фикса draft-релиза), у него физически нет кода проверки обновлений — придётся один раз переустановить вручную. Дальше уже само.
- **electron-builder создаёт релизы черновиками по умолчанию** — в `package.json → build.publish` стоит `"releaseType": "release"`, но иногда с первого раза всё равно не публикует (see шаг 6 выше) — GitHub API это надёжный способ проверить факт.
- **Framer Motion + React 19**: типы `ReactElement` нужно импортировать из `'react'`, НЕ из `'framer-motion'` (там такого экспорта нет) — несколько раз ловили эту ошибку типов.
- **`useRef<T>()` без аргумента** не проходит типы в этой версии React/TS — всегда `useRef<T | undefined>(undefined)`.
- **Электрон + IPv6/IPv4**: dev-сервер Vite нужно явно биндить на `127.0.0.1` (`server.host` в `electron.vite.config.ts`) — иначе Electron не может достучаться до `localhost` на некоторых Windows-машинах.
