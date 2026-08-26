import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc'
import type {
  AiProvider,
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

interface OpenFolderResponse {
  ok: boolean
  message?: string
}

interface NavigatePayload {
  view: string
  noteId?: string
}

interface OverlayRect {
  x: number
  y: number
  width: number
  height: number
}

const api = {
  notes: {
    list: (): Promise<Note[]> => ipcRenderer.invoke(IPC.NOTES_LIST),
    create: (): Promise<Note> => ipcRenderer.invoke(IPC.NOTES_CREATE),
    update: (id: string, patch: Partial<Note>): Promise<Note | null> =>
      ipcRenderer.invoke(IPC.NOTES_UPDATE, id, patch),
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
    emptyTrash: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.NOTES_EMPTY_TRASH)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    update: (patch: Partial<AppSettings>): Promise<SettingsUpdateResponse> =>
      ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch),
    testApiKey: (provider: AiProvider, apiKey: string): Promise<ApiKeyTestResult> =>
      ipcRenderer.invoke(IPC.SETTINGS_TEST_API_KEY, provider, apiKey),
    getDataPath: (): Promise<string> => ipcRenderer.invoke(IPC.SETTINGS_GET_DATA_PATH),
    openDataFolder: (): Promise<OpenFolderResponse> => ipcRenderer.invoke(IPC.SETTINGS_OPEN_DATA_FOLDER),
    exportNotes: (): Promise<ExportResult> => ipcRenderer.invoke(IPC.SETTINGS_EXPORT_NOTES),
    exportNotesDocx: (): Promise<ExportResult> => ipcRenderer.invoke(IPC.SETTINGS_EXPORT_NOTES_DOCX),
    resetAll: (): Promise<ResetAllResponse> => ipcRenderer.invoke(IPC.SETTINGS_RESET_ALL),
    getStorageStats: (): Promise<StorageStats> => ipcRenderer.invoke(IPC.SETTINGS_GET_STORAGE_STATS),
    getUsage: (): Promise<Record<string, number>> => ipcRenderer.invoke(IPC.SETTINGS_GET_USAGE),
    clearScreenshotCache: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.SETTINGS_CLEAR_SCREENSHOT_CACHE)
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_GET_VERSION),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.APP_OPEN_EXTERNAL, url),
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
    cancel: (): Promise<void> => ipcRenderer.invoke(IPC.OVERLAY_CANCEL)
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
