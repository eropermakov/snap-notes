import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import type { OcrSource } from '@shared/blocks'
import { sanitizeHtmlForDisplay } from '../utils/sanitizeHtml'
import { Divider, IconButton, Popover } from '../ui'
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
  CodeIcon
} from './icons'
import { moveSourceToCaret, placeCaret, readCaret, type CaretPosition } from './editor/caret'
import FragmentTools from './editor/FragmentTools'
import UncertainHover from './editor/UncertainHover'
import TableToolbar from './editor/TableToolbar'
import CodeTools from './editor/CodeTools'

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

export default function RichTextEditor({ html, onChange, placeholder, noteId, sources = NO_SOURCES, flush, externalRevision = 0 }: Props): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null)
  const skipNextSync = useRef(false)
  const caret = useRef<CaretPosition | null>(null)
  const [highlightAnchor, setHighlightAnchor] = useState<HTMLButtonElement | null>(null)
  const [highlightOpen, setHighlightOpen] = useState(false)

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
      // Keep the caret where it was when an outside change re-renders the text.
      if (external && hadFocus && caret.current) placeCaret(ref.current, caret.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, externalRevision])

  const handleInput = useCallback((): void => {
    if (!ref.current) return
    skipNextSync.current = true
    markCode()
    onChange(ref.current.innerHTML)
  }, [onChange])

  // Remember where the caret was in this note's text (§1). Focus moving to another field of the app
  // (title, search) means the caret is no longer "in the note"; switching to another app keeps it.
  useEffect(() => {
    const onSelection = (): void => {
      const el = ref.current
      if (!el) return
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

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const anchor = window.getSelection()?.anchorNode
    const element = anchor instanceof HTMLElement ? anchor : anchor?.parentElement
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

  return (
    <div className="flex flex-1 flex-col">
      <div role="toolbar" aria-label="Форматирование" className="sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-0.5 bg-canvas py-1">
        <ToolbarButton onClick={() => exec('formatBlock', '<h3>')} label="Заголовок" icon={<HeadingIcon />} />
        <ToolbarButton onClick={() => exec('bold')} label="Жирный" shortcut="Ctrl+B" icon={<BoldIcon />} />
        <ToolbarButton onClick={() => exec('underline')} label="Подчёркнутый" shortcut="Ctrl+U" icon={<UnderlineIcon />} />
        <ToolbarButton onClick={() => exec('strikeThrough')} label="Зачёркнутый" icon={<StrikethroughIcon />} />
        <Divider vertical />
        <ToolbarButton onClick={() => exec('insertUnorderedList')} label="Маркированный список" icon={<ListBulletIcon />} />
        <ToolbarButton onClick={() => exec('insertOrderedList')} label="Нумерованный список" icon={<ListNumberIcon />} />
        <ToolbarButton onClick={insertTodo} label="Чек-лист" icon={<ChecklistIcon />} />
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
          data-placeholder={placeholder}
          className="rich-content min-h-[160px] flex-1 text-fg outline-none empty:before:text-fg-disabled empty:before:content-[attr(data-placeholder)]"
        />
        <TableToolbar root={root} wrapper={wrapper} onChange={handleInput} />
        <CodeTools root={root} wrapper={wrapper} />
        {noteId && (
          <>
            <FragmentTools root={root} wrapper={wrapper} noteId={noteId} sources={sources} flush={flush ?? noopFlush} onChange={handleInput} />
            <UncertainHover root={root} noteId={noteId} sources={sources} onChange={handleInput} />
          </>
        )}
      </div>
    </div>
  )
}
