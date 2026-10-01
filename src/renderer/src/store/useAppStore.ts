import { create } from 'zustand'
import type { AppSettings, HotkeyRegistrationResult, Note, ToastPayload } from '@shared/types'
import type { AiSettings, ProviderPublicState } from '@shared/providers'

export type ViewMode = 'grid' | 'list'
/** Global modes shown in the navigation rail. */
export type AppSection = 'notes' | 'settings' | 'help'
/** Collections inside the notes section (context sidebar). */
export type NotesFilter = 'all' | 'pinned' | 'trash'
export type SettingsCategory = 'general' | 'recognition' | 'providers' | 'usage' | 'hotkeys' | 'storage' | 'data' | 'about'

export interface ToastAction {
  label: string
  run: () => void
}
export type AppToast = ToastPayload & { action?: ToastAction }

const PREFS_KEY = 'snap-notes:ui'

interface UiPrefs {
  viewMode: ViewMode
  sidebarOpen: boolean
}

function loadPrefs(): UiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<UiPrefs>
    return { viewMode: raw.viewMode === 'list' ? 'list' : 'grid', sidebarOpen: raw.sidebarOpen !== false }
  } catch {
    return { viewMode: 'grid', sidebarOpen: true }
  }
}

function savePrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Per-window convenience only; losing it is harmless.
  }
}

const initialPrefs = loadPrefs()

type SettingsPatch = Omit<Partial<AppSettings>, 'ai' | 'aiKeys' | 'providerKeys'> & { ai?: Partial<AiSettings> }

interface AppState {
  ready: boolean
  notes: Note[]
  trashNotes: Note[]
  settings: AppSettings | null
  searchQuery: string
  viewMode: ViewMode
  section: AppSection
  notesFilter: NotesFilter
  settingsCategory: SettingsCategory
  /** Docked sidebar preference (normal/wide windows), persisted. */
  sidebarOpen: boolean
  /** Narrow windows: the sidebar is a transient drawer over the workspace. */
  layoutNarrow: boolean
  drawerOpen: boolean
  commandOpen: boolean
  /** Bumped to ask the notes sidebar to focus its search field. */
  searchFocusTick: number
  editorNoteId: string | null
  processingIds: string[]
  toasts: AppToast[]
  showOnboarding: boolean
  showWhatsNew: boolean
  updateAvailableVersion: string | null
  updateReadyVersion: string | null
  /** Credential-free provider states pushed by the main process. */
  providers: ProviderPublicState[]

  init: () => Promise<void>
  refreshProviders: () => Promise<void>
  openUsageCenter: () => void
  dismissWhatsNew: () => Promise<void>
  openWhatsNew: () => void
  installUpdate: () => void
  dismissUpdateBanner: () => void
  setSearchQuery: (q: string) => void
  setViewMode: (m: ViewMode) => void
  setNotesFilter: (f: NotesFilter) => void
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  setLayoutNarrow: (narrow: boolean) => void
  setCommandOpen: (open: boolean) => void
  focusSearch: () => void
  openNote: (id: string) => void
  closeEditor: () => void
  openSettings: (category?: SettingsCategory) => void
  openInstructions: () => void
  openTrash: () => Promise<void>
  refreshTrash: () => Promise<void>
  backToNotes: () => void
  createNote: () => Promise<void>
  /** Saves a patch; resolves with the note as the main process stored it. */
  updateNote: (id: string, patch: Partial<Note>) => Promise<Note | null>
  /**
   * Bumped when a note changes outside the editor (capture, undo, AI action…), as opposed to the
   * echo of the editor's own saves. The editor merges only these into its local text.
   */
  noteRevisions: Record<string, number>
  deleteNote: (id: string) => Promise<void>
  togglePin: (id: string) => Promise<void>
  restoreNote: (id: string) => Promise<void>
  permanentDelete: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>
  pushToast: (type: ToastPayload['type'], message: string, action?: ToastAction) => void
  dismissToast: (id: string) => void
  updateSettings: (patch: SettingsPatch) => Promise<HotkeyRegistrationResult | null>
  updateAiSettings: (patch: Partial<AiSettings>) => Promise<void>
  completeOnboarding: () => Promise<void>
}

