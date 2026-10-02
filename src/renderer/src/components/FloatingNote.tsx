import { useEffect, type ReactElement } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useAppFlush } from '../hooks/useAppFlush'
import { Spinner } from '../ui'
import NoteEditor from './NoteEditor'
import TagEditorDialog from './notes/TagEditorDialog'
import ToastContainer from './ToastContainer'

/**
 * A single note in its own small window. It uses the same editor and store as the main window; edits
 * travel through the main process, so both windows always show the same text.
 */
export default function FloatingNote({ noteId }: { noteId: string }): ReactElement {
  const ready = useAppStore((s) => s.ready)
  const note = useAppStore((s) => s.notes.find((n) => n.id === noteId))
  const theme = useAppStore((s) => s.settings?.theme)
  const init = useAppStore((s) => s.init)

  useAppFlush()
  useEffect(() => {
    void init({ restore: false })
  }, [init])
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  useEffect(() => {
    document.title = note ? note.title.trim() || 'Заметка' : 'Заметка'
  }, [note])

  // The note was deleted in another window: nothing left to show.
  useEffect(() => {
    if (ready && !note) window.api.window.close()
  }, [ready, note])

  if (!ready || !note) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas text-fg-muted">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-canvas">
      <NoteEditor noteId={noteId} layout="narrow" embedded />
      <TagEditorDialog />
      <ToastContainer />
    </div>
  )
}
