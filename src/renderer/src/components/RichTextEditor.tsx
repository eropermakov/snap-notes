import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { sanitizeHtmlForDisplay } from '../utils/sanitizeHtml'
import {
  BoldIcon,
  UnderlineIcon,
  StrikethroughIcon,
  HighlightIcon,
  HeadingIcon,
  ListBulletIcon,
  ListNumberIcon,
  ChecklistIcon,
  CloseIcon
} from './icons'

interface Props {
  html: string
  onChange: (html: string) => void
  placeholder?: string
}

const HIGHLIGHT_COLORS = ['#FEF7E0', '#E6F4EA', '#E8F0FE', '#FDECEA']
const TODO_ITEM_HTML = '<ul class="todo-list"><li class="todo-item">&nbsp;</li></ul>'

function ToolbarButton({
  onClick,
  title,
  active,
  children
}: {
  onClick: () => void
  title: string
  active?: boolean
  children: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className={`rounded-md p-1.5 transition hover:bg-accent-light hover:text-accent active:scale-90 ${
        active ? 'bg-accent-light text-accent' : 'text-muted'
      }`}
    >
      {children}
    </button>
  )
}

export default function RichTextEditor({ html, onChange, placeholder }: Props): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const skipNextSync = useRef(false)
  const [highlightOpen, setHighlightOpen] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    if (skipNextSync.current) {
      skipNextSync.current = false
      return
    }
    const clean = sanitizeHtmlForDisplay(html)
    if (ref.current.innerHTML !== clean) {
      ref.current.innerHTML = clean
    }
  }, [html])

  const handleInput = (): void => {
    if (!ref.current) return
    skipNextSync.current = true
    onChange(ref.current.innerHTML)
  }

  const exec = (command: string, value?: string): void => {
    ref.current?.focus()
    document.execCommand(command, false, value)
    handleInput()
  }

  const insertTodo = (): void => {
    exec('insertHTML', TODO_ITEM_HTML)
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

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-0.5 border-b border-surface-border pb-2">
        <ToolbarButton onClick={() => exec('formatBlock', '<h3>')} title="Заголовок">
          <HeadingIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('bold')} title="Жирный (Ctrl+B)">
          <BoldIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('underline')} title="Подчёркнутый (Ctrl+U)">
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('strikeThrough')} title="Зачёркнутый">
          <StrikethroughIcon className="h-4 w-4" />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-surface-border" />
        <ToolbarButton onClick={() => exec('insertUnorderedList')} title="Маркированный список">
          <ListBulletIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('insertOrderedList')} title="Нумерованный список">
          <ListNumberIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={insertTodo} title="Чек-лист">
          <ChecklistIcon className="h-4 w-4" />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-surface-border" />
        <div className="relative">
          <ToolbarButton onClick={() => setHighlightOpen((v) => !v)} title="Выделение цветом">
            <HighlightIcon className="h-4 w-4" />
          </ToolbarButton>
          {highlightOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface p-2 shadow-card-hover">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    exec('hiliteColor', color)
                    setHighlightOpen(false)
                  }}
                  className="h-5 w-5 rounded-full border border-surface-border"
                  style={{ background: color }}
                  title="Выделить"
                />
              ))}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  exec('hiliteColor', 'transparent')
                  setHighlightOpen(false)
                }}
                className="flex h-5 w-5 items-center justify-center rounded-full border border-surface-border text-muted"
                title="Убрать выделение"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onClick={handleContainerClick}
        onBlur={() => setHighlightOpen(false)}
        data-placeholder={placeholder}
        className="rich-content min-h-[140px] flex-1 text-sm leading-relaxed text-ink outline-none empty:before:text-muted empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  )
}