function upsert(notes: Note[], note: Note): Note[] {
  const idx = notes.findIndex((n) => n.id === note.id)
  if (idx === -1) return [...notes, note]
  const next = notes.slice()
  next[idx] = note
  return next
}

let initStarted = false

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  notes: [],
  trashNotes: [],
  settings: null,
  searchQuery: '',
  viewMode: initialPrefs.viewMode,
  section: 'notes',
  notesFilter: 'all',
  settingsCategory: 'general',
  sidebarOpen: initialPrefs.sidebarOpen,
  layoutNarrow: false,
  drawerOpen: false,
  commandOpen: false,
  searchFocusTick: 0,
  editorNoteId: null,
  processingIds: [],
  toasts: [],
  showOnboarding: false,
  showWhatsNew: false,
  updateAvailableVersion: null,
  updateReadyVersion: null,
  providers: [],
  noteRevisions: {},

  init: async () => {
    if (initStarted) return
    initStarted = true

    const [notes, trashNotes, settings, version, providers] = await Promise.all([
      window.api.notes.list(),
      window.api.notes.listTrash().catch(() => [] as Note[]),
      window.api.settings.get(),
      window.api.app.getVersion(),
      window.api.providers.list().catch(() => [] as ProviderPublicState[])
    ])
    const showWhatsNew = settings.onboardingComplete && settings.lastSeenVersion !== version
    set({ notes, trashNotes, settings, providers, showOnboarding: !settings.onboardingComplete, showWhatsNew, ready: true })

    window.api.providers.onChanged((states) => set({ providers: states }))

    window.api.notes.onCreated((note) => {
      set((state) => ({ notes: upsert(state.notes, note) }))
    })
    window.api.notes.onUpdated((note) => {
      set((state) => ({
        notes: upsert(state.notes, note),
        noteRevisions: { ...state.noteRevisions, [note.id]: (state.noteRevisions[note.id] ?? 0) + 1 }
      }))
    })
    window.api.notes.onDeleted((id) => {
      set((state) => ({ notes: state.notes.filter((n) => n.id !== id) }))
    })
    window.api.notes.onProcessingStart((id) => {
      set((state) => ({
        processingIds: state.processingIds.includes(id) ? state.processingIds : [...state.processingIds, id]
      }))
    })
    window.api.notes.onProcessingEnd((id) => {
      set((state) => ({ processingIds: state.processingIds.filter((x) => x !== id) }))
    })
    window.api.toast.onToast((payload) => {
      get().pushToast(payload.type, payload.message)
    })
    window.api.navigation.onNavigate((payload) => {
      if (payload.view === 'editor' && payload.noteId) {
        set((state) => ({
          section: 'notes',
          notesFilter: state.notesFilter === 'trash' ? 'all' : state.notesFilter,
          editorNoteId: payload.noteId
        }))
        window.api.notes.setActive(payload.noteId)
      }
    })
    window.api.app.onUpdateAvailable((version) => {
      set({ updateAvailableVersion: version })
    })
    window.api.app.onUpdateReady((version) => {
      set({ updateReadyVersion: version })
    })
  },

  refreshProviders: async () => {
    const providers = await window.api.providers.list()
    set({ providers })
  },
  openUsageCenter: () => get().openSettings('usage'),

  setSearchQuery: (q) => set({ searchQuery: q }),
  setViewMode: (m) => {
    set({ viewMode: m })
    savePrefs({ viewMode: m, sidebarOpen: get().sidebarOpen })
  },
  setNotesFilter: (f) => {
    if (f === 'trash') {
      void get().openTrash()
      return
    }
    set({ section: 'notes', notesFilter: f })
  },
  setSidebarOpen: (open) => {
    if (get().layoutNarrow) {
      set({ drawerOpen: open })
      return
    }
    set({ sidebarOpen: open })
    savePrefs({ viewMode: get().viewMode, sidebarOpen: open })
  },
  toggleSidebar: () => {
    const { layoutNarrow, drawerOpen, sidebarOpen } = get()
    get().setSidebarOpen(layoutNarrow ? !drawerOpen : !sidebarOpen)
  },
  setLayoutNarrow: (narrow) => set({ layoutNarrow: narrow, drawerOpen: false }),
  setCommandOpen: (open) => set({ commandOpen: open }),
  focusSearch: () =>
    set((state) => ({
      section: 'notes',
      notesFilter: state.notesFilter === 'trash' ? 'all' : state.notesFilter,
      searchFocusTick: state.searchFocusTick + 1
    })),

  openNote: (id) => {
    set((state) => ({
      editorNoteId: id,
      section: 'notes',
      notesFilter: state.notesFilter === 'trash' ? 'all' : state.notesFilter
    }))
    window.api.notes.setActive(id)
  },
  closeEditor: () => {
    set({ editorNoteId: null })
    window.api.notes.setActive(null)
  },
  openSettings: (category) =>
    set((state) => ({ section: 'settings', settingsCategory: category ?? state.settingsCategory })),
  openInstructions: () => set({ section: 'help' }),
  openTrash: async () => {
    if (get().editorNoteId) get().closeEditor()
    set({ section: 'notes', notesFilter: 'trash' })
    await get().refreshTrash()
  },
  refreshTrash: async () => {
    const trashNotes = await window.api.notes.listTrash()
    set({ trashNotes })
  },
  backToNotes: () => set((state) => ({ section: 'notes', notesFilter: state.notesFilter === 'trash' ? 'all' : state.notesFilter })),

  createNote: async () => {
    const note = await window.api.notes.create()
    set((state) => ({ notes: upsert(state.notes, note), notesFilter: state.notesFilter === 'pinned' ? 'all' : state.notesFilter }))
    get().openNote(note.id)
  },

  updateNote: async (id, patch) => {
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n))
    }))
    const updated = await window.api.notes.update(id, patch)
    if (updated) {
      set((state) => ({ notes: upsert(state.notes, updated) }))
    }
    return updated
  },

  deleteNote: async (id) => {
    set((state) => ({
      notes: state.notes.filter((n) => n.id !== id),
      editorNoteId: state.editorNoteId === id ? null : state.editorNoteId
    }))
    if (get().editorNoteId === null) {
      window.api.notes.setActive(null)
    }
    await window.api.notes.remove(id)
    void get().refreshTrash()
    // Deleting only moves the note to the trash, so no confirmation — offer an undo instead.
    get().pushToast('success', 'Заметка перемещена в корзину', { label: 'Отменить', run: () => void get().restoreNote(id) })
  },

  togglePin: async (id) => {
    set((state) => ({ notes: state.notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)) }))
    const updated = await window.api.notes.togglePin(id)
    if (updated) {
      set((state) => ({ notes: upsert(state.notes, updated) }))
    }
  },

  restoreNote: async (id) => {
    const restored = await window.api.notes.restore(id)
    set((state) => ({
      trashNotes: state.trashNotes.filter((n) => n.id !== id),
      notes: restored ? upsert(state.notes, restored) : state.notes
    }))
  },

  permanentDelete: async (id) => {
    set((state) => ({ trashNotes: state.trashNotes.filter((n) => n.id !== id) }))
    await window.api.notes.permanentDelete(id)
  },

  emptyTrash: async () => {
    set({ trashNotes: [] })
    await window.api.notes.emptyTrash()
  },

  pushToast: (type, message, action) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, type, message, action }] }))
  },
  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  updateSettings: async (patch) => {
    const res = await window.api.settings.update(patch)
    set({ settings: res.settings })
    return res.hotkeyResult
  },

  updateAiSettings: async (patch) => {
    const current = get().settings
    if (current) set({ settings: { ...current, ai: { ...current.ai, ...patch } } })
    const res = await window.api.settings.update({ ai: patch })
    set({ settings: res.settings })
  },

  completeOnboarding: async () => {
    const version = await window.api.app.getVersion()
    const res = await window.api.settings.update({ onboardingComplete: true, lastSeenVersion: version })
    set({ settings: res.settings, showOnboarding: false })
  },

  openWhatsNew: () => set({ showWhatsNew: true }),

  dismissWhatsNew: async () => {
    const version = await window.api.app.getVersion()
    const res = await window.api.settings.update({ lastSeenVersion: version })
    set({ settings: res.settings, showWhatsNew: false })
  },

  installUpdate: () => {
    void window.api.app.installUpdate()
  },
  dismissUpdateBanner: () => set({ updateReadyVersion: null, updateAvailableVersion: null })
}))
