import type { ReactElement } from 'react'
import type { Note } from '@shared/types'
import { useAppStore } from '../../store/useAppStore'
import { MenuItem, MenuLabel, MenuSeparator } from '../../ui'
import { CopyIcon, DownloadIcon, DuplicateIcon, OpenIcon, PinIcon, SparkleIcon, StarIcon, TagIcon, TrashIcon, WindowIcon } from '../icons'
import { formatAccelerator } from '../HotkeyRecorder'
import { MenuColors } from './ColorPicker'

type CopyFormat = 'ai' | 'markdown' | 'plain' | 'rich'
type ExportFormat = 'txt' | 'md' | 'pdf' | 'docx'

const COPY_LABELS: Record<CopyFormat, string> = {
  ai: 'Скопировано для AI (Markdown)',
  markdown: 'Скопировано как Markdown',
  plain: 'Скопировано как текст',
  rich: 'Скопировано целиком — вставьте в Word или письмо'
}

/**
 * The same object actions everywhere a note appears: card "…", right-click, sidebar row, editor.
 * Order: open → organize (pin, favorite, colour, tags, copy of the note) → copy / export → delete last.
 */
export default function NoteMenuItems({ note, showOpen = true, showFloating = true }: { note: Note; showOpen?: boolean; showFloating?: boolean }): ReactElement {
  const openNote = useAppStore((s) => s.openNote)
  const togglePin = useAppStore((s) => s.togglePin)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const setColor = useAppStore((s) => s.setColor)
  const openTagEditor = useAppStore((s) => s.openTagEditor)
  const duplicateNote = useAppStore((s) => s.duplicateNote)
  const openFloating = useAppStore((s) => s.openFloating)
  const deleteNote = useAppStore((s) => s.deleteNote)
  const pushToast = useAppStore((s) => s.pushToast)
  const copyForAiHotkey = useAppStore((s) => s.settings?.hotkeys.copyForAi)

  const copy = async (format: CopyFormat): Promise<void> => {
    const result = await window.api.notes.copy(note.id, format)
    if (result.ok) pushToast('success', COPY_LABELS[format])
    else pushToast('error', 'Не удалось скопировать заметку')
  }

  const exportAs = async (format: ExportFormat): Promise<void> => {
    const result = await window.api.notes.export(note.id, format)
    if (result.ok) pushToast('success', `Сохранено: ${result.path}`)
    else if (!result.canceled) pushToast('error', result.message ?? 'Не удалось экспортировать заметку')
  }

  return (
    <>
      {showOpen && (
        <MenuItem icon={<OpenIcon />} onSelect={() => openNote(note.id)}>
          Открыть
        </MenuItem>
      )}
      <MenuItem icon={<PinIcon filled={note.pinned} />} onSelect={() => void togglePin(note.id)}>
        {note.pinned ? 'Открепить' : 'Закрепить'}
      </MenuItem>
      <MenuItem icon={<StarIcon filled={note.favorite} />} onSelect={() => void toggleFavorite(note.id)}>
        {note.favorite ? 'Убрать из избранного' : 'В избранное'}
      </MenuItem>
      <MenuLabel>Цвет</MenuLabel>
      <MenuColors value={note.color} onPick={(c) => void setColor(note.id, c)} />
      <MenuItem icon={<TagIcon />} onSelect={() => openTagEditor([note.id])}>
        Теги…
      </MenuItem>
      <MenuItem icon={<DuplicateIcon />} onSelect={() => void duplicateNote(note.id)}>
        Дублировать
      </MenuItem>
      {showFloating && (
        <MenuItem icon={<WindowIcon />} onSelect={() => void openFloating(note.id)}>
          Открыть в отдельном окне
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuLabel>Копировать</MenuLabel>
      <MenuItem icon={<CopyIcon />} onSelect={() => void copy('rich')}>
        Копировать всё
      </MenuItem>
      <MenuItem
        icon={<SparkleIcon />}
        shortcut={copyForAiHotkey ? formatAccelerator(copyForAiHotkey) : undefined}
        onSelect={() => void copy('ai')}
      >
        Для AI (ChatGPT, Claude)
      </MenuItem>
      <MenuItem onSelect={() => void copy('markdown')}>Как Markdown</MenuItem>
      <MenuItem onSelect={() => void copy('plain')}>Как обычный текст</MenuItem>
      <MenuLabel>Экспорт</MenuLabel>
      <MenuItem icon={<DownloadIcon />} onSelect={() => void exportAs('docx')}>
        Word (.docx)
      </MenuItem>
      <MenuItem onSelect={() => void exportAs('pdf')}>PDF</MenuItem>
      <MenuItem onSelect={() => void exportAs('md')}>Markdown (.md)</MenuItem>
      <MenuItem onSelect={() => void exportAs('txt')}>Текст (.txt)</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<TrashIcon />} danger onSelect={() => void deleteNote(note.id)}>
        Переместить в корзину
      </MenuItem>
    </>
  )
}
