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
  green: '#34A853',
  red: '#EA4335',
  blue: '#4285F4',
  yellow: '#F9AB00'
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
