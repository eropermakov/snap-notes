import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { normalizeTag, normalizeTags, parseTagInput } from '@shared/noteMeta'
import { collectTags } from '@shared/noteList'
import { useAppStore } from '../../store/useAppStore'
import { Button, Modal } from '../../ui'
import { CloseIcon } from '../icons'

/**
 * Tag dialog. For one note it edits the whole list; for several notes (selection) it adds the typed
 * tags to all of them. Enter / comma / space add a tag, Backspace in an empty field removes the last.
 */
export default function TagEditorDialog(): ReactElement {
  const ids = useAppStore((s) => s.tagEditorIds)
  const close = useAppStore((s) => s.closeTagEditor)
  const notes = useAppStore((s) => s.notes)
  const setTags = useAppStore((s) => s.setTags)
  const bulkAddTags = useAppStore((s) => s.bulkAddTags)
  const open = ids !== null && ids.length > 0
  const single = ids && ids.length === 1 ? notes.find((n) => n.id === ids[0]) : undefined

  const [tags, setLocalTags] = useState<string[]>([])
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setLocalTags(single ? single.tags : [])
      setText('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const known = useMemo(() => collectTags(notes), [notes])
  const draft = normalizeTag(text)
  const suggestions = useMemo(
    () => known.filter((k) => !tags.includes(k.tag) && (!draft || k.tag.includes(draft))).slice(0, 8),
    [known, tags, draft]
  )

  const commit = (raw: string): void => {
    const added = parseTagInput(raw)
    if (added.length) setLocalTags((current) => normalizeTags([...current, ...added]))
    setText('')
  }

  const save = (): void => {
    const finalTags = normalizeTags([...tags, ...parseTagInput(text)])
    if (ids) {
      if (single) void setTags(single.id, finalTags)
      else void bulkAddTags(ids, finalTags)
    }
    close()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={single ? 'Теги заметки' : `Добавить теги: заметок ${ids?.length ?? 0}`}
      description={single ? 'Введите слово и нажмите Enter. «#работа» и «работа» — один и тот же тег.' : 'Теги будут добавлены ко всем выбранным заметкам.'}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Отмена
          </Button>
          <Button variant="primary" onClick={save}>
            Готово
          </Button>
        </>
      }
    >
      <div
        className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl border border-[var(--border-input)] bg-input px-2 py-1.5 focus-within:border-[var(--border-focus)] focus-within:shadow-focus"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <span key={tag} className="tag-chip">
            #{tag}
            <button
              type="button"
              aria-label={`Убрать тег ${tag}`}
              onClick={() => setLocalTags((current) => current.filter((t) => t !== tag))}
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          data-autofocus
          value={text}
          aria-label="Новый тег"
          placeholder={tags.length ? '' : '#работа'}
          onChange={(e) => {
            const value = e.target.value
            if (/[\s,;]$/.test(value) && value.trim()) commit(value)
            else setText(value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (text.trim()) commit(text)
              else save()
            } else if (e.key === 'Backspace' && !text && tags.length) {
              setLocalTags((current) => current.slice(0, -1))
            }
          }}
          className="h-7 min-w-[100px] flex-1 bg-transparent text-base text-fg outline-none"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium text-fg-muted">Уже используются</div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s.tag} type="button" className="tag-chip hover:bg-active" onClick={() => commit(s.tag)}>
                #{s.tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
