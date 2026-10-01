import { useEffect, type ReactElement } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useAppStore } from './store/useAppStore'
import { useLayoutSize } from './hooks/useLayout'
import { AppShell, Spinner } from './ui'
import AppNavRail from './components/shell/AppNavRail'
import NotesSidebar from './components/notes/NotesSidebar'
import NotesWorkspace from './components/notes/NotesWorkspace'
import Settings, { SettingsSidebar } from './components/Settings'
import Instructions, { HelpSidebar } from './components/Instructions'
import OnboardingWizard from './components/OnboardingWizard'
import WhatsNewDialog from './components/WhatsNewDialog'
import UpdateBanner from './components/UpdateBanner'
import ToastContainer from './components/ToastContainer'
import CommandPalette from './components/CommandPalette'
import ChatGptWelcome from './components/ai/ChatGptWelcome'

const SIDEBAR_WIDTH = { narrow: 260, normal: 248, wide: 272 } as const

/** App-level shortcuts. Ignored while a modal dialog is open. */
function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      if (document.querySelector('[aria-modal="true"]') && e.key.toLowerCase() !== 'k') return
      const s = useAppStore.getState()
      const key = e.key.toLowerCase()
      // Physical keys too, so shortcuts work with the Russian layout.
      if (key === 'k' || e.code === 'KeyK') {
        e.preventDefault()
        s.setCommandOpen(!s.commandOpen)
      } else if (key === 'n' || e.code === 'KeyN') {
        e.preventDefault()
        void s.createNote()
      } else if (key === 'f' || e.code === 'KeyF') {
        e.preventDefault()
        s.setSidebarOpen(true)
        s.focusSearch()
      } else if (e.code === 'Backslash') {
        e.preventDefault()
        s.toggleSidebar()
      } else if (e.code === 'Comma') {
        e.preventDefault()
        s.openSettings()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function MainApp(): ReactElement {
  const init = useAppStore((s) => s.init)
  const ready = useAppStore((s) => s.ready)
  const section = useAppStore((s) => s.section)
  const sidebarOpen = useAppStore((s) => (s.layoutNarrow ? s.drawerOpen : s.sidebarOpen))
  const setLayoutNarrow = useAppStore((s) => s.setLayoutNarrow)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const showOnboarding = useAppStore((s) => s.showOnboarding)
  const showWhatsNew = useAppStore((s) => s.showWhatsNew)
  const theme = useAppStore((s) => s.settings?.theme)
  const layout = useLayoutSize()
  const notesFilter = useAppStore((s) => s.notesFilter)
  const settingsCategory = useAppStore((s) => s.settingsCategory)
  const editorNoteId = useAppStore((s) => s.editorNoteId)

  useGlobalShortcuts()

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Narrow windows turn the sidebar into a drawer without touching the saved docked preference.
  useEffect(() => {
    setLayoutNarrow(layout === 'narrow')
  }, [layout, setLayoutNarrow])

  // The floating sidebar is a navigation drawer: dismiss it once the user has navigated.
  useEffect(() => {
    if (layout === 'narrow') setSidebarOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, notesFilter, settingsCategory, editorNoteId])

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-sidebar text-fg-muted">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  const sidebar =
    section === 'notes' ? <NotesSidebar /> : section === 'settings' ? <SettingsSidebar /> : <HelpSidebar />

  return (
    <>
      <AppShell
        rail={<AppNavRail />}
        sidebar={sidebar}
        sidebarOpen={sidebarOpen}
        sidebarOverlay={layout === 'narrow'}
        sidebarWidth={SIDEBAR_WIDTH[layout]}
        onDismissSidebar={() => setSidebarOpen(false)}
      >
        {section === 'notes' && <NotesWorkspace layout={layout} />}
        {section === 'settings' && <Settings />}
        {section === 'help' && <Instructions />}
      </AppShell>

      <OnboardingWizard open={showOnboarding} />
      <WhatsNewDialog open={!showOnboarding && showWhatsNew} />
      <AnimatePresence>{!showOnboarding && !showWhatsNew && <UpdateBanner />}</AnimatePresence>
      {!showOnboarding && <ChatGptWelcome />}
      <CommandPalette />
      <ToastContainer />
    </>
  )
}
