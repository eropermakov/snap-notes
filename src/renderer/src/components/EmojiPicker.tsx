import { useMemo, useState, type ReactElement } from 'react'
import { suggestEmojis, COMMON_EMOJIS } from '@shared/emojiSuggest'
import { EmojiIcon, CloseIcon } from './icons'

interface Props {
  emoji: string | null
  contextText: string
  onSelect: (emoji: string | null) => void
}

export default function EmojiPicker({ emoji, contextText, onSelect }: Props): ReactElement {
  const [open, setOpen] = useState(false)
  const suggestions = useMemo(() => suggestEmojis(contextText), [contextText])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-surface-border bg-bg text-lg transition hover:border-accent active:scale-[0.97]"
        title="Эмодзи заметки"
      >
        {emoji ?? <EmojiIcon className="h-4 w-4 text-muted" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-64 origin-top-left rounded-xl border border-surface-border bg-surface p-3 shadow-card-hover motion-safe:animate-pop-in">
            {suggestions.length > 0 && (
              <>
                <p className="mb-1.5 text-xs font-medium text-muted">По смыслу заметки</p>
                <div className="mb-3 flex flex-wrap gap-1">
                  {suggestions.map((e) => (
                    <button
                      key={e}
                      onClick={() => {
                        onSelect(e)
                        setOpen(false)
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition hover:bg-accent-light active:scale-90"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="mb-1.5 text-xs font-medium text-muted">Другие</p>
            <div className="mb-2 flex flex-wrap gap-1">
              {COMMON_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    onSelect(e)
                    setOpen(false)
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition hover:bg-accent-light active:scale-90"
                >
                  {e}
                </button>
              ))}
            </div>
            {emoji && (
              <button
                onClick={() => {
                  onSelect(null)
                  setOpen(false)
                }}
                className="flex items-center gap-1 text-xs text-muted transition hover:text-danger active:scale-95"
              >
                <CloseIcon className="h-3 w-3" /> Убрать эмодзи
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
