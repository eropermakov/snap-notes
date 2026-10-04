import { describe, expect, it } from 'vitest'
import { clampEditorPosition, floatingEditorSize, shouldFollowAppend } from '../../src/shared/editorWorkspace'

describe('movable editor', () => {
  it('keeps every edge inside the workspace, including after a resize', () => {
    expect(clampEditorPosition({ x: -40, y: 900 }, { width: 900, height: 700 }, { width: 440, height: 600 })).toEqual({ x: 0, y: 100 })
    expect(clampEditorPosition({ x: 800, y: 500 }, { width: 500, height: 400 }, { width: 480, height: 380 })).toEqual({ x: 20, y: 20 })
  })
  it('fits short and narrow workspaces without hiding the toolbar', () => {
    expect(floatingEditorSize({ width: 320, height: 280 }, 520)).toEqual({ width: 304, height: 264 })
    expect(floatingEditorSize({ width: 1200, height: 900 }, 520)).toEqual({ width: 520, height: 680 })
  })
})

describe('following appended text', () => {
  const base = { grew: true, nearBottom: true, editingEarlier: false, searching: false }
  it('follows new content when reading the end of the note', () => {
    expect(shouldFollowAppend(base)).toBe(true)
  })
  it('never takes the reader away from earlier text, a selection, or a search result', () => {
    expect(shouldFollowAppend({ ...base, nearBottom: false })).toBe(false)
    expect(shouldFollowAppend({ ...base, editingEarlier: true })).toBe(false)
    expect(shouldFollowAppend({ ...base, searching: true })).toBe(false)
    expect(shouldFollowAppend({ ...base, grew: false })).toBe(false)
  })
})
