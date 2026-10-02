import { DEFAULT_AI_SETTINGS, type AiSettings, type ApiKeyProviderId } from './providers'
import type { Block, OcrSource } from './blocks'
import type { NoteColor } from './noteMeta'
import type { SortOrder } from './noteList'

export interface Note {
  id: string
  title: string
  /**
   * Editor HTML. Kept in every v2 file too: the editor still edits HTML, and older app versions
   * (≤1.3.1) can still open the note. `blocks` is always derived from / consistent with it.
   */
  body: string
  emoji: string | null
  /** Pinned notes are shown above all others, whatever the sort order. */
  pinned: boolean
  /** Favorites are a collection (filter), unrelated to pinning/order. */
  favorite: boolean
  /** Semantic colour id; the actual colours live in the theme tokens (light/dark). */
  color: NoteColor
  /** Normalized lowercase tags without "#". */
  tags: string[]
  /** Folder the note is in; null = no folder (shown in All notes only). */
  folderId: string | null
  /** Created by a capture / quick note, not by the user: empty ones are cleaned up when left. */
  autoCreated?: boolean
  /** The user typed the title: it is never replaced automatically again. */
  titleManual?: boolean
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
  /** Small floating window to jot a note down over any app. Optional: '' = off. */
  quickNote: string
  /** Capture the same screen area again. Optional: '' = off. */
  repeatCapture: string
  /** Recognize the image currently in the clipboard. Optional: '' = off. */
  ocrClipboard: string
  /** Show Snap Notes with the search palette open. Optional: '' = off. */
  globalSearch: string
}

export type HotkeyKind = keyof HotkeyConfig

/** Hotkeys that may be left empty (disabled). The capture hotkeys are required. */
export const OPTIONAL_HOTKEYS: HotkeyKind[] = ['copyForAi', 'openApp', 'session', 'quickNote', 'repeatCapture', 'ocrClipboard', 'globalSearch']

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

export const EMPTY_PROVIDER_KEYS: ProviderKeyRefs = {
  gemini: [],
  groq: [],
  openai: [],
  anthropic: [],
  openrouter: [],
  mistral: [],
  cerebras: [],
  cloudflare: [],
  nvidia: [],
  cohere: [],
  huggingface: [],
  modal: []
}

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
  /** Notes list order inside the pinned / other groups. */
  sortOrder: SortOrder
  cardSize: CardSize
  compactGrid: boolean
  /** Narrow windows turn the sidebar into a drawer (off: keep it docked). */
  autoCollapseSidebar: boolean
  restoreLastNote: boolean
  lastNoteId: string | null
  /** Offer OCR when a new image appears in the clipboard. */
  suggestClipboardOcr: boolean
  ocrFeedback: OcrFeedback
  /** Background OCR queue: off = captures are kept but not recognized until it is turned on. */
  ocrQueueEnabled: boolean
  /** Captures recognized at the same time (1–3). Results are still written in capture order. */
  ocrMaxConcurrent: number
  /** Remove runaway AI repetition and the overlap between two consecutive captures (the screenshot is kept). */
  ocrTrimRepeats: boolean
  /** '' = the app's default font. */
  editorFontFamily: string
  editorFontSize: number
  /** Window geometry (internal; restored on start and validated against the connected screens). */
  windowState: SavedWindowState | null
  floatingState: SavedWindowState | null
  floatingOnTop: boolean
  quickNoteState: SavedWindowState | null
}

export type CardSize = 'small' | 'medium' | 'large'
export type OcrFeedback = 'none' | 'visual' | 'sound'

export interface SavedWindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

export const DEFAULT_HOTKEYS: HotkeyConfig = {
  region: 'Control+Shift+S',
  fullscreen: 'Control+Shift+F',
  document: 'Control+Shift+D',
  longScreenshot: 'Control+Shift+L',
  // Ctrl+Shift+C is Chrome/Edge DevTools "inspect element" — a global hotkey would take it from browsers.
  copyForAi: 'Control+Alt+C',
  openApp: 'Control+Alt+N',
  session: 'Control+Alt+S',
  quickNote: 'Control+Alt+Q',
  // Ctrl+Shift+R is "hard reload" in browsers; Alt keeps that shortcut free.
  repeatCapture: 'Control+Alt+R',
  ocrClipboard: 'Control+Alt+O',
  globalSearch: 'Control+Alt+K'
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
  lastSeenVersion: '',
  sortOrder: 'modified',
  cardSize: 'medium',
  compactGrid: false,
  autoCollapseSidebar: true,
  restoreLastNote: true,
  lastNoteId: null,
  suggestClipboardOcr: false,
  ocrFeedback: 'visual',
  ocrQueueEnabled: true,
  ocrMaxConcurrent: 1,
  ocrTrimRepeats: true,
  editorFontFamily: '',
  editorFontSize: 14,
  windowState: null,
  floatingState: null,
  floatingOnTop: false,
  quickNoteState: null
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
