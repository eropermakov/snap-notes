import type { ReactElement } from 'react'
import type { Note } from '@shared/types'
import { useAppStore } from '../../store/useAppStore'
import { MenuItem, MenuLabel, MenuSeparator } from '../../ui'
import { CopyIcon, DownloadIcon, OpenIcon, PinIcon, SparkleIcon, TrashIcon } from '../icons'
import { formatAccelerator } from '../HotkeyRecorder'

type CopyFormat = 'ai' | 'markdown' | 'plain' | 'rich'
type ExportFormat = 'txt' | 'md' | 'pdf' | 'docx'

const COPY_LABELS: Record<CopyFormat, string> = {
  ai: 'Скопировано для AI (Markdown)',
  markdown: 'Скопировано как Markdown',
  plain: 'Скопировано как текст',
  rich: 'Скопировано с форматированием — вставьте в Word'
}

/** The same object actions everywhere a note appears: card "…", right-click, sidebar row, editor. */
export default function NoteMenuItems({ note, showOpen = true }: { note: Note; showOpen?: boolean }): ReactElement {
  const openNote = useAppStore((s) => s.openNote)
  const togglePin = useAppStore((s) => s.togglePin)
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
      <MenuSeparator />
      <MenuLabel>Копировать</MenuLabel>
      <MenuItem
        icon={<SparkleIcon />}
        shortcut={copyForAiHotkey ? formatAccelerator(copyForAiHotkey) : undefined}
        onSelect={() => void copy('ai')}
      >
        Для AI (ChatGPT, Claude)
      </MenuItem>
      <MenuItem icon={<CopyIcon />} onSelect={() => void copy('rich')}>
        С форматированием (для Word)
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
