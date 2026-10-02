import type { HotkeyConfig, HotkeyKind } from './types'

/** Normalizes an accelerator for comparison ("ctrl + shift+s" == "Control+Shift+S"). */
export function normalizeAccelerator(value: string): string {
  const parts = value
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .map((p) => (p === 'ctrl' || p === 'commandorcontrol' || p === 'cmdorctrl' ? 'control' : p === 'option' ? 'alt' : p === 'esc' ? 'escape' : p))
  const key = parts.pop() ?? ''
  const modifiers = [...new Set(parts)].sort()
  return [...modifiers, key].join('+')
}

/** Hotkeys that share a combination: kind → the other kind it clashes with. */
export function findHotkeyConflicts(hotkeys: HotkeyConfig, kinds: HotkeyKind[]): Partial<Record<HotkeyKind, HotkeyKind>> {
  const conflicts: Partial<Record<HotkeyKind, HotkeyKind>> = {}
  const owner = new Map<string, HotkeyKind>()
  for (const kind of kinds) {
    const value = normalizeAccelerator(hotkeys[kind] ?? '')
    if (!value) continue
    const first = owner.get(value)
    if (first) {
      conflicts[kind] = first
      conflicts[first] = kind
    } else {
      owner.set(value, kind)
    }
  }
  return conflicts
}
