/**
 * Prompts for recognition. They ask for OCR *correction only*: the model may fix recognition
 * errors and restore structure, but never rewrite, summarize or translate (that is the separate,
 * explicit AI-editing feature). Output schema: see OCR_SCHEMA and src/shared/aiBlocks.ts.
 */

export const OCR_SCHEMA = `Верни СТРОГО один JSON-объект {"blocks":[...]} — без markdown-разметки, без пояснений, без текста до или после. Элементы blocks идут строго в порядке чтения (сверху вниз, слева направо). Типы:
- {"type":"heading","level":1|2|3,"text":"..."} — заголовок (1 — главный, 2 — раздел, 3 — подраздел)
- {"type":"paragraph","text":"..."} — абзац; строки одного абзаца склей в один text
- {"type":"bullet_list","items":["...","..."]} — маркированный список
- {"type":"numbered_list","start":1,"items":["...","..."]} — нумерованный список (номера в items не пиши)
- {"type":"checklist","items":[{"text":"...","done":true|false}]} — список с галочками
- {"type":"table","header":true|false,"rows":[["ячейка","ячейка"],["...","..."]]} — таблица или выровненные колонки; все строки одной длины, пустая ячейка — ""
- {"type":"code","language":"python|js|…|","code":"..."} — программный код, команды, конфиги, логи
- {"type":"quote","text":"..."} — цитата
- {"type":"ui","role":"button|tab|link|label|input|menu","text":"..."} — надпись на элементе интерфейса
- {"type":"image","bbox":[ymin,xmin,ymax,xmax]} — настоящая фотография/иллюстрация/схема (не иконка, не логотип, не рамка); bbox — целые числа 0–1000 от размера всего изображения
У любого текстового блока можно добавить "uncertain":["точная подстрока", ...] — фрагменты, в которых ты НЕ уверен (плохо видно, неоднозначные символы). Особенно проверяй числа, суммы, даты, телефоны, email, URL, имена, артикулы, код. Не угадывай молча — отметь.`

export const OCR_RULES = `Правила точности:
- Это исправление распознавания, а не редактирование. Не переписывай, не сокращай, не перефразируй, не переводи, ничего не добавляй от себя.
- Можно только: исправить явные ошибки распознавания, лишние пробелы и разрывы слов, склеить строки абзаца, убрать мусорные символы, восстановить списки, таблицы и заголовки.
- Числа, суммы, даты, телефоны, email, URL, имена, названия, технические термины и артикулы переноси символ в символ. Если сомневаешься — оставь как видно и добавь в "uncertain".
- Код копируй дословно: те же отступы, переносы строк, регистр и символы; не заменяй 0↔O, 1↔l, не меняй прямые кавычки на типографские, ничего не исправляй в коде.
- Ссылки, email и телефоны оставляй в тексте как есть.
- Язык текста не меняй. Если текста нет — верни {"blocks":[]}.`

/** Screenshot → blocks. `withImages`: also report photos/illustrations with bboxes (document capture). */
export function buildVisionPrompt(options: { withImages?: boolean } = {}): string {
  return [
    'Распознай содержимое этого изображения и восстанови его смысловую структуру (не визуальную раскладку пиксель в пиксель).',
    OCR_SCHEMA,
    OCR_RULES,
    options.withImages
      ? 'Фотографии и иллюстрации отмечай блоком "image" на их месте в последовательности; их содержимое словами не пересказывай.'
      : 'Блоки "image" не используй — только текст и элементы интерфейса.'
  ].join('\n\n')
}

/** Locally recognized text → blocks (economy / balanced-simple): the image never leaves the computer. */
export function buildTextStructurePrompt(localText: string): string {
  return [
    'Ниже — текст, распознанный локальным OCR (Tesseract) со скриншота. В нём могут быть ошибки распознавания, лишние переносы строк и разорванные слова. Исправь только ошибки распознавания и восстанови структуру.',
    OCR_SCHEMA.replace(/- \{"type":"image".*\n/, ''),
    OCR_RULES,
    `Текст:\n"""\n${localText.slice(0, 12000)}\n"""`
  ].join('\n\n')
}

/** "Привести в порядок" for existing OCR content: fix, never rewrite. */
export function buildTidyPrompt(markdown: string): string {
  return [
    'Ниже — фрагмент заметки, полученный распознаванием экрана (в Markdown). Приведи его в порядок: исправь ошибки распознавания, восстанови абзацы, списки и таблицы, убери OCR-мусор. Смысл, формулировки, числа, даты, имена, URL и код не меняй.',
    OCR_SCHEMA.replace(/- \{"type":"image".*\n/, ''),
    OCR_RULES,
    `Фрагмент:\n"""\n${markdown.slice(0, 12000)}\n"""`
  ].join('\n\n')
}

/** A short title for a new note. The model sees the recognized text only and may not alter it. */
export function buildTitlePrompt(text: string): string {
  return [
    'Придумай короткое название (2–6 слов) для заметки с этим содержимым. На языке содержимого, без кавычек, без точки в конце, без эмодзи. Верни только название.',
    `Содержимое:\n"""\n${text.slice(0, 3000)}\n"""`
  ].join('\n\n')
}

/** One cheap text-only retry when a model returned broken JSON. No image is resent. */
export function buildJsonRepairPromptV2(brokenResponse: string): string {
  return [
    'Твой предыдущий ответ не является корректным JSON. Верни ТОТ ЖЕ результат, ничего не меняя по смыслу и не добавляя, строго как один валидный JSON-объект {"blocks":[...]} — без markdown, без пояснений.',
    OCR_SCHEMA,
    `Предыдущий ответ:\n"""\n${brokenResponse.slice(0, 12000)}\n"""`
  ].join('\n\n')
}

/** Explicit AI editing actions (§18). Unlike OCR correction these MAY change the wording. */
export type AiAction = 'shorten' | 'explain' | 'rewrite' | 'translate' | 'list' | 'keypoints'

const ACTION_TASKS: Record<AiAction, string> = {
  shorten: 'Сократи текст примерно вдвое, сохранив все ключевые факты, числа, даты и имена.',
  explain: 'Объясни простыми словами, о чём этот фрагмент и что в нём важно. Не повторяй текст целиком.',
  rewrite: 'Перепиши текст ясно и грамотно, сохранив смысл, все факты, числа, даты, имена и URL.',
  translate: 'Переведи текст на {lang}. Числа, имена, URL, код и технические термины не искажай.',
  list: 'Преобразуй содержимое в структурированный список (маркированный или нумерованный), ничего не теряя.',
  keypoints: 'Выдели 3–7 главных мыслей фрагмента в виде маркированного списка.'
}

export function buildAiActionPrompt(action: AiAction, markdown: string, language = 'русский'): string {
  return [
    ACTION_TASKS[action].replace('{lang}', language),
    'Код в блоках code не меняй. Ничего не выдумывай и не добавляй фактов, которых нет в тексте.',
    OCR_SCHEMA.replace(/- \{"type":"image".*\n/, '').replace(/У любого текстового блока можно добавить "uncertain"[\s\S]*$/, ''),
    `Фрагмент (Markdown):\n"""\n${markdown.slice(0, 12000)}\n"""`
  ].join('\n\n')
}
