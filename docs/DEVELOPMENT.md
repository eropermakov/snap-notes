# Snap Notes — для разработчиков

## Стек

Electron + React 19 + TypeScript (electron-vite), Tailwind CSS 3 (цвета через CSS-переменные), Framer Motion, Zustand, electron-store, electron-updater, `tesseract.js` (офлайн-OCR), Vitest. ИИ-провайдеры: ChatGPT (Sign in with ChatGPT), Gemini, Groq, OpenAI API, Anthropic API.

## Запуск

```bash
npm install
npm run dev         # окно с hot-reload
npm run typecheck   # типы main + renderer
npm test            # тесты (Vitest)
npm run build       # typecheck + сборка в out/
npm run dist        # установщик локально, без публикации → release/
```

## Выпуск версии

1. Поднять `version` в `package.json`.
2. Добавить запись в начало `CHANGELOG.md` **и** в начало массива в `src/shared/changelog.ts` — из него берётся диалог «Что нового».
3. `npm run typecheck && npm test`, закоммитить и запушить.
4. `npm run release` (нужна переменная окружения `GH_TOKEN` с правом `repo`). Скрипт:
   - собирает и публикует релиз через electron-builder (установщик, `.blockmap`, `latest.yml` для автообновлений);
   - запускает `scripts/publish-stable-download.mjs`, который добавляет в релиз копию установщика с постоянным именем `Snap-Notes-Setup.exe`. На неё ведёт кнопка «Скачать» в README: `releases/latest/download/Snap-Notes-Setup.exe`.
5. Проверить, что релиз не остался черновиком: `https://github.com/eropermakov/snap-notes/releases`. Если первый прогон публикации упал с HTTP-ошибкой GitHub, повторный обычно проходит.

Установленные копии проверяют обновления при старте и каждые 4 часа, скачивают их в фоне и показывают баннер «Перезапустить».

Установщик не подписан сертификатом, поэтому SmartScreen предупреждает при первой установке — это описано в README.

## Архитектура

```
src/
├── shared/      # типы, IPC-каналы, блочный формат заметок, провайдеры, темы, changelog
├── main/        # окна, трей, хоткеи, захват и распознавание, хранилище заметок, экспорт, апдейтер
│   ├── providers/   # ИИ-провайдеры, роутер с фолбэком, лимиты, шифрованное хранилище ключей
│   └── vendor/      # Sign in with ChatGPT SDK
├── preload/     # contextBridge → window.api
└── renderer/src/
    ├── ui/          # дизайн-система: Button, Popover, Menu, Modal, SettingsRow, AppShell…
    ├── components/  # экраны: notes/, editor/, ai/, capture/, shell/, Settings, CommandPalette
    ├── hooks/       # адаптивный layout
    ├── store/       # Zustand
    └── styles/      # токены и стили содержимого заметок
tests/           # Vitest: блоки, захват, провайдеры
```

### Интерфейс

- Каркас: панель разделов слева (только глобальные режимы), контекстная боковая панель раздела, рабочая область. Корзина — фильтр внутри «Заметок», «Использование ИИ» — категория настроек.
- Цвета — семантические токены в `styles/index.css` (`--bg-primary`, `--surface-1`, `--text-secondary`, `--accent`…) и классы Tailwind (`bg-canvas`, `text-fg-secondary`, `border-line`). Модификатор прозрачности вроде `bg-accent/50` с ними не работает — Tailwind молча не генерирует класс; используйте `opacity-*`.
- Новый UI собирается из `src/renderer/src/ui`, редкие действия — в меню заметки (`components/notes/NoteMenuItems.tsx`) или в палитру команд (`Ctrl+K`), а не новыми кнопками на экране.

### Заметки и распознавание

- Заметки хранятся в блочном формате (заголовки, списки, таблицы, код, цитаты, изображения); HTML редактора строится из блоков. У каждого захвата есть источник с исходным скриншотом.
- Распознавание только исправляет ошибки OCR и сохраняет структуру. Без ИИ работает Tesseract; ИИ-провайдеры выбираются по приоритету с автоматическим переходом при исчерпании лимита.

## Данные пользователя

- Заметки — `%APPDATA%/snap-notes/notes` (удаление мягкое: заметка уходит в корзину, корзина чистится по сроку).
- Исходные скриншоты и картинки — внутри папки данных, кэш скриншотов — `screenshot-cache`.
- Настройки — `config.json` (electron-store); API-ключи — отдельно, зашифрованы Windows DPAPI.
- Языковые данные Tesseract (`rus+eng`) скачиваются один раз в `tesseract-cache`.

## Иконка

```bash
node scripts/generate-icon.js
```

Источник — `scripts/icon.svg`; результат — `build/icon.ico` (установщик) и `resources/icon.png` (окно и трей).
