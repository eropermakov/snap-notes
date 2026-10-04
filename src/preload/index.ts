import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc'
import type { ActivitySummary, AiSettings, ApiKeyProviderId, ProviderId, ProviderPublicState } from '../shared/providers'
import type { NoteColor } from '../shared/noteMeta'
import type { PickedImage, RetryProvider, RetryResult } from '../shared/retry'
import type { OcrQueueState } from '../shared/ocrJob'
import type { Folder } from '../shared/folders'

export type FolderResponse = { ok: true; folder: Folder; folders: Folder[] } | { ok: false; error: string; folders: Folder[] }
import type { HudAction, HudState } from '../shared/hud'
import type {
  ApiKeyTestResult,
  AppSettings,
  ExportResult,
  HotkeyRegistrationResult,
  Note,
  StorageStats,
  ToastPayload
} from '../shared/types'

type Unsubscribe = () => void

interface SettingsUpdateResponse {
  settings: AppSettings
  hotkeyResult: HotkeyRegistrationResult | null
}

interface ResetAllResponse {
  ok: boolean
  hotkeyResult: HotkeyRegistrationResult | null
}

interface ActionResult {
  ok: boolean
  message?: string
  saved?: boolean
}

type SettingsPatch = Omit<Partial<AppSettings>, 'ai' | 'aiKeys' | 'providerKeys'> & { ai?: Partial<AiSettings> }

interface OpenFolderResponse {
  ok: boolean
  message?: string
}

interface NavigatePayload {
  view: string
  noteId?: string
}

export type BulkNoteOp =
  | { type: 'pin'; value: boolean }
  | { type: 'favorite'; value: boolean }
  | { type: 'color'; value: NoteColor }
  | { type: 'addTags'; tags: string[] }
  | { type: 'removeTags'; tags: string[] }



interface OverlayRect {
  x: number
  y: number
  width: number
  height: number
}

