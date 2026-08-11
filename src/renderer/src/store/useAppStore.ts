import { create } from 'zustand'
import type { AppSettings, HotkeyRegistrationResult, Note, ToastPayload } from '@shared/types'

export type ViewMode = 'grid' | 'list'
export type CurrentView = 'notes' | 'settings' | 'instructions' | 'trash'

interface AppState {
  ready: boolean
  notes: Note[]
  trashNotes: Note[]
  settings: AppSettings | null
  searchQuery: string
  viewMode: ViewMode
  currentView: CurrentView
  editorNoteId: string | null
  processingIds: string[]
  toasts: ToastPayload[]
  showOnboarding: boolean
  showWhatsNew: boolean
  updateReadyVersion: string | null

  init: () => Promise<void>
  dismissWhatsNew: () => Promise<void>
  installUpdate: () => void
  dismissUpdateBanner: () => void
  setSearchQuery: (q: string) => void
  setViewMode: (m: ViewMode) => void
  openNote: (id: string) => void
  closeEditor: () => void
  openSettings: () => void
  openInstructions: () => void
  openTrash: () => Promise<void>
  backToNotes: () => void
  createNote: () => Promise<void>
  updateNote: (id: string, patch: Partial<Note>) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  togglePin: (id: string) => Promise<void>
  restoreNote: (id: string) => Promise<void>
  permanentDelete: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>
  pushToast: (type: ToastPayload['type'], message: string) => void
  dismissToast: (id: string) => void
  updateSettings: (patch: Partial<AppSettings>) => Promise<HotkeyRegistrationResult | null>
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
  viewMode: 'grid',
  currentView: 'notes',
  editorNoteId: null,
  processingIds: [],
  toasts: [],
  showOnboarding: false,
  showWhatsNew: false,
  updateReadyVersion: null,

  init: async () => {
    if (initStarted) return
    initStarted = true

    const [notes, settings, version] = await Promise.all([
      window.api.notes.list(),
      window.api.settings.get(),
      window.api.app.getVersion()
    ])
    const showWhatsNew = settings.onboardingComplete && settings.lastSeenVersion !== version
    set({ notes, settings, showOnboarding: !settings.onboardingComplete, showWhatsNew, ready: true })

    window.api.notes.onCreated((note) => {
      set((state) => ({ notes: upsert(state.notes, note) }))
    })
    window.api.notes.onUpdated((note) => {
      set((state) => ({ notes: upsert(state.notes, note) }))
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
        set({ currentView: 'notes', editorNoteId: payload.noteId })
        window.api.notes.setActive(payload.noteId)
      }
    })
    window.api.app.onUpdateReady((version) => {
      set({ updateReadyVersion: version })
    })
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
  setViewMode: (m) => set({ viewMode: m }),

  openNote: (id) => {
    set({ editorNoteId: id, currentView: 'notes' })
    window.api.notes.setActive(id)
  },
  closeEditor: () => {
    set({ editorNoteId: null })
    window.api.notes.setActive(null)
  },
  openSettings: () => set({ currentView: 'settings', editorNoteId: null }),
  openInstructions: () => set({ currentView: 'instructions', editorNoteId: null }),
  openTrash: async () => {
    const trashNotes = await window.api.notes.listTrash()
    set({ currentView: 'trash', editorNoteId: null, trashNotes })
  },
  backToNotes: () => set({ currentView: 'notes' }),

  createNote: async () => {
    const note = await window.api.notes.create()
    set((state) => ({ notes: upsert(state.notes, note) }))
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

  pushToast: (type, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }))
  },
  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  updateSettings: async (patch) => {
    const res = await window.api.settings.update(patch)
    set({ settings: res.settings })
    return res.hotkeyResult
  },

  completeOnboarding: async () => {
    const version = await window.api.app.getVersion()
    const res = await window.api.settings.update({ onboardingComplete: true, lastSeenVersion: version })
    set({ settings: res.settings, showOnboarding: false })
  },

  dismissWhatsNew: async () => {
    const version = await window.api.app.getVersion()
    const res = await window.api.settings.update({ lastSeenVersion: version })
    set({ settings: res.settings, showWhatsNew: false })
  },

  installUpdate: () => {
    void window.api.app.installUpdate()
  },
  dismissUpdateBanner: () => set({ updateReadyVersion: null })
}))
