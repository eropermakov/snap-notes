import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Button, Kbd } from '../ui'

/**
 * Quick Note window: a title (optional) and a text area. Ctrl+Enter or the button saves, Esc closes.
 * Plain Enter inserts a new line so a longer thought can be typed naturally.
 */
export default function QuickNote(): ReactElement {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const draft = useRef({ title: '', text: '' })
  draft.current = { title, text }

  useEffect(() => {
    void window.api.settings.get().then((s) => document.documentElement.setAttribute('data-theme', s.theme))
    document.title = 'Быстрая заметка'
    // The window is created once and re-shown: every show starts with a clean, focused page.
    return window.api.quick.onReset(() => {
      setTitle('')
      setText('')
      setSaving(false)
      void window.api.settings.get().then((s) => document.documentElement.setAttribute('data-theme', s.theme))
      requestAnimationFrame(() => textRef.current?.focus())
    })
  }, [])

  const save = async (): Promise<void> => {
    if (saving) return
    const { title: t, text: body } = draft.current
    if (!t.trim() && !body.trim()) {
      window.api.quick.close()
      return
    }
    setSaving(true)
    await window.api.quick.save(t, body)
  }

  return (
    <div
      className="flex h-screen w-screen flex-col bg-canvas text-fg"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          window.api.quick.close()
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void save()
        }
      }}
    >
      <div className="drag-region flex h-9 shrink-0 items-center justify-between px-4 text-xs text-fg-muted">
        <span>Быстрая заметка</span>
        <span className="no-drag flex items-center gap-1">
          <Kbd>Esc</Kbd> закрыть
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4">
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.ctrlKey) {
              e.preventDefault()
              textRef.current?.focus()
            }
          }}
          placeholder="Заголовок (необязательно)"
          aria-label="Заголовок"
          className="h-8 w-full bg-transparent text-lg font-semibold outline-none placeholder:text-fg-muted"
        />
        <textarea
          ref={textRef}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Что записать?"
          aria-label="Текст заметки"
          className="min-h-0 w-full flex-1 resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-fg-muted"
        />
      </div>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4">
        <span className="text-xs text-fg-muted">
          <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> — сохранить
        </span>
        <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
          Сохранить
        </Button>
      </div>
    </div>
  )
}
