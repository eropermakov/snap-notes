import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { folderCounts, validateFolderName } from '@shared/folders'
import { useAppStore } from '../../store/useAppStore'
import { Button, Modal, cn } from '../../ui'
import { CheckIcon, FolderIcon, PlusIcon } from '../icons'

/** All folder dialogs in one place: create, rename, delete and "move to folder". */
export default function FolderDialogs(): ReactElement {
  const dialog = useAppStore((s) => s.folderDialog)
  const close = useAppStore((s) => s.closeFolderDialog)
  return (
    <>
      <NameDialog open={dialog?.type === 'create' || dialog?.type === 'rename'} onClose={close} />
      <DeleteDialog open={dialog?.type === 'delete'} onClose={close} />
      <MoveDialog open={dialog?.type === 'move'} onClose={close} />
    </>
  )
}

function NameDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const dialog = useAppStore((s) => s.folderDialog)
  const folders = useAppStore((s) => s.folders)
  const createFolder = useAppStore((s) => s.createFolder)
  const renameFolder = useAppStore((s) => s.renameFolder)
  const setActiveFolder = useAppStore((s) => s.setActiveFolder)
  const moveNotes = useAppStore((s) => s.moveNotes)
  const renaming = dialog?.type === 'rename' ? folders.find((f) => f.id === dialog.folderId) : undefined
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(renaming?.name ?? '')
      setError('')
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async (): Promise<void> => {
    if (busy) return
    const check = validateFolderName(name, folders, renaming?.id)
    if (!check.ok) {
      setError(check.error)
      return
    }
    setBusy(true)
    if (renaming) {
      const failure = await renameFolder(renaming.id, check.name)
      if (failure) {
        setError(failure)
        setBusy(false)
        return
      }
    } else {
      const result = await createFolder(check.name)
      if (result.error || !result.folder) {
        setError(result.error ?? 'Не удалось создать папку')
        setBusy(false)
        return
      }
      if (dialog?.type === 'create' && dialog.thenMove?.length) await moveNotes(dialog.thenMove, result.folder.id)
      else setActiveFolder(result.folder.id)
    }
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={renaming ? 'Переименовать папку' : 'Новая папка'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {renaming ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <label className="block text-sm text-fg-secondary" htmlFor="folder-name">
        Название папки
      </label>
      <input
        id="folder-name"
        data-autofocus
        value={name}
        maxLength={60}
        placeholder="Например, Работа"
        onChange={(e) => {
          setName(e.target.value)
          setError('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'folder-name-error' : undefined}
        className={cn(
          'mt-1.5 h-9 w-full rounded-xl border bg-input px-3 text-base text-fg outline-none transition-[border-color,box-shadow] duration-fast focus:border-[var(--border-focus)] focus:shadow-focus',
          error ? 'border-danger' : 'border-[var(--border-input)]'
        )}
      />
      {error && (
        <p id="folder-name-error" role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  )
}

function DeleteDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const dialog = useAppStore((s) => s.folderDialog)
  const folders = useAppStore((s) => s.folders)
  const notes = useAppStore((s) => s.notes)
  const deleteFolder = useAppStore((s) => s.deleteFolder)
  const folder = dialog?.type === 'delete' ? folders.find((f) => f.id === dialog.folderId) : undefined
  const count = useMemo(() => (folder ? (folderCounts(notes).get(folder.id) ?? 0) : 0), [folder, notes])

  return (
    <Modal
      open={open && Boolean(folder)}
      onClose={onClose}
      title={`Удалить папку «${folder?.name ?? ''}»?`}
      description={
        count > 0
          ? `Заметки из этой папки (${count}) не удаляются — они переместятся в «Все заметки».`
          : 'В папке нет заметок.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          {count > 0 && (
            <Button
              variant="danger-ghost"
              onClick={() => {
                if (folder) void deleteFolder(folder.id, 'trash')
                onClose()
              }}
            >
              Удалить вместе с заметками
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => {
              if (folder) void deleteFolder(folder.id, 'unfile')
              onClose()
            }}
          >
            Удалить папку
          </Button>
        </>
      }
    >
      {count > 0 && <p className="text-sm text-fg-muted">«Удалить вместе с заметками» отправляет их в корзину — оттуда их можно вернуть.</p>}
    </Modal>
  )
}

function MoveDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const dialog = useAppStore((s) => s.folderDialog)
  const folders = useAppStore((s) => s.folders)
  const notes = useAppStore((s) => s.notes)
  const moveNotes = useAppStore((s) => s.moveNotes)
  const createFolder = useAppStore((s) => s.createFolder)
  const ids = useMemo(() => (dialog?.type === 'move' ? dialog.ids : []), [dialog])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setError('')
    }
  }, [open])

  // Folders that already contain every chosen note are marked.
  const current = useMemo(() => {
    const chosen = notes.filter((n) => ids.includes(n.id))
    const first = chosen[0]?.folderId ?? null
    return chosen.length > 0 && chosen.every((n) => n.folderId === first) ? first : undefined
  }, [notes, ids])

  const q = query.trim().toLocaleLowerCase('ru')
  const visible = folders.filter((f) => !q || f.name.toLocaleLowerCase('ru').includes(q))
  const canCreate = q.length > 0 && !folders.some((f) => f.name.toLocaleLowerCase('ru') === q)

  const choose = async (folderId: string | null): Promise<void> => {
    await moveNotes(ids, folderId)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={ids.length > 1 ? `В папку: заметок ${ids.length}` : 'В папку'} size="sm">
      <input
        ref={inputRef}
        data-autofocus
        value={query}
        placeholder="Найти или создать папку"
        aria-label="Найти или создать папку"
        onChange={(e) => {
          setQuery(e.target.value)
          setError('')
        }}
        className="mb-2 h-9 w-full rounded-xl border border-[var(--border-input)] bg-input px-3 text-base text-fg outline-none focus:border-[var(--border-focus)] focus:shadow-focus"
      />
      <div role="listbox" aria-label="Папки" className="max-h-[300px] overflow-y-auto">
        <Row label="Без папки" selected={current === null} onClick={() => void choose(null)} />
        {visible.map((f) => (
          <Row key={f.id} label={f.name} selected={current === f.id} onClick={() => void choose(f.id)} icon={<FolderIcon className="h-4 w-4" />} />
        ))}
        {visible.length === 0 && !canCreate && <p className="px-2 py-3 text-sm text-fg-muted">Папок пока нет — введите название, чтобы создать.</p>}
        {canCreate && (
          <Row
            label={`Создать «${query.trim()}» и переместить`}
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={() =>
              void createFolder(query).then(async (r) => {
                if (r.error || !r.folder) setError(r.error ?? 'Не удалось создать папку')
                else await choose(r.folder.id)
              })
            }
          />
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  )
}

function Row({ label, selected, onClick, icon }: { label: string; selected?: boolean; onClick: () => void; icon?: ReactElement }): ReactElement {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-base text-fg transition-colors duration-fast hover:bg-hover"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-secondary">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <CheckIcon className="h-4 w-4 text-accent" />}
    </button>
  )
}
