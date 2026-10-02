import { create } from 'zustand'
import type { AppSettings, CardSize, HotkeyRegistrationResult, Note, OcrFeedback, ToastPayload } from '@shared/types'
import type { AiSettings, ProviderPublicState } from '@shared/providers'
import type { NoteColor } from '@shared/noteMeta'
import { addTags as mergeTags, isContentPatch, normalizeTags } from '@shared/noteMeta'
import { normalizeSortOrder, type SortOrder } from '@shared/noteList'
import { applySelection, EMPTY_SELECTION, pruneSelection, type SelectionState } from '@shared/selection'
import { resolveStartupNote } from '@shared/noteLifecycle'
import { EMPTY_QUEUE_STATE, type OcrQueueState } from '@shared/ocrJob'
import { movableIds, undoMovePlan, type Folder } from '@shared/folders'

export type ViewMode = 'grid' | 'list'
/** Global modes shown in the navigation rail. */
export type AppSection = 'notes' | 'settings' | 'help'
/** Collections inside the notes section (context sidebar). */
export type NotesFilter = 'all' | 'recent' | 'favorites' | 'pinned' | 'trash'
export type SettingsCategory = 'general' | 'editor' | 'recognition' | 'providers' | 'usage' | 'hotkeys' | 'storage' | 'data' | 'about'

/** Dialogs for folders, opened from the sidebar, menus and the selection bar. */
export type FolderDialog =
  | { type: 'create'; thenMove?: string[] }
  | { type: 'rename'; folderId: string }
  | { type: 'delete'; folderId: string }
  | { type: 'move'; ids: string[] }

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
  /** Only notes with this tag (combined with the collection above). */
  tagFilter: string | null
  folders: Folder[]
  /** The folder shown in the list; null = "Все заметки". */
  activeFolderId: string | null
  folderDialog: FolderDialog | null
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
  /** Search words to highlight inside the note that was opened from a search result. */
  highlightQuery: string
  selection: SelectionState
  /** Notes whose tags the tag dialog is editing (one or a whole selection). */
  tagEditorIds: string[] | null
  processingIds: string[]
  toasts: AppToast[]
  showOnboarding: boolean
  showWhatsNew: boolean
  updateAvailableVersion: string | null
  updateReadyVersion: string | null
  /** Credential-free provider states pushed by the main process. */
  providers: ProviderPublicState[]
  /** Captures waiting / being recognized in the background. */
  ocrQueue: OcrQueueState

  init: (options?: { restore?: boolean }) => Promise<void>
  refreshProviders: () => Promise<void>
  openUsageCenter: () => void
  dismissWhatsNew: () => Promise<void>
  openWhatsNew: () => void
  installUpdate: () => void
  dismissUpdateBanner: () => void
  setSearchQuery: (q: string) => void
  setViewMode: (m: ViewMode) => void
  setNotesFilter: (f: NotesFilter) => void
  setTagFilter: (tag: string | null) => void
  setActiveFolder: (id: string | null) => void
  openFolderDialog: (dialog: FolderDialog) => void
  closeFolderDialog: () => void
  /** Resolves with an error message, or null when the folder was created. */
  createFolder: (name: string) => Promise<{ error: string | null; folder?: Folder }>
  renameFolder: (id: string, name: string) => Promise<string | null>
  deleteFolder: (id: string, mode: 'unfile' | 'trash') => Promise<void>
  moveNotes: (ids: string[], folderId: string | null) => Promise<void>
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  setLayoutNarrow: (narrow: boolean) => void
  setCommandOpen: (open: boolean) => void
  focusSearch: () => void
  openNote: (id: string, highlight?: string) => void
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
  toggleFavorite: (id: string) => Promise<void>
  setColor: (id: string, color: NoteColor) => Promise<void>
  setTags: (id: string, tags: string[]) => Promise<void>
  duplicateNote: (id: string) => Promise<void>
  openFloating: (id: string) => Promise<void>
  restoreNote: (id: string) => Promise<void>
  permanentDelete: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>

  // multi-selection and bulk actions
  clickCard: (id: string, mods: { ctrl: boolean; shift: boolean }, order: string[]) => void
  clearSelection: () => void
  selectAll: (ids: string[]) => void
  openTagEditor: (ids: string[]) => void
  closeTagEditor: () => void
  bulkPin: (ids: string[], value: boolean) => Promise<void>
  bulkFavorite: (ids: string[], value: boolean) => Promise<void>
  bulkColor: (ids: string[], color: NoteColor) => Promise<void>
  bulkAddTags: (ids: string[], tags: string[]) => Promise<void>
  bulkDelete: (ids: string[]) => Promise<void>
  bulkExport: (ids: string[]) => Promise<void>

  // view / behaviour settings
  setSortOrder: (sort: SortOrder) => void
  setCardSize: (size: CardSize) => void
  setCompactGrid: (compact: boolean) => void
  setOcrFeedback: (feedback: OcrFeedback) => void

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

