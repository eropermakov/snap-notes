import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { NOTE_COLORS } from '../../src/shared/noteMeta'

/**
 * Note colours are semantic ids; the real colours live once for light and once for dark in index.css.
 * Text on a coloured card must stay as readable as on an uncoloured one, in both themes.
 */
const CSS = readFileSync(path.resolve(__dirname, '../../src/renderer/src/styles/index.css'), 'utf-8')

function tokensOf(selector: string): Record<string, string> {
  // The selector appears in several blocks (base tokens, note colours): merge them all.
  const out: Record<string, string> = {}
  let from = 0
  for (;;) {
    const start = CSS.indexOf(`${selector} {`, from)
    if (start === -1) break
    const end = CSS.indexOf('\n}', start)
    for (const m of CSS.slice(start, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
    from = end
  }
  if (Object.keys(out).length === 0) throw new Error(`block not found: ${selector}`)
  return out
}

type Rgb = [number, number, number]
const hex = (v: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(v)
  if (!m) throw new Error(`not a hex colour: ${v}`)
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as Rgb
}
const lum = ([r, g, b]: Rgb): number => {
  const [lr, lg, lb] = [r, g, b].map((x) => {
    const c = x / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const THEMES = { light: tokensOf("[data-theme$='-light']"), dark: tokensOf("[data-theme$='-dark']") }
const COLORS = NOTE_COLORS.filter((c) => c !== 'default')

describe('note colours', () => {
  it('every colour has a light and a dark variant (background + border)', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const color of COLORS) {
        expect(THEMES[theme][`--note-${color}-bg`], `${theme} ${color} bg`).toMatch(/^#[0-9a-f]{6}$/i)
        expect(THEMES[theme][`--note-${color}-border`], `${theme} ${color} border`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('has a CSS class for every semantic id, so the note stores an id and never a hex value', () => {
    for (const color of COLORS) {
      expect(CSS).toContain(`.note-color-${color} {`)
      expect(CSS).toContain(`.swatch-${color} {`)
    }
  })

  it('primary and secondary text stay readable on every coloured card', () => {
    for (const theme of ['light', 'dark'] as const) {
      const text = hex(THEMES[theme]['--text-primary'])
      const secondary = hex(THEMES[theme]['--text-secondary'])
      // On a tinted card the muted text token is replaced by the secondary one (see .note-card in index.css).
      for (const color of COLORS) {
        const bg = hex(THEMES[theme][`--note-${color}-bg`])
        expect(contrast(text, bg), `${theme} ${color} primary`).toBeGreaterThanOrEqual(7)
        expect(contrast(secondary, bg), `${theme} ${color} secondary`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('dates and tags on a tinted card use the stronger secondary text colour', () => {
    expect(CSS).toMatch(/\.note-card\[class\*='note-color-'\]\s*\{\s*--text-muted:\s*var\(--text-secondary\)/)
  })

  it('colours are calm pastels: light fills stay very light, dark fills stay very dark', () => {
    for (const color of COLORS) {
      expect(lum(hex(THEMES.light[`--note-${color}-bg`])), `light ${color}`).toBeGreaterThanOrEqual(0.7)
      expect(lum(hex(THEMES.dark[`--note-${color}-bg`])), `dark ${color}`).toBeLessThanOrEqual(0.05)
    }
  })
})
