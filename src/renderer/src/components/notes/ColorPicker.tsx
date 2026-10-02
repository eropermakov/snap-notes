import { useState, type ReactElement } from 'react'
import { NOTE_COLORS, NOTE_COLOR_LABELS, type NoteColor } from '@shared/noteMeta'
import { IconButton, Popover, cn, useMenuClose } from '../../ui'
import { CheckIcon, CloseIcon, PaletteIcon } from '../icons'

function Swatch({ color, selected, onPick, menu }: { color: NoteColor; selected: boolean; onPick: (c: NoteColor) => void; menu?: boolean }): ReactElement {
  const label = NOTE_COLOR_LABELS[color]
  return (
    <button
      type="button"
      role={menu ? 'menuitemradio' : 'radio'}
      aria-checked={selected}
      aria-label={label}
      title={label}
      tabIndex={menu ? -1 : 0}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        onPick(color)
      }}
      className={cn(
        'swatch flex h-6 w-6 items-center justify-center rounded-full text-fg transition-transform duration-fast hover:scale-110',
        `swatch-${color}`,
        selected && 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--surface-elevated)]'
      )}
    >
      {/* The mark inside carries the state / meaning, so colour is never the only signal. */}
      {selected ? <CheckIcon className="h-3.5 w-3.5" /> : color === 'default' ? <CloseIcon className="h-3 w-3 text-fg-muted" /> : null}
    </button>
  )
}

/** The eight calm note colours as one row of round swatches. */
export function ColorSwatches({ value, onPick, menu }: { value: NoteColor; onPick: (c: NoteColor) => void; menu?: boolean }): ReactElement {
  return (
    <div role={menu ? 'group' : 'radiogroup'} aria-label="Цвет заметки" className="flex flex-wrap items-center gap-1.5">
      {NOTE_COLORS.map((color) => (
        <Swatch key={color} color={color} selected={value === color} onPick={onPick} menu={menu} />
      ))}
    </div>
  )
}

/** Inside a context / dropdown menu: picking a colour closes the menu. */
export function MenuColors({ value, onPick }: { value: NoteColor; onPick: (c: NoteColor) => void }): ReactElement {
  const close = useMenuClose()
  return (
    <div className="px-2 pb-1.5 pt-0.5">
      <ColorSwatches
        menu
        value={value}
        onPick={(c) => {
          close()
          onPick(c)
        }}
      />
    </div>
  )
}

/** A small button that opens the colour row (toolbar of the open note, selection bar). */
export function ColorPickerButton({
  value,
  onPick,
  label = 'Цвет заметки'
}: {
  value?: NoteColor
  onPick: (c: NoteColor) => void
  label?: string
}): ReactElement {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton ref={setAnchor} label={label} icon={<PaletteIcon />} active={open} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} placement="bottom-end" className="p-2.5" aria-label={label}>
        <ColorSwatches
          value={value ?? 'default'}
          onPick={(c) => {
            onPick(c)
            setOpen(false)
          }}
        />
      </Popover>
    </>
  )
}