const api = {
  notes: {
    list: (): Promise<Note[]> => ipcRenderer.invoke(IPC.NOTES_LIST),
    create: (options?: { folderId?: string | null }): Promise<Note> => ipcRenderer.invoke(IPC.NOTES_CREATE, options),
    update: (id: string, patch: Partial<Note>): Promise<Note | null> =>
      ipcRenderer.invoke(IPC.NOTES_UPDATE, id, patch),
    bulkUpdate: (ids: string[], op: BulkNoteOp): Promise<Note[]> => ipcRenderer.invoke(IPC.NOTES_BULK_UPDATE, ids, op),
    /** Moves notes to the trash (never a permanent delete). Resolves with the ids that were moved. */
    bulkDelete: (ids: string[]): Promise<string[]> => ipcRenderer.invoke(IPC.NOTES_BULK_DELETE, ids),
    bulkRestore: (ids: string[]): Promise<Note[]> => ipcRenderer.invoke(IPC.NOTES_BULK_RESTORE, ids),
    /** Moves notes into a folder (null = out of every folder); resolves with where each one came from. */
    move: (ids: string[], folderId: string | null): Promise<{ ok: boolean; moved: { id: string; from: string | null }[]; notes?: Note[] }> =>
      ipcRenderer.invoke(IPC.NOTES_MOVE, ids, folderId),
    /** The folder open in the UI: notes made by a capture are created there. */
    setActiveFolder: (id: string | null): void => ipcRenderer.send(IPC.NOTES_SET_ACTIVE_FOLDER, id),
    duplicate: (id: string): Promise<Note | null> => ipcRenderer.invoke(IPC.NOTES_DUPLICATE, id),
    exportMany: (ids: string[]): Promise<ExportResult> => ipcRenderer.invoke(IPC.NOTES_EXPORT_MANY, ids),
    openFloating: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.NOTES_OPEN_FLOATING, id),
    /** Stores a dropped picture (PNG bytes) in the note; resolves with its snap-media:// address. */
    addImage: (noteId: string, bytes: Uint8Array): Promise<string | null> => ipcRenderer.invoke(IPC.NOTES_ADD_IMAGE, noteId, bytes),
    /** "Recognize text" for a picture of the note: text goes under it, or replaces it. */
    recognizeImage: (noteId: string, src: string, mode: 'below' | 'replace'): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke(IPC.NOTES_RECOGNIZE_IMAGE, noteId, src, mode),
    /** OCR of a picture that is not on screen (PNG bytes) into the note, or a new one when noteId is null. */
    ocrImageData: (noteId: string | null, bytes: Uint8Array): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke(IPC.NOTES_OCR_IMAGE_DATA, noteId, bytes),
    pickImage: (): Promise<PickedImage | null> => ipcRenderer.invoke(IPC.NOTES_PICK_IMAGE),
    /** "Привести в порядок" for selected text. */
    cleanupText: (text: string): Promise<{ ok: boolean; text: string; provider?: string; local: boolean }> =>
      ipcRenderer.invoke(IPC.NOTES_CLEANUP_TEXT, text),
    retryProviders: (noteId: string, sourceId: string): Promise<RetryProvider[]> =>
      ipcRenderer.invoke(IPC.NOTES_RETRY_PROVIDERS, noteId, sourceId),
    retrySource: (noteId: string, sourceId: string, target: 'next' | ProviderId): Promise<RetryResult> =>
      ipcRenderer.invoke(IPC.NOTES_RETRY_SOURCE, noteId, sourceId, target),
    applyRetry: (token: string, apply: boolean): Promise<Note | null> => ipcRenderer.invoke(IPC.NOTES_APPLY_RETRY, token, apply),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.NOTES_DELETE, id),
    togglePin: (id: string): Promise<Note | null> => ipcRenderer.invoke(IPC.NOTES_TOGGLE_PIN, id),
    setActive: (id: string | null): void => ipcRenderer.send(IPC.NOTES_SET_ACTIVE, id),
    onCreated: (cb: (note: Note) => void): Unsubscribe => {
      const listener = (_e: unknown, note: Note): void => cb(note)
      ipcRenderer.on(IPC.ON_NOTE_CREATED, listener)
      return () => ipcRenderer.removeListener(IPC.ON_NOTE_CREATED, listener)
    },
    onUpdated: (cb: (note: Note) => void): Unsubscribe => {
      const listener = (_e: unknown, note: Note): void => cb(note)
      ipcRenderer.on(IPC.ON_NOTE_UPDATED, listener)
      return () => ipcRenderer.removeListener(IPC.ON_NOTE_UPDATED, listener)
    },
    onDeleted: (cb: (id: string) => void): Unsubscribe => {
      const listener = (_e: unknown, id: string): void => cb(id)
      ipcRenderer.on(IPC.ON_NOTE_DELETED, listener)
      return () => ipcRenderer.removeListener(IPC.ON_NOTE_DELETED, listener)
    },
    onProcessingStart: (cb: (id: string) => void): Unsubscribe => {
      const listener = (_e: unknown, id: string): void => cb(id)
      ipcRenderer.on(IPC.ON_NOTE_PROCESSING_START, listener)
      return () => ipcRenderer.removeListener(IPC.ON_NOTE_PROCESSING_START, listener)
    },
    onProcessingEnd: (cb: (id: string) => void): Unsubscribe => {
      const listener = (_e: unknown, id: string): void => cb(id)
      ipcRenderer.on(IPC.ON_NOTE_PROCESSING_END, listener)
      return () => ipcRenderer.removeListener(IPC.ON_NOTE_PROCESSING_END, listener)
    },
    listTrash: (): Promise<Note[]> => ipcRenderer.invoke(IPC.NOTES_LIST_TRASH),
    restore: (id: string): Promise<Note | null> => ipcRenderer.invoke(IPC.NOTES_RESTORE, id),
    permanentDelete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.NOTES_PERMANENT_DELETE, id),
    emptyTrash: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.NOTES_EMPTY_TRASH),
    /** 'ai' = clean Markdown for chats; 'rich' = HTML for Word/Docs + plain text. */
    copy: (id: string, format: 'ai' | 'markdown' | 'plain' | 'rich'): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.NOTES_COPY, id, format),
    export: (id: string, format: 'txt' | 'md' | 'pdf' | 'docx'): Promise<ExportResult> =>
      ipcRenderer.invoke(IPC.NOTES_EXPORT, id, format),
    /** "Проверить распознавание": replaces one capture's blocks with corrected HTML. */
    replaceSourceHtml: (id: string, sourceId: string, html: string): Promise<Note | null> =>
      ipcRenderer.invoke(IPC.NOTES_REPLACE_SOURCE_HTML, id, sourceId, html),
    /** Undo one capture: removes its blocks, metadata and original screenshot. */
    removeSource: (id: string, sourceId: string): Promise<Note | null> => ipcRenderer.invoke(IPC.NOTES_REMOVE_SOURCE, id, sourceId),
    /** "Привести в порядок" for one captured fragment: fixes OCR, keeps the meaning. */
    tidySource: (id: string, sourceId: string): Promise<{ ok: boolean; message?: string; provider?: string }> =>
      ipcRenderer.invoke(IPC.NOTES_TIDY_SOURCE, id, sourceId),
    /** Explicit AI action on a fragment; 'explain'/'keypoints' add after it, others replace it. */
    aiAction: (
      id: string,
      sourceId: string,
      action: 'shorten' | 'explain' | 'rewrite' | 'translate' | 'list' | 'keypoints',
      language?: string
    ): Promise<{ ok: boolean; message?: string; provider?: string }> =>
      ipcRenderer.invoke(IPC.NOTES_AI_ACTION, id, sourceId, action, language)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    update: (patch: SettingsPatch): Promise<SettingsUpdateResponse> => ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch),
    getDataPath: (): Promise<string> => ipcRenderer.invoke(IPC.SETTINGS_GET_DATA_PATH),
    openDataFolder: (): Promise<OpenFolderResponse> => ipcRenderer.invoke(IPC.SETTINGS_OPEN_DATA_FOLDER),
    exportNotes: (): Promise<ExportResult> => ipcRenderer.invoke(IPC.SETTINGS_EXPORT_NOTES),
    exportNotesDocx: (): Promise<ExportResult> => ipcRenderer.invoke(IPC.SETTINGS_EXPORT_NOTES_DOCX),
    resetAll: (): Promise<ResetAllResponse> => ipcRenderer.invoke(IPC.SETTINGS_RESET_ALL),
    getStorageStats: (): Promise<StorageStats> => ipcRenderer.invoke(IPC.SETTINGS_GET_STORAGE_STATS),
    clearScreenshotCache: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.SETTINGS_CLEAR_SCREENSHOT_CACHE)
  },
  providers: {
    list: (): Promise<ProviderPublicState[]> => ipcRenderer.invoke(IPC.PROVIDERS_LIST),
    /** The key is sent to the main process once; it is never returned to the renderer. */
    setKey: (provider: ApiKeyProviderId, input: { apiKey: string; keyId?: string; label?: string }): Promise<ActionResult> =>
      ipcRenderer.invoke(IPC.PROVIDERS_SET_KEY, provider, input),
    /** Non-key credential fields (Cloudflare account ID, Modal token ID / endpoint). */
    setFields: (provider: ApiKeyProviderId, values: Record<string, string>): Promise<ActionResult> =>
      ipcRenderer.invoke(IPC.PROVIDERS_SET_FIELDS, provider, values),
    /** Returns a saved secret only after an explicit user action (Reveal). */
    revealSecret: (provider: ApiKeyProviderId, ref: { keyId?: string; field?: string }): Promise<{ ok: boolean; value?: string }> =>
      ipcRenderer.invoke(IPC.PROVIDERS_REVEAL_SECRET, provider, ref),
    /** Copies in the main process: the secret never reaches the renderer. */
    copySecret: (provider: ApiKeyProviderId, ref: { keyId?: string; field?: string }): Promise<ActionResult> =>
      ipcRenderer.invoke(IPC.PROVIDERS_COPY_SECRET, provider, ref),
    /** Opens the provider's official key page in the system browser. */
    openKeyPage: (provider: ProviderId): Promise<ActionResult> => ipcRenderer.invoke(IPC.PROVIDERS_OPEN_KEY_PAGE, provider),
    /** Warning dialog → Save dialog → .env file. Always an explicit action. */
    exportKeys: (): Promise<ActionResult & { cancelled?: boolean; count?: number; path?: string }> =>
      ipcRenderer.invoke(IPC.PROVIDERS_EXPORT_KEYS),
    renameKey: (provider: ApiKeyProviderId, keyId: string, label: string): Promise<ActionResult> =>
      ipcRenderer.invoke(IPC.PROVIDERS_RENAME_KEY, provider, keyId, label),
    removeKey: (provider: ApiKeyProviderId, keyId: string): Promise<ActionResult> =>
      ipcRenderer.invoke(IPC.PROVIDERS_REMOVE_KEY, provider, keyId),
    test: (provider: ProviderId): Promise<ApiKeyTestResult> => ipcRenderer.invoke(IPC.PROVIDERS_TEST, provider),
    connect: (provider: ProviderId, options?: { reconsent?: boolean }): Promise<ActionResult> =>
      ipcRenderer.invoke(IPC.PROVIDERS_CONNECT, provider, options),
    cancelConnect: (provider: ProviderId): Promise<ActionResult> => ipcRenderer.invoke(IPC.PROVIDERS_CANCEL_CONNECT, provider),
    disconnect: (provider: ProviderId): Promise<ActionResult> => ipcRenderer.invoke(IPC.PROVIDERS_DISCONNECT, provider),
    refreshModels: (provider: ProviderId): Promise<ActionResult> => ipcRenderer.invoke(IPC.PROVIDERS_REFRESH_MODELS, provider),
    refreshUsage: (provider?: ProviderId): Promise<ActionResult> => ipcRenderer.invoke(IPC.PROVIDERS_REFRESH_USAGE, provider),
    openManageUsage: (provider: ProviderId): Promise<ActionResult> =>
      ipcRenderer.invoke(IPC.PROVIDERS_OPEN_MANAGE_USAGE, provider),
    activitySummary: (): Promise<ActivitySummary> => ipcRenderer.invoke(IPC.ACTIVITY_SUMMARY),
    onChanged: (cb: (states: ProviderPublicState[]) => void): Unsubscribe => {
      const listener = (_e: unknown, states: ProviderPublicState[]): void => cb(states)
      ipcRenderer.on(IPC.ON_PROVIDERS_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC.ON_PROVIDERS_CHANGED, listener)
    }
  },
  folders: {
    list: (): Promise<Folder[]> => ipcRenderer.invoke(IPC.FOLDERS_LIST),
    create: (name: string): Promise<FolderResponse> => ipcRenderer.invoke(IPC.FOLDERS_CREATE, name),
    rename: (id: string, name: string): Promise<FolderResponse> => ipcRenderer.invoke(IPC.FOLDERS_RENAME, id, name),
    /** Mode "unfile" (default): the notes stay, without a folder. "trash": the notes of the folder go to the trash too. */
    remove: (id: string, mode: 'unfile' | 'trash'): Promise<{ ok: boolean; folders: Folder[]; trashed: string[]; unfiled: string[] }> =>
      ipcRenderer.invoke(IPC.FOLDERS_DELETE, id, mode),
    onChanged: (cb: (folders: Folder[]) => void): Unsubscribe => {
      const listener = (_e: unknown, folders: Folder[]): void => cb(folders)
      ipcRenderer.on(IPC.ON_FOLDERS_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC.ON_FOLDERS_CHANGED, listener)
    }
  },
  ocr: {
    /** Captures waiting / being recognized in the background. */
    getState: (): Promise<OcrQueueState> => ipcRenderer.invoke(IPC.OCR_QUEUE_STATE),
    /** "Повторить" on a fragment that could not be recognized. */
    retryJob: (jobId: string): Promise<boolean> => ipcRenderer.invoke(IPC.OCR_RETRY_JOB, jobId),
    retryFailed: (): Promise<number> => ipcRenderer.invoke(IPC.OCR_RETRY_FAILED),
    cancelJob: (jobId: string): Promise<boolean> => ipcRenderer.invoke(IPC.OCR_CANCEL_JOB, jobId),
    onState: (cb: (state: OcrQueueState) => void): Unsubscribe => {
      const listener = (_e: unknown, state: OcrQueueState): void => cb(state)
      ipcRenderer.on(IPC.ON_OCR_QUEUE, listener)
      return () => ipcRenderer.removeListener(IPC.ON_OCR_QUEUE, listener)
    }
  },
  capture: {
    repeat: (): Promise<void> => ipcRenderer.invoke(IPC.CAPTURE_REPEAT),
    ocrClipboard: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke(IPC.CAPTURE_CLIPBOARD),
    undoLast: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.CAPTURE_UNDO_LAST)
  },
  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke(IPC.CLIPBOARD_READ_TEXT)
  },
  window: {
    setAlwaysOnTop: (on: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_SET_ALWAYS_ON_TOP, on),
    getState: (): Promise<{ alwaysOnTop: boolean }> => ipcRenderer.invoke(IPC.WINDOW_GET_STATE),
    close: (): void => ipcRenderer.send(IPC.WINDOW_CLOSE_SELF)
  },
  quick: {
    save: (title: string, text: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.QUICK_SAVE, title, text),
    close: (): void => ipcRenderer.send(IPC.QUICK_CLOSE),
    onReset: (cb: () => void): Unsubscribe => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.ON_QUICK_RESET, listener)
      return () => ipcRenderer.removeListener(IPC.ON_QUICK_RESET, listener)
    }
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_GET_VERSION),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.APP_OPEN_EXTERNAL, url),
    /** Opens http(s) / mailto / tel links in the system's default app. */
    openLink: (url: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.APP_OPEN_LINK, url),
    /** The app is quitting: save pending edits, then call `flushed`. */
    onFlush: (cb: () => void): Unsubscribe => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.APP_FLUSH, listener)
      return () => ipcRenderer.removeListener(IPC.APP_FLUSH, listener)
    },
    flushed: (): void => ipcRenderer.send(IPC.APP_FLUSHED),
    checkForUpdates: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke(IPC.APP_CHECK_FOR_UPDATES),
    installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.APP_INSTALL_UPDATE),
    captureDocument: (): Promise<void> => ipcRenderer.invoke(IPC.APP_CAPTURE_DOCUMENT),
    onUpdateAvailable: (cb: (version: string) => void): Unsubscribe => {
      const listener = (_e: unknown, version: string): void => cb(version)
      ipcRenderer.on(IPC.ON_UPDATE_AVAILABLE, listener)
      return () => ipcRenderer.removeListener(IPC.ON_UPDATE_AVAILABLE, listener)
    },
    onUpdateReady: (cb: (version: string) => void): Unsubscribe => {
      const listener = (_e: unknown, version: string): void => cb(version)
      ipcRenderer.on(IPC.ON_UPDATE_READY, listener)
      return () => ipcRenderer.removeListener(IPC.ON_UPDATE_READY, listener)
    }
  },
  toast: {
    onToast: (cb: (payload: ToastPayload) => void): Unsubscribe => {
      const listener = (_e: unknown, payload: ToastPayload): void => cb(payload)
      ipcRenderer.on(IPC.ON_TOAST, listener)
      return () => ipcRenderer.removeListener(IPC.ON_TOAST, listener)
    }
  },
  navigation: {
    onNavigate: (cb: (payload: NavigatePayload) => void): Unsubscribe => {
      const listener = (_e: unknown, payload: NavigatePayload): void => cb(payload)
      ipcRenderer.on(IPC.ON_NAVIGATE, listener)
      return () => ipcRenderer.removeListener(IPC.ON_NAVIGATE, listener)
    }
  },
  overlay: {
    ready: (): void => ipcRenderer.send(IPC.OVERLAY_READY),
    onImage: (cb: (dataUrl: string) => void): Unsubscribe => {
      const listener = (_e: unknown, dataUrl: string): void => cb(dataUrl)
      ipcRenderer.on(IPC.OVERLAY_IMAGE, listener)
      return () => ipcRenderer.removeListener(IPC.OVERLAY_IMAGE, listener)
    },
    selectRegion: (rect: OverlayRect): Promise<void> => ipcRenderer.invoke(IPC.OVERLAY_SELECTION, rect),
    cancel: (): Promise<void> => ipcRenderer.invoke(IPC.OVERLAY_CANCEL),
    onMode: (cb: (mode: { session?: { count: number } }) => void): Unsubscribe => {
      const listener = (_e: unknown, mode: { session?: { count: number } }): void => cb(mode ?? {})
      ipcRenderer.on(IPC.OVERLAY_MODE, listener)
      return () => ipcRenderer.removeListener(IPC.OVERLAY_MODE, listener)
    },
    /** Enter / Esc during a Capture Session. */
    finishSession: (): void => ipcRenderer.send(IPC.OVERLAY_FINISH_SESSION)
  },
  hud: {
    ready: (): void => ipcRenderer.send(IPC.HUD_READY),
    onState: (cb: (state: HudState) => void): Unsubscribe => {
      const listener = (_e: unknown, state: HudState): void => cb(state)
      ipcRenderer.on(IPC.HUD_STATE, listener)
      return () => ipcRenderer.removeListener(IPC.HUD_STATE, listener)
    },
    action: (action: HudAction): void => ipcRenderer.send(IPC.HUD_ACTION, action)
  }
}

export type SnapNotesApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
