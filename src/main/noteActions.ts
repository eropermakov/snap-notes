import type { Block } from '../shared/blocks'
import type { OperationType } from '../shared/providers'
import type { Note } from '../shared/types'
import { itemsToBlocks } from '../shared/aiBlocks'
import { blocksToMarkdown } from '../shared/blockExport'
import { cleanOcrText } from '../shared/ocrCleanup'
import { extractBlockItems } from '../shared/structuredJson'
import { buildAiActionPrompt, buildJsonRepairPromptV2, buildTidyPrompt, type AiAction } from '../shared/ocrPrompts'
import { htmlToBlocks, sanitizeInline, textToInline, inlineToText } from '../shared/blocks'
import type { ProviderManager } from './providers/manager'
import * as notesStore from './notesStore'

export interface ActionOutcome {
  ok: boolean
  note?: Note
  message?: string
  /** Name of the AI provider that did the work, for the UI notice. */
  provider?: string
}

const OPERATIONS: Record<AiAction, OperationType> = {
  shorten: 'AI_SUMMARY',
  keypoints: 'AI_SUMMARY',
  explain: 'AI_REWRITE',
  rewrite: 'AI_REWRITE',
  list: 'AI_REWRITE',
  translate: 'TRANSLATION'
}

/** Actions that add a result after the fragment instead of replacing it. */
const ADDITIVE: AiAction[] = ['explain', 'keypoints']

function sourceBlocks(note: Note, sourceId: string): Block[] {
  return (note.blocks ?? htmlToBlocks(note.body)).filter((b) => b.sourceId === sourceId && b.type !== 'image')
}

/** Photos of a fragment: AI never sees or rewrites them, and replacing text must keep them. */
function sourceImages(note: Note, sourceId: string): Block[] {
  return (note.blocks ?? htmlToBlocks(note.body)).filter((b) => b.sourceId === sourceId && b.type === 'image')
}

/** Offline "tidy": the deterministic cleanup on every text field; code is never touched. */
export function tidyLocally(blocks: Block[]): Block[] {
  const clean = (html: string): string => {
    // Re-clean the text but keep inline formatting when the text did not change.
    const text = inlineToText(html)
    const cleaned = cleanOcrText(text)
    return cleaned === text ? html : sanitizeInline(textToInline(cleaned))
  }
  return blocks.map((block) => {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'quote':
        return { ...block, html: clean(block.html) }
      case 'bullet_list':
      case 'numbered_list':
        return { ...block, items: block.items.map(clean) }
      case 'checklist':
        return { ...block, items: block.items.map((i) => ({ ...i, html: clean(i.html) })) }
      case 'table':
        return { ...block, rows: block.rows.map((r) => r.map(clean)) }
      default:
        return block
    }
  })
}

async function runStructured(
  manager: ProviderManager,
  operation: OperationType,
  prompt: string
): Promise<{ blocks: Block[]; provider: string }> {
  const outcome = await manager.execute({
    operation,
    requiredCapabilities: ['text', 'noteActions'],
    imageSent: false,
    includeLocalFallback: false,
    run: (provider) => provider.runStructuredOutput({ operation, prompt })
  })
  let raw = outcome.result.text
  let items = extractBlockItems(raw)
  if (!items) {
    // One text-only repair request on the same provider, then give up without touching the note.
    const repaired = await manager.execute({
      operation,
      requiredCapabilities: ['text'],
      imageSent: false,
      includeLocalFallback: false,
      onlyProvider: outcome.provider,
      run: (provider) => provider.runStructuredOutput({ operation, prompt: buildJsonRepairPromptV2(raw) })
    })
    raw = repaired.result.text
    items = extractBlockItems(raw)
  }
  const blocks = items ? (itemsToBlocks(items).filter((b) => b.type !== 'pending_image') as Block[]) : []
  return { blocks, provider: manager.get(outcome.provider)?.name ?? outcome.provider }
}

/**
 * "Привести в порядок" (§18): fixes recognition errors and structure of one captured fragment
 * without changing its meaning. Offline mode uses the local deterministic cleanup only.
 */
export async function tidySource(manager: ProviderManager, noteId: string, sourceId: string, offline: boolean): Promise<ActionOutcome> {
  const note = notesStore.getNote(noteId)
  if (!note) return { ok: false, message: 'Заметка не найдена' }
  const blocks = sourceBlocks(note, sourceId)
  if (blocks.length === 0) return { ok: false, message: 'Фрагмент не найден' }
  if (offline) {
    // All blocks in their order (images pass through tidyLocally unchanged).
    const all = (note.blocks ?? htmlToBlocks(note.body)).filter((b) => b.sourceId === sourceId)
    const updated = await notesStore.replaceSourceBlocks(noteId, sourceId, tidyLocally(all))
    return updated ? { ok: true, note: updated, provider: 'локальная очистка' } : { ok: false }
  }
  try {
    const result = await runStructured(manager, 'OCR_CLEANUP', buildTidyPrompt(blocksToMarkdown(blocks)))
    if (result.blocks.length === 0) return { ok: false, message: 'ИИ вернул пустой ответ — фрагмент не изменён.' }
    // Only text is replaced; the fragment's photos are kept after it.
    const updated = await notesStore.replaceSourceBlocks(noteId, sourceId, [...result.blocks, ...sourceImages(note, sourceId)])
    return updated ? { ok: true, note: updated, provider: result.provider } : { ok: false }
  } catch {
    return { ok: false, message: 'Не удалось связаться с ИИ — фрагмент не изменён.' }
  }
}

/**
 * Explicit AI edits (§18). Only run on the user's command; never part of recognition.
 * Replacing actions keep the fragment's source link; additive ones insert after the fragment.
 */
export async function runAiAction(
  manager: ProviderManager,
  noteId: string,
  sourceId: string,
  action: AiAction,
  offline: boolean,
  language?: string
): Promise<ActionOutcome> {
  if (offline) return { ok: false, message: 'Действия ИИ недоступны в режиме «Только офлайн».' }
  const note = notesStore.getNote(noteId)
  if (!note) return { ok: false, message: 'Заметка не найдена' }
  const blocks = sourceBlocks(note, sourceId)
  if (blocks.length === 0) return { ok: false, message: 'Фрагмент не найден' }
  try {
    const result = await runStructured(manager, OPERATIONS[action], buildAiActionPrompt(action, blocksToMarkdown(blocks), language))
    if (result.blocks.length === 0) return { ok: false, message: 'ИИ вернул пустой ответ — заметка не изменена.' }
    const updated = ADDITIVE.includes(action)
      ? await notesStore.insertAfterSource(noteId, sourceId, result.blocks)
      : await notesStore.replaceSourceBlocks(noteId, sourceId, [...result.blocks, ...sourceImages(note, sourceId)])
    return updated ? { ok: true, note: updated, provider: result.provider } : { ok: false }
  } catch {
    return { ok: false, message: 'Не удалось связаться с ИИ — заметка не изменена.' }
  }
}
