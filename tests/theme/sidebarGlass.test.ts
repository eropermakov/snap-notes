import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

/**
 * Glass sidebar guard: reads the real `sidebar.*` tokens from index.css and checks that text stays readable
 * on the translucent surface over the worst backdrop (WCAG AA), that the blur stays in the calm range, that the
 * solid fallbacks exist, and that components don't carry inline colours.
 */
const ROOT = path.resolve(__dirname, '../..')
const CSS = readFileSync(path.resolve(ROOT, 'src/renderer/src/styles/index.css'), 'utf-8')
const GLASS = CSS.slice(CSS.indexOf('Glass sidebar'), CSS.indexOf('@layer base'))

type Rgba = [number, number, number, number]

function tokensOf(selector: string): Record<string, string> {
  const start = GLASS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`block not found: ${selector}`)
  const body = GLASS.slice(start, GLASS.indexOf('\n}', start))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value)
  if (!rgba) throw new Error(`unsupported colour: ${value}`)
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])]
}

/** `over` painted on the opaque `under`. */
const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => Math.round(top[i] * top[3] + under[i] * (1 - top[3]))).concat(1) as Rgba

const luminance = ([r, g, b]: Rgba): number => {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}
const contrast = (a: Rgba, b: Rgba): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const THEMES = {
  light: { tokens: tokensOf("[data-theme$='-light']"), extremes: ['#ffffff', '#000000', '#eef0f2'] },
  dark: { tokens: tokensOf("[data-theme$='-dark']"), extremes: ['#ffffff', '#000000', '#0b0d10'] }
} as const

describe.each(Object.entries(THEMES))('glass sidebar tokens (%s)', (_name, { tokens, extremes }) => {
  // Whatever the blur lets through, the surface is the translucent layer over it. The worst case for text is the
  // backdrop that is closest to the text colour: pure white behind dark text is not realistic (the backdrop is the
  // app background), but black/white are checked as extremes with the AA bar for large text (3:1).
  const surfaces = (): Rgba[] => {
    const top = parse(tokens['--sidebar-bg-top'])
    const bottom = parse(tokens['--sidebar-bg-bottom'])
    return [top, bottom].flatMap((layer) => extremes.map((e) => over(layer, parse(e))))
  }

  it('blur radius is a calm 14–24px', () => {
    const px = Number(/^(\d+)px$/.exec(tokens['--sidebar-blur'])?.[1])
    expect(px).toBeGreaterThanOrEqual(14)
    expect(px).toBeLessThanOrEqual(24)
  })

  it('body text meets AA on the real app background', () => {
    const real = parse(tokens['--app-bg'])
    for (const layer of [tokens['--sidebar-bg-top'], tokens['--sidebar-bg-bottom']]) {
      const surface = over(parse(layer), real)
      for (const key of ['--sidebar-text', '--sidebar-text-secondary', '--sidebar-text-muted', '--sidebar-icon']) {
        const text = over(parse(tokens[key]), surface)
        expect(contrast(text, surface), `${key} on ${layer}`).toBeGreaterThanOrEqual(key === '--sidebar-icon' ? 3 : 4.5)
      }
    }
  })

  it('stays readable (3:1) even over extreme backdrops', () => {
    for (const surface of surfaces()) {
      const text = over(parse(tokens['--sidebar-text']), surface)
      expect(contrast(text, surface)).toBeGreaterThanOrEqual(3)
    }
  })

  it('hover and active fills keep text readable', () => {
    const surface = over(parse(tokens['--sidebar-bg']), parse(tokens['--app-bg']))
    for (const fill of ['--sidebar-item-hover', '--sidebar-item-active']) {
      const row = over(parse(tokens[fill]), surface)
      for (const key of ['--sidebar-text', '--sidebar-text-secondary', '--sidebar-text-muted']) {
        const text = over(parse(tokens[key]), row)
        expect(contrast(text, row), `${key} on ${fill}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('has an opaque fallback colour and a more opaque drawer layer', () => {
    expect(parse(tokens['--sidebar-bg-solid'])[3]).toBe(1)
    expect(parse(tokens['--sidebar-bg-drawer'])[3]).toBeGreaterThan(parse(tokens['--sidebar-bg'])[3])
  })
})

describe('glass sidebar behaviour', () => {
  it('applies the blur once, on the container', () => {
    expect(GLASS.match(/^\s+(?:-webkit-)?backdrop-filter:\s*blur\(var/gm)).toHaveLength(2) // prefixed + standard on .glass-sidebar
  })

  it('falls back to a solid surface without backdrop-filter and with reduced transparency', () => {
    expect(GLASS).toContain('@supports not')
    expect(GLASS).toContain('prefers-reduced-transparency: reduce')
    expect(GLASS).toMatch(/var\(--sidebar-bg-solid\)/)
  })

  it('animations stay within 120–220ms', () => {
    const shell = readFileSync(path.resolve(ROOT, 'src/renderer/src/ui/Shell.tsx'), 'utf-8')
    for (const m of shell.matchAll(/duration:\s*([\d.]+)/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(0.12)
      expect(Number(m[1])).toBeLessThanOrEqual(0.22)
    }
  })

  it('sidebar components use tokens, not inline colours', () => {
    for (const file of ['ui/Shell.tsx', 'components/notes/NotesSidebar.tsx', 'components/notes/FolderDialogs.tsx']) {
      const src = readFileSync(path.resolve(ROOT, 'src/renderer/src', file), 'utf-8')
      expect(src, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    }
  })
})
