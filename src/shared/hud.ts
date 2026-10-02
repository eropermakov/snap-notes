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
      /** Play a short soft sound (OCR completion feedback: sound + visual). */
      sound?: boolean
    }
  | { kind: 'suggest'; text: string }
  /**
   * Background OCR queue. `captured`: a screenshot was accepted ("Принято · в очереди: 3"); `processing`:
   * one calm progress line for the whole run; `done` / `failed`: the run is finished.
   */
  | {
      kind: 'queue'
      phase: 'captured' | 'processing' | 'done' | 'failed'
      text: string
      detail?: string
      /** Newest accepted capture: lets the notice cancel it while it is still waiting. */
      jobId?: string
      noteId?: string
      progress?: { done: number; total: number }
      failed?: number
      sound?: boolean
      session?: HudSession
    }
  | { kind: 'message'; tone: 'warning' | 'error'; text: string; session?: HudSession }
  | { kind: 'session'; session: HudSession }
  | { kind: 'pick'; requestId: string; notes: HudPickNote[] }

export type HudAction =
  | { type: 'undo'; noteId: string; sourceId: string }
  | { type: 'open'; noteId: string }
  | { type: 'ocrClipboard' }
  | { type: 'cancelJob'; jobId: string }
  | { type: 'retryFailed' }
  | { type: 'sessionNext' }
  | { type: 'sessionFinish' }
  | { type: 'pick'; requestId: string; choice: string | null }
  | { type: 'dismiss' }
  | { type: 'hover'; hovering: boolean }
  | { type: 'resize'; width: number; height: number }
