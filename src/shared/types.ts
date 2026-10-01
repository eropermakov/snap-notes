import { DEFAULT_AI_SETTINGS, type AiSettings, type ApiKeyProviderId } from './providers'
import type { Block, OcrSource } from './blocks'

export interface Note {
  id: string
  title: string
  /**
   * Editor HTML. Kept in every v2 file too: the editor still edits HTML, and older app versions
   * (≤1.3.1) can still open the note. `blocks` is always derived from / consistent with it.
   */
  body: string
  emoji: string | null
  pinned: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** Note format version; 2 = block model. Missing on notes that were never migrated. */
  version?: number
  blocks?: Block[]
  /** OCR captures referenced by blocks' sourceId (original screenshot, app, window, method). */
  sources?: Record<string, OcrSource>
}

export interface HotkeyConfig {
  /** Capture to Note (current note, or a new one when none is open). */
  region: string
  fullscreen: string
  /** Capture to New Note (formerly "Документ из скриншота"). */
  document: string
  /** Scrolling capture (start/stop). */
  longScreenshot: string
  /** Copy the current note as Markdown for AI chats. Optional: '' = off. */
  copyForAi: string
  /** Show the Snap Notes window. Optional: '' = off. */
  openApp: string
  /** Start / finish a Capture Session (several captures into one note). Optional: '' = off. */
  session: string
}

export type HotkeyKind = keyof HotkeyConfig

/** Hotkeys that may be left empty (disabled). The capture hotkeys are required. */
export const OPTIONAL_HOTKEYS: HotkeyKind[] = ['copyForAi', 'openApp', 'session']

/** What Capture to Note does when no note is open. */
export type NoNoteBehavior = 'new' | 'ask'

export type AiProvider = 'gemini' | 'groq' | 'local'

/**
 * Legacy (≤1.3.1) key entry. Since 1.4 keys live in OS-encrypted storage and settings keep only
 * ProviderKeyRef; an entry remains here only if moving it to secure storage failed.
 */
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

/** Reference to a secret in secure storage. Never contains the key itself. */
export interface ProviderKeyRef {
  id: string
  label: string
}

export type ProviderKeyRefs = Record<ApiKeyProviderId, ProviderKeyRef[]>

export const EMPTY_PROVIDER_KEYS: ProviderKeyRefs = { gemini: [], groq: [], openai: [], anthropic: [] }

export interface AppSettings {
  /** Legacy plaintext keys awaiting migration. Main process only; always [] in the renderer. */
  aiKeys: AiKeyEntry[]
  ai: AiSettings
  providerKeys: ProviderKeyRefs
  ocrPreset: OcrPreset
  theme: ThemeId
  hotkeys: HotkeyConfig
  /** Capture to Note with no open note: create one (fastest, default) or ask. */
  captureNoNote: NoNoteBehavior
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
  longScreenshot: 'Control+Shift+L',
  // Ctrl+Shift+C is Chrome/Edge DevTools "inspect element" — a global hotkey would take it from browsers.
  copyForAi: 'Control+Alt+C',
  openApp: 'Control+Alt+N',
  session: 'Control+Alt+S'
}

export const DEFAULT_SETTINGS: AppSettings = {
  aiKeys: [],
  ai: DEFAULT_AI_SETTINGS,
  providerKeys: EMPTY_PROVIDER_KEYS,
  ocrPreset: 'asis',
  theme: 'green-light',
  hotkeys: DEFAULT_HOTKEYS,
  captureNoNote: 'new',
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

export type HotkeyRegistrationResult = Record<HotkeyKind, { ok: boolean; error?: string }>

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
