import type { AccentColor, ThemeId, ThemeMode } from './types'

export interface ThemeInfo {
  id: ThemeId
  color: AccentColor
  mode: ThemeMode
  label: string
  swatch: string
}

const ACCENT_LABELS: Record<AccentColor, string> = {
  green: 'Зелёная',
  red: 'Красная',
  blue: 'Синяя',
  yellow: 'Жёлтая'
}

const ACCENT_SWATCH: Record<AccentColor, string> = {
  green: '#1E8E3E',
  red: '#D93025',
  blue: '#1A73E8',
  yellow: '#E3A008'
}

export const ACCENT_OPTIONS: { color: AccentColor; label: string; swatch: string }[] = (
  ['green', 'red', 'blue', 'yellow'] as AccentColor[]
).map((color) => ({ color, label: ACCENT_LABELS[color], swatch: ACCENT_SWATCH[color] }))

export function composeTheme(color: AccentColor, mode: ThemeMode): ThemeId {
  return `${color}-${mode}` as ThemeId
}

const ACCENT_COLORS: AccentColor[] = ['green', 'red', 'blue', 'yellow']
const MODES: ThemeMode[] = ['light', 'dark']

export const THEMES: ThemeInfo[] = ACCENT_COLORS.flatMap((color) =>
  MODES.map((mode) => ({
    id: `${color}-${mode}` as ThemeId,
    color,
    mode,
    label: `${ACCENT_LABELS[color]} · ${mode === 'light' ? 'светлая' : 'тёмная'}`,
    swatch: ACCENT_SWATCH[color]
  }))
)

export function getThemeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
