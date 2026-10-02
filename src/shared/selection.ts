/** Multi-selection of note cards with familiar desktop behaviour (Ctrl toggles, Shift selects a range). */
export interface SelectionState {
  selected: string[]
  anchor: string | null
}

export const EMPTY_SELECTION: SelectionState = { selected: [], anchor: null }

export interface SelectInput {
  /** Ids in the order they are shown on screen. */
  order: string[]
  id: string
  ctrl: boolean
  shift: boolean
}

export function applySelection(state: SelectionState, { order, id, ctrl, shift }: SelectInput): SelectionState {
  if (shift && state.anchor && order.includes(state.anchor) && order.includes(id)) {
    const a = order.indexOf(state.anchor)
    const b = order.indexOf(id)
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1)
    // Ctrl+Shift extends the existing selection, Shift alone replaces it.
    const base = ctrl ? state.selected : []
    return { selected: [...new Set([...base, ...range])], anchor: state.anchor }
  }
  if (ctrl || shift) {
    const has = state.selected.includes(id)
    return { selected: has ? state.selected.filter((x) => x !== id) : [...state.selected, id], anchor: id }
  }
  return { selected: [id], anchor: id }
}

/** Drops ids that no longer exist (deleted notes, filter changes). */
export function pruneSelection(state: SelectionState, existing: Set<string>): SelectionState {
  const selected = state.selected.filter((id) => existing.has(id))
  if (selected.length === state.selected.length) return state
  return { selected, anchor: state.anchor && existing.has(state.anchor) ? state.anchor : (selected[0] ?? null) }
}
