import { useMemo, useState, type ReactElement } from 'react'
import { suggestEmojis, COMMON_EMOJIS } from '@shared/emojiSuggest'
import { Button, Popover, Tooltip } from '../ui'
import { EmojiIcon } from './icons'

interface Props {
  emoji: string | null
  contextText: string
  onSelect: (emoji: string | null) => void
}

function EmojiGrid({ items, onPick }: { items: string[]; onPick: (e: string) => void }): ReactElement {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {items.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onPick(e)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors duration-fast hover:bg-hover"
        >
          {e}
        </button>
      ))}
    </div>
  )
}

export default function EmojiPicker({ emoji, contextText, onSelect }: Props): ReactElement {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const suggestions = useMemo(() => (open ? suggestEmojis(contextText) : []), [contextText, open])

  const pick = (e: string | null): void => {
    onSelect(e)
    setOpen(false)
  }

  return (
    <>
      <Tooltip label={emoji ? 'Сменить эмодзи' : 'Добавить эмодзи'}>
        <button
          ref={setAnchor}
          type="button"
          aria-label="Эмодзи заметки"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-2xl text-fg-muted transition-colors duration-fast hover:bg-hover hover:text-fg-secondary"
        >
          {emoji ?? <EmojiIcon className="h-5 w-5" />}
        </button>
      </Tooltip>

      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} placement="bottom-start" className="w-[296px] p-2" aria-label="Выбор эмодзи">
        {suggestions.length > 0 && (
          <>
            <p className="px-1 pb-1 text-xs font-medium text-fg-muted">По смыслу заметки</p>
            <div className="mb-2">
              <EmojiGrid items={suggestions} onPick={pick} />
            </div>
          </>
        )}
        <p className="px-1 pb-1 text-xs font-medium text-fg-muted">Популярные</p>
        <EmojiGrid items={COMMON_EMOJIS} onPick={pick} />
        {emoji && (
          <div className="mt-2 border-t border-line pt-1.5">
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => pick(null)}>
              Убрать эмодзи
            </Button>
          </div>
        )}
      </Popover>
    </>
  )
}
