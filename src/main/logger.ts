import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync, rmSync } from 'fs'
import path from 'path'

const MAX_BYTES = 1024 * 1024

let logFile: string | null = null

function file(): string {
  if (!logFile) {
    const dir = path.join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logFile = path.join(dir, 'snap-notes.log')
  }
  return logFile
}

function rotate(target: string): void {
  try {
    if (statSync(target).size < MAX_BYTES) return
    rmSync(`${target}.1`, { force: true })
    renameSync(target, `${target}.1`)
  } catch {
    /* no file yet */
  }
}

/**
 * Appends one JSON line to userData/logs/snap-notes.log (rotated at 1 MB).
 * Callers pass metadata only: never API keys, tokens, screenshots or recognized text.
 */
export function logEvent(scope: string, fields: Record<string, unknown>): void {
  try {
    const target = file()
    rotate(target)
    appendFileSync(target, `${JSON.stringify({ t: new Date().toISOString(), scope, ...fields })}\n`, 'utf-8')
  } catch {
    /* logging must never break the app */
  }
}

export function getLogDirectory(): string {
  return path.dirname(file())
}