function patchNotes(notes: Note[], ids: Set<string>, patch: (n: Note) => Partial<Note>): Note[] {
  return notes.map((n) => (ids.has(n.id) ? { ...n, ...patch(n) } : n))
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
  tagFilter: null,
  folders: [],
  activeFolderId: null,
  folderDialog: null,
  settingsCategory: 'general',
  sidebarOpen: initialPrefs.sidebarOpen,
  layoutNarrow: false,
  drawerOpen: false,
  commandOpen: false,
  searchFocusTick: 0,
  editorNoteId: null,
  highlightQuery: '',
  selection: EMPTY_SELECTION,
  tagEditorIds: null,
  processingIds: [],
  toasts: [],
  showOnboarding: false,
  showWhatsNew: false,
  updateAvailableVersion: null,
  updateReadyVersion: null,
  providers: [],
  ocrQueue: EMPTY_QUEUE_STATE,
  noteRevisions: {},

  init: async (options = {}) => {
    if (initStarted) return
    initStarted = true

    const [notes, trashNotes, settings, version, providers, folders] = await Promise.all([
      window.api.notes.list(),
      window.api.notes.listTrash().catch(() => [] as Note[]),
      window.api.settings.get(),
      window.api.app.getVersion(),
      window.api.providers.list().catch(() => [] as ProviderPublicState[]),
      window.api.folders.list().catch(() => [] as Folder[])
    ])
    const showWhatsNew = settings.onboardingComplete && settings.lastSeenVersion !== version
    // Restore the note that was open when the app was closed — if it still exists.
    const restoreId = options.restore === false ? null : resolveStartupNote(settings.restoreLastNote, settings.lastNoteId, notes)
    set({
      notes,
      trashNotes,
      settings,
      providers,
      folders,
      showOnboarding: !settings.onboardingComplete,
      showWhatsNew,
      ready: true,
      ...(restoreId ? { editorNoteId: restoreId } : {})
    })
    if (restoreId) window.api.notes.setActive(restoreId)

    window.api.providers.onChanged((states) => set({ providers: states }))
    window.api.folders.onChanged((folders) =>
      set((state) => ({
        folders,
        // The open folder was deleted in another window: back to "Все заметки".
        activeFolderId: state.activeFolderId && !folders.some((f) => f.id === state.activeFolderId) ? null : state.activeFolderId
      }))
    )
    void window.api.ocr.getState().then((ocrQueue) => set({ ocrQueue }))
    window.api.ocr.onState((ocrQueue) => set({ ocrQueue }))

    window.api.notes.onCreated((note) => {
      set((state) => ({ notes: upsert(state.notes, note) }))
    })
    window.api.notes.onUpdated((note) => {
      set((state) => ({
        // A note restored from the trash in another window appears again; a trashed one never shows.
        notes: note.deletedAt === null ? upsert(state.notes, note) : state.notes.filter((n) => n.id !== note.id),
        noteRevisions: { ...state.noteRevisions, [note.id]: (state.noteRevisions[note.id] ?? 0) + 1 }
      }))
    })
    window.api.notes.onDeleted((id) => {
      set((state) => {
        const closing = state.editorNoteId === id
        return {
          notes: state.notes.filter((n) => n.id !== id),
          editorNoteId: closing ? null : state.editorNoteId,
          selection: pruneSelection(state.selection, new Set(state.notes.filter((n) => n.id !== id).map((n) => n.id)))
        }
      })
      void get().refreshTrash()
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
        window.api.notes.setActive(payload.noteId ?? null)
      } else if (payload.view === 'search') {
        set({ commandOpen: true })
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
    // Favorites, Recent and Pinned look across all notes, whatever folder they are in.
    if (f !== 'all' && get().activeFolderId) window.api.notes.setActiveFolder(null)
    set((state) => ({ section: 'notes', notesFilter: f, selection: EMPTY_SELECTION, activeFolderId: f === 'all' ? state.activeFolderId : null }))
  },
  setTagFilter: (tag) => set({ section: 'notes', tagFilter: tag, selection: EMPTY_SELECTION, notesFilter: get().notesFilter === 'trash' ? 'all' : get().notesFilter }),
  setActiveFolder: (id) => {
    window.api.notes.setActiveFolder(id)
    set({ section: 'notes', notesFilter: 'all', activeFolderId: id, tagFilter: null, selection: EMPTY_SELECTION })
  },
  openFolderDialog: (dialog) => set({ folderDialog: dialog }),
  closeFolderDialog: () => set({ folderDialog: null }),

  createFolder: async (name) => {
    const result = await window.api.folders.create(name)
    set({ folders: result.folders })
    if (!result.ok) return { error: result.error }
    return { error: null, folder: result.folder }
  },

  renameFolder: async (id, name) => {
    const result = await window.api.folders.rename(id, name)
    set({ folders: result.folders })
    return result.ok ? null : result.error
  },

  deleteFolder: async (id, mode) => {
    const name = get().folders.find((f) => f.id === id)?.name ?? ''
    const result = await window.api.folders.remove(id, mode)
    if (!result.ok) return
    const trashed = new Set(result.trashed)
    set((state) => ({
      folders: result.folders,
      activeFolderId: state.activeFolderId === id ? null : state.activeFolderId,
      notes: state.notes.filter((n) => !trashed.has(n.id)).map((n) => (n.folderId === id ? { ...n, folderId: null } : n)),
      editorNoteId: state.editorNoteId && trashed.has(state.editorNoteId) ? null : state.editorNoteId,
      selection: EMPTY_SELECTION
    }))
    if (result.trashed.length) void get().refreshTrash()
    get().pushToast(
      'success',
      mode === 'trash' ? `Папка «${name}» удалена, заметки в корзине: ${result.trashed.length}` : `Папка «${name}» удалена. Заметки остались в «Все заметки»`
    )
  },

  moveNotes: async (ids, folderId) => {
    const { notes, folders } = get()
    const changing = movableIds(notes, ids, folderId)
    if (changing.length === 0) return
    const plan = undoMovePlan(notes, changing)
    const changing_ = new Set(changing)
    // Shown at once; the main process confirms.
    set((state) => ({ notes: state.notes.map((n) => (changing_.has(n.id) ? { ...n, folderId } : n)) }))
    const result = await window.api.notes.move(changing, folderId)
    if (!result.ok) {
      set((state) => ({ notes: state.notes.map((n) => (changing_.has(n.id) ? { ...n, folderId: plan.find((p) => p.id === n.id)?.folderId ?? null } : n)) }))
      get().pushToast('error', 'Не удалось переместить заметки')
      return
    }
    const target = folderId ? (folders.find((f) => f.id === folderId)?.name ?? 'папку') : 'Все заметки'
    const text = changing.length === 1 ? `Перемещено в «${target}»` : `Перемещено в «${target}»: ${changing.length}`
    get().pushToast('success', text, {
      label: 'Отменить',
      run: () => {
        // Each note goes back to the folder it came from.
        const byFolder = new Map<string | null, string[]>()
        for (const step of plan) byFolder.set(step.folderId, [...(byFolder.get(step.folderId) ?? []), step.id])
        for (const [from, group] of byFolder) {
          set((state) => ({ notes: state.notes.map((n) => (group.includes(n.id) ? { ...n, folderId: from } : n)) }))
          void window.api.notes.move(group, from)
        }
      }
    })
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

  openNote: (id, highlight) => {
    set((state) => ({
      editorNoteId: id,
      highlightQuery: highlight ?? '',
      section: 'notes',
      notesFilter: state.notesFilter === 'trash' ? 'all' : state.notesFilter
    }))
    window.api.notes.setActive(id)
    rememberLastNote(id)
  },
  closeEditor: () => {
    set({ editorNoteId: null, highlightQuery: '' })
    window.api.notes.setActive(null)
    rememberLastNote(null)
  },
  openSettings: (category) =>
    set((state) => ({ section: 'settings', settingsCategory: category ?? state.settingsCategory })),
  openInstructions: () => set({ section: 'help' }),
  openTrash: async () => {
    if (get().editorNoteId) get().closeEditor()
    set({ section: 'notes', notesFilter: 'trash', selection: EMPTY_SELECTION })
    await get().refreshTrash()
  },
  refreshTrash: async () => {
    const trashNotes = await window.api.notes.listTrash()
    set({ trashNotes })
  },
  backToNotes: () => set((state) => ({ section: 'notes', notesFilter: state.notesFilter === 'trash' ? 'all' : state.notesFilter })),

  createNote: async () => {
    const note = await window.api.notes.create({ folderId: get().activeFolderId })
    set((state) => ({
      notes: upsert(state.notes, note),
      notesFilter: state.notesFilter === 'trash' ? 'all' : state.notesFilter,
      selection: EMPTY_SELECTION
    }))
    get().openNote(note.id)
    // A new note made while a tag is filtered starts with that tag, so it does not "vanish" from the list.
    const tag = get().tagFilter
    if (tag) void get().setTags(note.id, [tag])
  },

  updateNote: async (id, patch) => {
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: isContentPatch(patch) ? Date.now() : n.updatedAt } : n))
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
      editorNoteId: state.editorNoteId === id ? null : state.editorNoteId,
      selection: pruneSelection(state.selection, new Set(state.notes.filter((n) => n.id !== id).map((n) => n.id)))
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

  toggleFavorite: async (id) => {
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    await get().updateNote(id, { favorite: !note.favorite })
  },

  setColor: async (id, color) => {
    await get().updateNote(id, { color })
  },

  setTags: async (id, tags) => {
    await get().updateNote(id, { tags: normalizeTags(tags) })
  },

  duplicateNote: async (id) => {
    const copy = await window.api.notes.duplicate(id)
    if (!copy) {
      get().pushToast('error', 'Не удалось создать копию')
      return
    }
    set((state) => ({ notes: upsert(state.notes, copy) }))
    get().pushToast('success', 'Копия заметки создана', { label: 'Открыть', run: () => get().openNote(copy.id) })
  },

  openFloating: async (id) => {
    // Pending edits are saved by the editor before the other window loads the note.
    const result = await window.api.notes.openFloating(id)
    if (!result.ok) get().pushToast('error', 'Не удалось открыть заметку в отдельном окне')
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

  clickCard: (id, mods, order) => {
    set((state) => ({ selection: applySelection(state.selection, { order, id, ctrl: mods.ctrl, shift: mods.shift }) }))
  },
  clearSelection: () => set({ selection: EMPTY_SELECTION }),
  selectAll: (ids) => set({ selection: { selected: ids, anchor: ids[0] ?? null } }),
  openTagEditor: (ids) => set({ tagEditorIds: ids }),
  closeTagEditor: () => set({ tagEditorIds: null }),

  bulkPin: async (ids, value) => {
    const set_ = new Set(ids)
    set((state) => ({ notes: patchNotes(state.notes, set_, () => ({ pinned: value })) }))
    await window.api.notes.bulkUpdate(ids, { type: 'pin', value })
  },
  bulkFavorite: async (ids, value) => {
    const set_ = new Set(ids)
    set((state) => ({ notes: patchNotes(state.notes, set_, () => ({ favorite: value })) }))
    await window.api.notes.bulkUpdate(ids, { type: 'favorite', value })
  },
  bulkColor: async (ids, color) => {
    const set_ = new Set(ids)
    set((state) => ({ notes: patchNotes(state.notes, set_, () => ({ color })) }))
    await window.api.notes.bulkUpdate(ids, { type: 'color', value: color })
  },
  bulkAddTags: async (ids, tags) => {
    const clean = normalizeTags(tags)
    if (clean.length === 0) return
    const set_ = new Set(ids)
    set((state) => ({ notes: patchNotes(state.notes, set_, (n) => ({ tags: mergeTags(n.tags, clean) })) }))
    await window.api.notes.bulkUpdate(ids, { type: 'addTags', tags: clean })
  },
  bulkDelete: async (ids) => {
    const moved = await window.api.notes.bulkDelete(ids)
    if (moved.length === 0) return
    const gone = new Set(moved)
    set((state) => ({
      notes: state.notes.filter((n) => !gone.has(n.id)),
      editorNoteId: state.editorNoteId && gone.has(state.editorNoteId) ? null : state.editorNoteId,
      selection: EMPTY_SELECTION
    }))
    if (get().editorNoteId === null) window.api.notes.setActive(null)
    void get().refreshTrash()
    // Everything goes to the trash, never straight to "deleted": one click brings all of it back.
    get().pushToast('success', `В корзину: ${moved.length}`, {
      label: 'Отменить',
      run: () =>
        void window.api.notes.bulkRestore(moved).then((restored) => {
          set((state) => ({
            notes: restored.reduce((acc, n) => upsert(acc, n), state.notes),
            trashNotes: state.trashNotes.filter((n) => !gone.has(n.id))
          }))
        })
    })
  },
  bulkExport: async (ids) => {
    const result = await window.api.notes.exportMany(ids)
    if (result.ok) get().pushToast('success', `Сохранено: ${result.path}`)
    else if (!result.canceled) get().pushToast('error', result.message ?? 'Не удалось экспортировать заметки')
  },

  setSortOrder: (sort) => void get().updateSettings({ sortOrder: normalizeSortOrder(sort) }),
  setCardSize: (size) => void get().updateSettings({ cardSize: size }),
  setCompactGrid: (compact) => void get().updateSettings({ compactGrid: compact }),
  setOcrFeedback: (feedback) => void get().updateSettings({ ocrFeedback: feedback }),

  pushToast: (type, message, action) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, type, message, action }] }))
  },
  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  updateSettings: async (patch) => {
    // Apply right away so sort / card size / font changes feel instant; the main process then confirms.
    const current = get().settings
    if (current) set({ settings: { ...current, ...(patch as Partial<AppSettings>), ai: current.ai } })
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

/** Remembers which note is open so the next start can come back to it. Fire-and-forget. */
function rememberLastNote(id: string | null): void {
  void window.api.settings.update({ lastNoteId: id }).catch(() => undefined)
}
