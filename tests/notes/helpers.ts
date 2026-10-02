import type { Note } from '../../src/shared/types'

let counter = 0
export function note(patch: Partial<Note> = {}): Note {
  counter++
  return {
    id: `n${counter}`,
    title: '',
    body: '',
    emoji: null,
    pinned: false,
    folderId: null,
    favorite: false,
    color: 'default',
    tags: [],
    createdAt: counter * 1000,
    updatedAt: counter * 1000,
    deletedAt: null,
    ...patch
  }
}
