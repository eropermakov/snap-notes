import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

/**
 * Dark theme contrast guard. Parses the real tokens from index.css, so a future edit that makes the
 * dark theme murky again fails here instead of in a screenshot review.
 */
const CSS = readFileSync(path.resolve(__dirname, '../../src/renderer/src/styles/index.css'), 'utf-8')

function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`block not found: ${selector}`)
  return CSS.slice(start, CSS.indexOf('\n}', start))
}

function tokens(selector: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of block(selector).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[match[1]] = match[2].replace(/\/\*.*?\*\//g, '').trim()
  return out
}

type Rgb = [number, number, number]
const hex = (value: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(value)
  if (!m) throw new Error(`not a hex colour: ${value}`)
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as Rgb
}

/** "#rrggbb" or "rgba(r,g,b,a)" painted over `under`. */
function resolve(value: string, under: Rgb): Rgb {
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value)
  if (!rgba) return hex(value)
  const a = Number(rgba[4])
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])].map((c, i) => Math.round(c * a + under[i] * (1 - a))) as Rgb
}

const luminance = ([r, g, b]: Rgb): number => {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const dark = tokens("[data-theme$='-dark']")
const light = tokens("[data-theme$='-light']")

/** Every surface text can sit on. Overlay tokens (hover/active) are composited on the card surface. */
const card = hex(dark['--surface-1'])
const SURFACES: Record<string, Rgb> = {
  'app background': hex(dark['--bg-primary']),
  rail: hex(dark['--bg-secondary']),
  card: card,
  'raised / hovered card': hex(dark['--surface-2']),
  selected: hex(dark['--surface-selected']),
  elevated: hex(dark['--surface-elevated']),
  input: hex(dark['--input-bg']),
  'hover row': resolve(dark['--surface-hover'], card),
  'active row': resolve(dark['--surface-active'], card)
}

describe('dark theme contrast (WCAG)', () => {
  it('primary text is AAA (>= 7:1) on every surface', () => {
    for (const [name, surface] of Object.entries(SURFACES)) {
      expect(contrast(hex(dark['--text-primary']), surface), name).toBeGreaterThanOrEqual(7)
    }
  })

  it('secondary text is AA (>= 4.5:1) on every surface', () => {
    for (const [name, surface] of Object.entries(SURFACES)) {
      expect(contrast(hex(dark['--text-secondary']), surface), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('muted text (placeholders, meta) is AA (>= 4.5:1) on every surface', () => {
    for (const [name, surface] of Object.entries(SURFACES)) {
      expect(contrast(hex(dark['--text-muted']), surface), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('links, status colours and every accent are readable on cards and the app background', () => {
    const accents = [...CSS.matchAll(/\[data-theme='(\w+)-dark'\] \{ --accent: (#[0-9a-f]{6}); --accent-hover: (#[0-9a-f]{6}); --accent-contrast: (#[0-9a-f]{6}); \}/gi)]
    expect(accents).toHaveLength(4)
    const readable = [dark['--link'], dark['--success'], dark['--warning'], dark['--danger'], ...accents.map((a) => a[2]), ...accents.map((a) => a[3])]
    for (const colour of readable) {
      for (const name of ['app background', 'card', 'raised / hovered card']) {
        expect(contrast(hex(colour), SURFACES[name]), `${colour} on ${name}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    // Text on a filled accent button.
    for (const a of accents) expect(contrast(hex(a[4]), hex(a[2])), `${a[1]} button`).toBeGreaterThanOrEqual(4.5)
  })

  it('input and checkbox boundaries are visible: >= 3:1 against every surface they sit on', () => {
    for (const name of ['app background', 'card', 'input', 'raised / hovered card']) {
      expect(contrast(hex(dark['--border-input']), SURFACES[name]), name).toBeGreaterThanOrEqual(3)
    }
  })

  it('surfaces form a visible ladder: app < card < raised < selected', () => {
    const l = (name: string): number => luminance(SURFACES[name])
    expect(l('app background')).toBeLessThan(l('card'))
    expect(l('card')).toBeLessThan(l('raised / hovered card'))
    expect(l('raised / hovered card')).toBeLessThan(l('selected'))
    expect(contrast(SURFACES.card, SURFACES['app background'])).toBeGreaterThanOrEqual(1.1)
    expect(contrast(SURFACES['raised / hovered card'], SURFACES.card)).toBeGreaterThanOrEqual(1.08)
    expect(contrast(SURFACES.selected, SURFACES['raised / hovered card'])).toBeGreaterThanOrEqual(1.05)
  })

  it('cards have an explicit but quiet border, and it gets stronger on hover', () => {
    const border = contrast(hex(dark['--border-card']), SURFACES['app background'])
    expect(border).toBeGreaterThanOrEqual(1.5)
    expect(border).toBeLessThan(3) // not a glowing frame
    expect(contrast(hex(dark['--border-strong']), SURFACES['app background'])).toBeGreaterThan(border)
  })

  it('is cool dark grey, not an OLED-black interface', () => {
    for (const name of ['app background', 'rail', 'card']) {
      expect(Math.max(...SURFACES[name]), name).toBeGreaterThanOrEqual(0x0c)
    }
    expect(luminance(SURFACES['app background'])).toBeGreaterThan(0.003)
  })

  it('keeps every accent colour of the app (brand colours unchanged)', () => {
    expect(CSS).toContain("[data-theme='green-dark'] { --accent: #6dd58c;")
    expect(CSS).toContain("[data-theme='blue-dark'] { --accent: #8ab4f8;")
    expect(CSS).toContain("[data-theme='red-dark'] { --accent: #f2877e;")
    expect(CSS).toContain("[data-theme='yellow-dark'] { --accent: #fdd663;")
  })

  it('focus is a solid accent ring in the dark theme', () => {
    expect(CSS).toMatch(/\[data-theme\$='-dark'\] \{\s*--border-focus: var\(--accent\);\s*--focus-outline: var\(--accent\);/)
    expect(CSS).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--focus-outline\);/)
  })
})

describe('light theme is untouched', () => {
  it('keeps its original core values', () => {
    expect(light['--bg-primary']).toBe('#ffffff')
    expect(light['--surface-1']).toBe('#fafaf9')
    expect(light['--text-primary']).toBe('#1b1c1b')
    expect(light['--text-secondary']).toBe('#5c5f5c')
    expect(light['--border-subtle']).toBe('rgba(20, 22, 20, 0.07)')
  })

  it('new tokens alias the existing light values, so shared components look the same', () => {
    expect(light['--border-card']).toBe('var(--border-subtle)')
    expect(light['--border-input']).toBe('var(--border-subtle)')
    expect(light['--border-strong']).toBe('var(--border-normal)')
    expect(light['--input-bg']).toBe('var(--surface-2)')
    expect(light['--surface-selected']).toBe('var(--surface-2)')
    expect(light['--toggle-off']).toBe('var(--border-normal)')
    // A transparent shadow is visually empty and valid inside a comma-separated glow stack.
    expect(light['--shadow-card']).toBe('0 0 0 transparent')
  })
})
