import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import type { OcrSource } from '@shared/blocks'
import { sanitizeHtmlForDisplay } from '../utils/sanitizeHtml'
import { useAppStore } from '../store/useAppStore'
import { Divider, DropdownMenu, IconButton, Menu, MenuItem, MenuLabel, MenuSeparator, Popover } from '../ui'
import {
  BoldIcon,
  UnderlineIcon,
  StrikethroughIcon,
  HighlightIcon,
  HeadingIcon,
  ListBulletIcon,
  ListNumberIcon,
  ChecklistIcon,
  CloseIcon,
  TableIcon,
  CodeIcon,
  EraserIcon,
  ImageIcon,
  MoreIcon,
  PasteTextIcon,
  SparkleIcon,
  TrashIcon,
  WrapTextIcon,
  ScanTextIcon
} from './icons'
import { moveSourceToCaret, placeCaret, readCaret, type CaretPosition } from './editor/caret'
import FragmentTools from './editor/FragmentTools'
import UncertainHover from './editor/UncertainHover'
import TableToolbar from './editor/TableToolbar'
import CodeTools from './editor/CodeTools'
import LinkTools from './editor/LinkTools'
import CollapseTools from './editor/CollapseTools'
import { applySearchHighlight } from './editor/searchHighlight'
import {
  clearFormatting,
  convertToList,
  replaceSelectionWithText,
  selectedText,
  selectionForCleanup,
  unwrapSelectedParagraphs
} from './editor/textCommands'
import { fileToPngBytes, imageFilesOf } from '../utils/imageFiles'

interface Props {
  html: string
  onChange: (html: string) => void
  placeholder?: string
  /** Note shown in the editor; enables capture placement and fragment tools. */
  noteId?: string
  /** OCR captures of this note (original screenshot, app, window, method). */
  sources?: Record<string, OcrSource>
  /** Persists pending edits before the main process rewrites the note (AI / tidy / delete fragment). */
  flush?: () => Promise<void>
  /** Changes when the note was modified outside the editor: the DOM must follow even mid-typing. */
  externalRevision?: number
  /** Words to mark in the text (the note was opened from a search result). */
  highlightQuery?: string
  /** Editor-only typography ('' = default). Code blocks always stay monospace. */
  fontFamily?: string
  fontSize?: number
}

/** Translucent so highlighted text stays readable in both light and dark themes. */
const HIGHLIGHT_COLORS = [
  { color: 'rgba(251, 188, 4, 0.32)', label: 'Жёлтый' },
  { color: 'rgba(52, 168, 83, 0.28)', label: 'Зелёный' },
  { color: 'rgba(66, 133, 244, 0.28)', label: 'Синий' },
  { color: 'rgba(234, 67, 53, 0.26)', label: 'Красный' }
]
const TODO_ITEM_HTML = '<ul class="todo-list"><li class="todo-item">&nbsp;</li></ul>'
const TABLE_HTML =
  '<table><thead><tr><th>Столбец 1</th><th>Столбец 2</th></tr></thead><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>'
const NO_SOURCES: Record<string, OcrSource> = {}
const FONT_FALLBACK = '"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif'

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function ToolbarButton({ onClick, label, shortcut, icon }: { onClick: () => void; label: string; shortcut?: string; icon: ReactNode }): ReactElement {
  return (
    <IconButton
      size="sm"
      label={label}
      shortcut={shortcut}
      icon={icon}
      tooltipSide="bottom"
      // Keep the text selection inside the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    />
  )
}

