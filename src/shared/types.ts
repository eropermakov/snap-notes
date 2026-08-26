export interface Note {
  id: string
  title: string
  body: string
  emoji: string | null
  pinned: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface HotkeyConfig {
  region: string
  fullscreen: string
  document: string
  longScreenshot: string
}

export type AiProvider = 'gemini' | 'groq' | 'local'

export interface AiKeyEntry {
  id: string
  provider: AiProvider
  label: string
  apiKey: string
}

export type OcrPreset = 'asis' | 'formal' | 'casual' | 'structured'

export type AccentColor = 'green' | 'red' | 'blue' | 'yellow'
export type ThemeMode = 'light' | 'dark'
export type ThemeId = `${AccentColor}-${ThemeMode}`

export interface AppSettings {
  aiKeys: AiKeyEntry[]
  ocrPreset: OcrPreset
  theme: ThemeId
  hotkeys: HotkeyConfig
  launchAtStartup: boolean
  minimizeToTray: boolean
  onboardingComplete: boolean
  screenshotCacheEnabled: boolean
  screenshotCacheRetentionHours: number
  trashRetentionDays: number
  useHybridPipeline: boolean
  lastSeenVersion: string
}

export const DEFAULT_HOTKEYS: HotkeyConfig = {
  region: 'Control+Shift+S',
  fullscreen: 'Control+Shift+F',
  document: 'Control+Shift+D',
  longScreenshot: 'Control+Shift+L'
}

export const DEFAULT_SETTINGS: AppSettings = {
  aiKeys: [],
  ocrPreset: 'asis',
  theme: 'green-light',
  hotkeys: DEFAULT_HOTKEYS,
  launchAtStartup: false,
  minimizeToTray: true,
  onboardingComplete: false,
  screenshotCacheEnabled: true,
  screenshotCacheRetentionHours: 24,
  trashRetentionDays: 30,
  useHybridPipeline: false,
  lastSeenVersion: ''
}

export type ToastType = 'success' | 'warning' | 'error'

export interface ToastPayload {
  id: string
  type: ToastType
  message: string
}

export interface HotkeyRegistrationResult {
  region: { ok: boolean; error?: string }
  fullscreen: { ok: boolean; error?: string }
  document: { ok: boolean; error?: string }
  longScreenshot: { ok: boolean; error?: string }
}

export interface ApiKeyTestResult {
  ok: boolean
  message: string
}

export interface DataFolderInfo {
  path: string
}

export interface ExportResult {
  ok: boolean
  canceled?: boolean
  path?: string
  message?: string
}

export interface ResetResult {
  ok: boolean
  message?: string
}

export interface StorageStats {
  notesBytes: number
  notesCount: number
  totalCharacters: number
  screenshotCacheBytes: number
  screenshotCacheCount: number
}
