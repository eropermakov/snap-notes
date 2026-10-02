import type { Note } from './types'
import { noteText } from './noteStats'

/**
 * Which note to open on start. A remembered note that was deleted (or moved to the trash) is ignored,
 * and the normal home screen opens instead.
 */
export function resolveStartupNote(restoreLastNote: boolean, lastNoteId: string | null, notes: readonly Pick<Note, 'id' | 'deletedAt'>[]): string | null {
  if (!restoreLastNote || !lastNoteId) return null
  const note = notes.find((n) => n.id === lastNoteId)
  return note && note.deletedAt === null ? note.id : null
}

/**
 * An automatically created note (capture) that was never used may be removed when the user leaves
 * it, or when its only content was undone: no typed title, no text, no images, no recognized fragments. Notes the user created
 * themselves are never discardable, even when empty.
 */
export function isDiscardableAutoNote(note: Pick<Note, 'autoCreated' | 'titleManual' | 'body' | 'sources' | 'deletedAt'>): boolean {
  if (note.autoCreated !== true || note.deletedAt !== null) return false
  // A title made by the app from the recognized text does not count; one the user typed does.
  if (note.titleManual === true) return false
  if (note.sources && Object.keys(note.sources).length > 0) return false
  if (/<(img|table|pre)\b/i.test(note.body)) return false
  return noteText(note.body).trim().length === 0
}
