import { useEffect, type ReactElement } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useAppStore } from './store/useAppStore'
import SearchBar from './components/SearchBar'
import NotesGrid from './components/NotesGrid'
import NoteEditor from './components/NoteEditor'
import Settings from './components/Settings'
import Instructions from './components/Instructions'
import Trash from './components/Trash'
import OnboardingWizard from './components/OnboardingWizard'
import WhatsNewDialog from './components/WhatsNewDialog'
import UpdateBanner from './components/UpdateBanner'
import ToastContainer from './components/ToastContainer'
import Fab from './components/Fab'

export default function MainApp(): ReactElement {
  const init = useAppStore((s) => s.init)
  const ready = useAppStore((s) => s.ready)
  const currentView = useAppStore((s) => s.currentView)
  const editorNoteId = useAppStore((s) => s.editorNoteId)
  const showOnboarding = useAppStore((s) => s.showOnboarding)
  const showWhatsNew = useAppStore((s) => s.showWhatsNew)
  const theme = useAppStore((s) => s.settings?.theme)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme)
    }
  }, [theme])

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-bg">
      <div className="relative flex min-w-0 flex-1 flex-col">
        {currentView === 'notes' && (
          <>
            <SearchBar />
            <NotesGrid />
            <Fab />
          </>
        )}
        {currentView === 'settings' && <Settings />}
        {currentView === 'instructions' && <Instructions />}
        {currentView === 'trash' && <Trash />}
      </div>

      <AnimatePresence>{editorNoteId && <NoteEditor key={editorNoteId} noteId={editorNoteId} />}</AnimatePresence>

      <AnimatePresence>{showOnboarding && <OnboardingWizard />}</AnimatePresence>
      <AnimatePresence>{!showOnboarding && showWhatsNew && <WhatsNewDialog />}</AnimatePresence>
      <AnimatePresence>{!showOnboarding && !showWhatsNew && <UpdateBanner />}</AnimatePresence>

      <ToastContainer />
    </div>
  )
}
