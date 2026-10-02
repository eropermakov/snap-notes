import type { CardSize } from './types'

/** Layout numbers for the notes grid: how wide a card is, how much text it previews, how tight it is. */
export interface CardMetrics {
  /** Narrowest a card may get (decides the number of columns). */
  minColumn: number
  /** Space between cards, px. */
  gap: number
  /** Lines of text in the preview. */
  previewLines: number
  maxColumns: number
}

const BASE: Record<CardSize, CardMetrics> = {
  small: { minColumn: 188, gap: 12, previewLines: 4, maxColumns: 8 },
  medium: { minColumn: 232, gap: 12, previewLines: 8, maxColumns: 6 },
  large: { minColumn: 320, gap: 14, previewLines: 14, maxColumns: 4 }
}

/** Compact grid: smaller gaps and shorter previews, but never below a readable minimum. */
export function cardMetrics(size: CardSize, compact: boolean): CardMetrics {
  const base = BASE[size] ?? BASE.medium
  if (!compact) return base
  return { ...base, gap: 6, previewLines: Math.max(3, Math.round(base.previewLines / 2)) }
}

export function columnsFor(width: number, metrics: CardMetrics): number {
  if (width <= 0) return 1
  return Math.max(1, Math.min(metrics.maxColumns, Math.floor((width + metrics.gap) / (metrics.minColumn + metrics.gap))))
}
