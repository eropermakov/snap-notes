export type OcrQuality = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'

export const QUALITY_LABELS: Record<Exclude<OcrQuality, 'UNKNOWN'>, string> = {
  HIGH: 'Высокое',
  MEDIUM: 'Среднее',
  LOW: 'Низкое'
}

export interface QualityLine {
  text: string
  /** 0–100, as reported by the recognizer. */
  confidence: number
  words?: { text: string; confidence: number }[]
}

const WORD_LOW = 60

/**
 * Normalized recognition quality, derived only from what the recognizer really reported: line / word
 * confidences of the local engine (Tesseract). Cloud AI providers do not report a confidence, so their
 * results are UNKNOWN — a confidence is never made up. Many low-confidence words pull the level down
 * (an internal validation check on top of the reported average).
 */
export function qualityFromLines(lines: readonly QualityLine[] | undefined): OcrQuality {
  const usable = (lines ?? []).filter((l) => l.text.trim() && Number.isFinite(l.confidence))
  if (usable.length === 0) return 'UNKNOWN'
  let weight = 0
  let sum = 0
  for (const line of usable) {
    const w = Math.max(1, line.text.trim().length)
    weight += w
    sum += w * line.confidence
  }
  const average = sum / weight / 100
  let level: Exclude<OcrQuality, 'UNKNOWN'> = average >= 0.88 ? 'HIGH' : average >= 0.7 ? 'MEDIUM' : 'LOW'

  const words = usable.flatMap((l) => l.words ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w.text))
  if (words.length >= 5) {
    const lowShare = words.filter((w) => w.confidence < WORD_LOW).length / words.length
    if (level === 'HIGH' && lowShare > 0.08) level = 'MEDIUM'
    else if (level === 'MEDIUM' && lowShare > 0.2) level = 'LOW'
  }
  return level
}

/** Quality as stored with a capture: only a real level, never UNKNOWN. */
export function storedQuality(quality: OcrQuality): 'HIGH' | 'MEDIUM' | 'LOW' | undefined {
  return quality === 'UNKNOWN' ? undefined : quality
}