export default function RichTextEditor({
  html,
  onChange,
  placeholder,
  noteId,
  sources = NO_SOURCES,
  flush,
  externalRevision = 0,
  highlightQuery = '',
  fontFamily = '',
  fontSize = 14
}: Props): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null)
  const skipNextSync = useRef(false)
  const caret = useRef<CaretPosition | null>(null)
  const savedRange = useRef<Range | null>(null)
  const [highlightAnchor, setHighlightAnchor] = useState<HTMLButtonElement | null>(null)
  const [highlightOpen, setHighlightOpen] = useState(false)
  const [contentVersion, setContentVersion] = useState(0)
  const [imageMenu, setImageMenu] = useState<{ x: number; y: number; img: HTMLImageElement } | null>(null)
  const pushToast = useAppStore((s) => s.pushToast)

  const attachRoot = useCallback((el: HTMLDivElement | null) => {
    ref.current = el
    setRoot(el)
  }, [])

  /** Code is not prose: no spellcheck squiggles inside code blocks. */
  const markCode = (): void => {
    ref.current?.querySelectorAll('pre').forEach((pre) => pre.setAttribute('spellcheck', 'false'))
  }

  const syncedRevision = useRef(externalRevision)
  useEffect(() => {
    if (!ref.current) return
    const external = externalRevision !== syncedRevision.current
    syncedRevision.current = externalRevision
    if (skipNextSync.current && !external) {
      skipNextSync.current = false
      return
    }
    skipNextSync.current = false
    const clean = sanitizeHtmlForDisplay(html)
    if (ref.current.innerHTML !== clean) {
      const hadFocus = document.activeElement === ref.current
      ref.current.innerHTML = clean
      markCode()
      setContentVersion((v) => v + 1)
      // Keep the caret where it was when an outside change re-renders the text.
      if (external && hadFocus && caret.current) placeCaret(ref.current, caret.current)
    }
  }, [html, externalRevision])

  // Words searched for are marked in the open note without touching its DOM.
  useEffect(() => {
    if (!root || !highlightQuery.trim()) return undefined
    let cleanup: () => void = () => undefined
    const id = requestAnimationFrame(() => {
      cleanup = applySearchHighlight(root, highlightQuery, true)
    })
    return () => {
      cancelAnimationFrame(id)
      cleanup()
    }
  }, [root, highlightQuery, contentVersion])

  const handleInput = useCallback((): void => {
    if (!ref.current) return
    skipNextSync.current = true
    markCode()
    onChange(ref.current.innerHTML)
  }, [onChange])

  // Remember where the caret was in this note's text. Focus moving to another field of the app
  // (title, search) means the caret is no longer "in the note"; switching to another app keeps it.
  useEffect(() => {
    const onSelection = (): void => {
      const el = ref.current
      if (!el) return
      // Whatever is selected inside the text is remembered, so menu commands act on it after focus moves.
      const current = window.getSelection()
      if (current && current.rangeCount > 0 && el.contains(current.getRangeAt(0).commonAncestorContainer)) {
        savedRange.current = current.getRangeAt(0).cloneRange()
      }
      const position = readCaret(el)
      if (position) {
        caret.current = position
        return
      }
      const active = document.activeElement
      if (active && active !== el && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active as HTMLElement).isContentEditable)) {
        caret.current = null
      }
    }
    document.addEventListener('selectionchange', onSelection)
    return () => document.removeEventListener('selectionchange', onSelection)
  }, [])

  // A capture was appended to this note: move it to the caret, if the caret was in the text.
  useEffect(() => {
    if (!noteId) return undefined
    return window.api.notes.onCaptureAdded(({ noteId: target, sourceId }) => {
      if (target !== noteId) return
      const saved = caret.current
      if (!saved) return
      let attempts = 0
      const tryMove = (): void => {
        const el = ref.current
        if (!el) return
        const present = el.querySelector(`[data-src="${CSS.escape(sourceId)}"]`)
        if (!present) {
          // The note HTML re-renders after the store update; wait for it.
          if (attempts++ < 60) requestAnimationFrame(tryMove)
          return
        }
        const next = moveSourceToCaret(el, sourceId, saved)
        if (!next) return
        caret.current = next
        if (document.activeElement === el) placeCaret(el, next)
        handleInput()
      }
      requestAnimationFrame(tryMove)
    })
  }, [noteId, handleInput])

  /** Puts the selection back (menus take focus away from the text) and focuses the editor. */
  const restoreSelection = (): void => {
    const el = ref.current
    if (!el) return
    const selection = window.getSelection()
    // The selection is still in the text: leave it alone. Otherwise bring back the remembered one.
    const live = selection && selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).commonAncestorContainer)
    el.focus()
    const range = savedRange.current
    if (!live && range && el.contains(range.commonAncestorContainer) && el.isConnected) {
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
  }

  const exec = (command: string, value?: string): void => {
    ref.current?.focus()
    document.execCommand(command, false, value)
    handleInput()
  }

  const insertTodo = (): void => {
    exec('insertHTML', TODO_ITEM_HTML)
  }

  /** Inserts HTML marked with data-new, then puts the caret inside the marked element. */
  const insertAndEnter = (htmlWithMarker: string, inside: (el: HTMLElement) => Node | null): void => {
    ref.current?.focus()
    document.execCommand('insertHTML', false, htmlWithMarker)
    const el = ref.current?.querySelector('[data-new]') as HTMLElement | null
    if (el) {
      el.removeAttribute('data-new')
      const target = inside(el) ?? el
      const range = document.createRange()
      range.selectNodeContents(target)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    handleInput()
  }

  const insertCode = (): void => {
    const selected = window.getSelection()?.toString() ?? ''
    insertAndEnter(`<pre data-new="1" spellcheck="false"><code>${escapeText(selected) || '<br>'}</code></pre><p><br></p>`, (el) => el.querySelector('code'))
  }

  const insertTable = (): void => {
    insertAndEnter(TABLE_HTML.replace('<table>', '<table data-new="1">'), (el) => el.querySelector('td'))
  }

  // ----- text commands (selection based) -----

  const pastePlain = async (): Promise<void> => {
    const text = await window.api.clipboard.readText()
    if (!text) {
      pushToast('warning', 'В буфере обмена нет текста')
      return
    }
    restoreSelection()
    // Text only: no HTML, fonts or colours; line breaks stay.
    document.execCommand('insertText', false, text)
    handleInput()
  }

  const runClearFormatting = (): void => {
    restoreSelection()
    if (!ref.current || !clearFormatting(ref.current)) {
      pushToast('warning', 'Выделите текст, у которого нужно убрать форматирование')
      return
    }
    handleInput()
  }

  const runToList = (kind: 'ul' | 'ol' | 'todo'): void => {
    restoreSelection()
    if (!ref.current) return
    const result = convertToList(ref.current, kind)
    if (result === 'empty') {
      // Nothing selected: start a list at the caret (or turn the current paragraph into an item).
      if (kind === 'todo') insertTodo()
      else exec(kind === 'ul' ? 'insertUnorderedList' : 'insertOrderedList')
      return
    }
    handleInput()
  }

  const runUnwrap = (): void => {
    restoreSelection()
    if (!ref.current) return
    if (selectedText(ref.current).trim() === '') {
      pushToast('warning', 'Выделите текст (Ctrl+A — весь текст заметки). Код, таблицы и списки не затрагиваются.')
      return
    }
    const count = unwrapSelectedParagraphs(ref.current)
    if (count === 0) {
      pushToast('success', 'Лишних переносов не найдено')
      return
    }
    handleInput()
    pushToast('success', 'Лишние переносы убраны')
  }

  const runCleanup = async (): Promise<void> => {
    restoreSelection()
    const el = ref.current
    if (!el) return
    const text = selectionForCleanup(el)
    if (!text.trim()) {
      pushToast('warning', 'Выделите текст. Для всего фрагмента со скриншота — меню «…» у фрагмента.')
      return
    }
    if (flush) await flush()
    const result = await window.api.notes.cleanupText(text)
    if (!result.ok || !result.text.trim()) {
      pushToast('error', 'Не удалось привести текст в порядок')
      return
    }
    restoreSelection()
    replaceSelectionWithText(el, result.text)
    handleInput()
    pushToast('success', `Приведено в порядок${result.provider ? ` (${result.provider})` : ''}`)
  }

  // ----- pictures: drop, paste, "Recognize text" -----

  const insertImages = async (files: File[], at?: Range | null): Promise<void> => {
    if (!noteId) return
    let inserted = 0
    let lastSrc: string | null = null
    for (const file of files.slice(0, 10)) {
      try {
        const bytes = await fileToPngBytes(file)
        const src = await window.api.notes.addImage(noteId, bytes)
        if (!src) throw new Error('Не удалось сохранить изображение.')
        ref.current?.focus()
        if (at) {
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(at)
        }
        document.execCommand('insertHTML', false, `<p><img class="doc-image" src="${src}" alt=""></p>`)
        inserted++
        lastSrc = src
      } catch (err) {
        pushToast('error', (err as Error).message)
      }
    }
    if (inserted === 0) return
    handleInput()
    const src = lastSrc
    pushToast('success', inserted === 1 ? 'Изображение добавлено' : `Изображений добавлено: ${inserted}`, src
      ? { label: 'Распознать текст', run: () => void recognizeImage(src, 'below') }
      : undefined)
  }

  const recognizeImage = async (src: string, mode: 'below' | 'replace'): Promise<void> => {
    if (!noteId) return
    if (flush) await flush()
    const result = await window.api.notes.recognizeImage(noteId, src, mode)
    if (!result.ok) pushToast('warning', result.message ?? 'Не удалось распознать текст')
  }

  const onDragOver = (e: DragEvent): void => {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
  }

  const onDrop = (e: DragEvent): void => {
    const files = imageFilesOf(e.dataTransfer.files)
    if (files.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    const at = doc.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null
    void insertImages(files, at && ref.current?.contains(at.commonAncestorContainer) ? at : null)
  }

  const onPaste = (e: ClipboardEvent): void => {
    const files = imageFilesOf(e.clipboardData.files)
    if (files.length === 0) return
    e.preventDefault()
    void insertImages(files, null)
  }

  const onContextMenu = (e: MouseEvent): void => {
    const target = e.target as HTMLElement
    if (target instanceof HTMLImageElement && target.classList.contains('doc-image')) {
      e.preventDefault()
      setImageMenu({ x: e.clientX, y: e.clientY, img: target })
    }
  }

  const pickImageFile = async (): Promise<void> => {
    const picked = await window.api.notes.pickImage()
    if (!picked) return
    if (picked.error || !picked.bytes) {
      pushToast('error', picked.error ?? 'Не удалось открыть файл')
      return
    }
    await insertImages([new File([picked.bytes as BlobPart], picked.name ?? 'image.png')], savedRange.current)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Ctrl+Shift+V: paste as plain text (works with the Russian layout too).
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'KeyV' || e.key.toLowerCase() === 'v')) {
      e.preventDefault()
      void pastePlain()
      return
    }
    const anchor = window.getSelection()?.anchorNode
    const element = anchor instanceof HTMLElement ? anchor : anchor?.parentElement

    // A new checklist item after a ticked one starts unticked.
    if (e.key === 'Enter' && !e.shiftKey && element?.closest('li.todo-item')) {
      requestAnimationFrame(() => {
        const sel = window.getSelection()?.anchorNode
        const li = (sel instanceof HTMLElement ? sel : sel?.parentElement)?.closest('li.todo-item')
        if (li && li.classList.contains('done') && !(li.textContent ?? '').replace(/ /g, '').trim()) {
          li.classList.remove('done')
          handleInput()
        }
      })
      return
    }

    const inCode = Boolean(element?.closest('pre'))
    if (!inCode) return
    // Inside code: Enter is a newline, Tab indents — nothing is turned into paragraphs or list items.
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault()
      // execCommand('insertText', '\n') would split the <pre> in two: insert a real newline instead.
      const selection = window.getSelection()
      const pre = element?.closest('pre')
      if (!selection || selection.rangeCount === 0 || !pre) return
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const newline = document.createTextNode('\n')
      range.insertNode(newline)
      // A newline at the very end only renders with a trailing one after it (export strips it).
      const tail = document.createRange()
      tail.setStartAfter(newline)
      tail.setEnd(pre, pre.childNodes.length)
      if (!tail.toString()) newline.after(document.createTextNode('\n'))
      range.setStartAfter(newline)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      handleInput()
    } else if (e.key === 'Tab' && !e.ctrlKey) {
      e.preventDefault()
      document.execCommand('insertText', false, '    ')
      handleInput()
    }
  }

  const handleContainerClick = (e: MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    const item = target.closest('li.todo-item') as HTMLElement | null
    if (!item) return
    const rect = item.getBoundingClientRect()
    if (e.clientX - rect.left <= 22) {
      e.preventDefault()
      item.classList.toggle('done')
      handleInput()
    }
  }

  const noopFlush = useCallback(async () => undefined, [])

  const style = {
    '--editor-font': fontFamily ? `"${fontFamily}", ${FONT_FALLBACK}` : 'inherit',
    '--editor-size': `${fontSize}px`
  } as CSSProperties

  return (
    <div className="flex flex-1 flex-col">
      <div role="toolbar" aria-label="Форматирование" className="sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-0.5 bg-canvas py-1">
        <ToolbarButton onClick={() => exec('formatBlock', '<h3>')} label="Заголовок" icon={<HeadingIcon />} />
        <ToolbarButton onClick={() => exec('bold')} label="Жирный" shortcut="Ctrl+B" icon={<BoldIcon />} />
        <ToolbarButton onClick={() => exec('underline')} label="Подчёркнутый" shortcut="Ctrl+U" icon={<UnderlineIcon />} />
        <ToolbarButton onClick={() => exec('strikeThrough')} label="Зачёркнутый" icon={<StrikethroughIcon />} />
        <ToolbarButton onClick={runClearFormatting} label="Убрать форматирование" icon={<EraserIcon />} />
        <Divider vertical />
        <ToolbarButton onClick={() => runToList('ul')} label="Маркированный список" icon={<ListBulletIcon />} />
        <ToolbarButton onClick={() => runToList('ol')} label="Нумерованный список" icon={<ListNumberIcon />} />
        <ToolbarButton onClick={() => runToList('todo')} label="Чек-лист" icon={<ChecklistIcon />} />
        <Divider vertical />
        <ToolbarButton onClick={insertTable} label="Таблица" icon={<TableIcon />} />
        <ToolbarButton onClick={insertCode} label="Блок кода" icon={<CodeIcon />} />
        <Divider vertical />
        <IconButton
          ref={setHighlightAnchor}
          size="sm"
          label="Выделение цветом"
          icon={<HighlightIcon />}
          active={highlightOpen}
          aria-haspopup="dialog"
          aria-expanded={highlightOpen}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setHighlightOpen((v) => !v)}
        />
        <DropdownMenu
          label="Работа с текстом"
          placement="bottom-start"
          trigger={(p) => <IconButton {...p} size="sm" label="Работа с текстом" icon={<MoreIcon />} onMouseDown={(e) => e.preventDefault()} />}
        >
          <MenuLabel>Выделенный текст</MenuLabel>
          <MenuItem icon={<SparkleIcon />} onSelect={() => void runCleanup()}>
            Привести в порядок
          </MenuItem>
          <MenuItem icon={<WrapTextIcon />} onSelect={runUnwrap}>
            Убрать лишние переносы строк
          </MenuItem>
          <MenuItem icon={<EraserIcon />} onSelect={runClearFormatting}>
            Убрать форматирование
          </MenuItem>
          <MenuLabel>Превратить в список</MenuLabel>
          <MenuItem icon={<ListBulletIcon />} onSelect={() => runToList('ul')}>
            Маркированный
          </MenuItem>
          <MenuItem icon={<ListNumberIcon />} onSelect={() => runToList('ol')}>
            Нумерованный
          </MenuItem>
          <MenuItem icon={<ChecklistIcon />} onSelect={() => runToList('todo')}>
            Чек-лист
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<PasteTextIcon />} shortcut="Ctrl+Shift+V" onSelect={() => void pastePlain()}>
            Вставить как обычный текст
          </MenuItem>
          <MenuItem icon={<ImageIcon />} onSelect={() => void pickImageFile()}>
            Вставить картинку из файла…
          </MenuItem>
        </DropdownMenu>
      </div>

      <Popover
        open={highlightOpen}
        onClose={() => setHighlightOpen(false)}
        anchor={highlightAnchor}
        placement="bottom-start"
        className="flex items-center gap-1 p-1.5"
        aria-label="Цвет выделения"
      >
        {HIGHLIGHT_COLORS.map(({ color, label }) => (
          <button
            key={color}
            type="button"
            aria-label={label}
            title={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              exec('hiliteColor', color)
              setHighlightOpen(false)
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-fast hover:bg-hover"
          >
            <span className="h-4 w-4 rounded-full border border-line" style={{ background: color }} />
          </button>
        ))}
        <Divider vertical />
        <button
          type="button"
          aria-label="Убрать выделение"
          title="Убрать выделение"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            exec('hiliteColor', 'transparent')
            setHighlightOpen(false)
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-fg-secondary transition-colors duration-fast hover:bg-hover hover:text-fg"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </Popover>

      <div ref={setWrapper} className="relative flex flex-1 flex-col">
        <div
          ref={attachRoot}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Текст заметки"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={handleContainerClick}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onPaste={onPaste}
          onContextMenu={onContextMenu}
          data-placeholder={placeholder}
          style={style}
          className="rich-content min-h-[160px] flex-1 text-fg outline-none empty:before:text-fg-muted empty:before:content-[attr(data-placeholder)]"
        />
        <TableToolbar root={root} wrapper={wrapper} onChange={handleInput} />
        <CodeTools root={root} wrapper={wrapper} />
        <LinkTools root={root} wrapper={wrapper} />
        <CollapseTools root={root} wrapper={wrapper} noteId={noteId} contentVersion={contentVersion} />
        {noteId && (
          <>
            <FragmentTools root={root} wrapper={wrapper} noteId={noteId} sources={sources} flush={flush ?? noopFlush} onChange={handleInput} />
            <UncertainHover root={root} noteId={noteId} sources={sources} onChange={handleInput} />
          </>
        )}
      </div>

      <Menu open={imageMenu !== null} onClose={() => setImageMenu(null)} anchor={imageMenu ? { x: imageMenu.x, y: imageMenu.y } : null} aria-label="Изображение">
        <MenuItem
          icon={<ScanTextIcon />}
          onSelect={() => imageMenu && void recognizeImage(imageMenu.img.getAttribute('src') ?? '', 'below')}
        >
          Распознать текст (под картинкой)
        </MenuItem>
        <MenuItem
          icon={<ScanTextIcon />}
          onSelect={() => imageMenu && void recognizeImage(imageMenu.img.getAttribute('src') ?? '', 'replace')}
        >
          Заменить картинку текстом
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<TrashIcon />}
          danger
          onSelect={() => {
            const img = imageMenu?.img
            if (!img) return
            const block = img.closest('p') ?? img
            block.remove()
            handleInput()
          }}
        >
          Удалить картинку
        </MenuItem>
      </Menu>
    </div>
  )
}
