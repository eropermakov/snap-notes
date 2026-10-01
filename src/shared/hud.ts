/** State of the capture HUD: a small always-on-top window shown over other apps (§13, §21). */

export interface HudSession {
  count: number
  noteTitle: string
}

export interface HudPickNote {
  id: string
  title: string
}

export type HudState =
  | { kind: 'hidden' }
  | { kind: 'working'; text: string; session?: HudSession }
  | {
      kind: 'added'
      tone: 'success' | 'warning'
      noteId: string
      noteTitle: string
      /** Present when the addition can be undone as one capture. */
      sourceId?: string
      /** Extra line, e.g. a fallback notice ("Распознано: Gemini · ChatGPT: лимит исчерпан"). */
      detail?: string
      session?: HudSession
    }
  | { kind: 'message'; tone: 'warning' | 'error'; text: string; session?: HudSession }
  | { kind: 'session'; session: HudSession }
  | { kind: 'pick'; requestId: string; notes: HudPickNote[] }

export type HudAction =
  | { type: 'undo'; noteId: string; sourceId: string }
  | { type: 'open'; noteId: string }
  | { type: 'sessionNext' }
  | { type: 'sessionFinish' }
  | { type: 'pick'; requestId: string; choice: string | null }
  | { type: 'dismiss' }
  | { type: 'hover'; hovering: boolean }
  | { type: 'resize'; width: number; height: number }
