import { nativeImage } from 'electron'

interface FrameBitmap {
  buffer: Buffer
  width: number
  height: number
}

function toFrameBitmap(pngBuffer: Buffer): FrameBitmap | null {
  const img = nativeImage.createFromBuffer(pngBuffer)
  const { width, height } = img.getSize()
  if (!width || !height) return null
  return { buffer: img.toBitmap(), width, height }
}

function pixelDiff(a: Buffer, b: Buffer, offsetA: number, offsetB: number): number {
  return (
    Math.abs(a[offsetA] - b[offsetB]) +
    Math.abs(a[offsetA + 1] - b[offsetB + 1]) +
    Math.abs(a[offsetA + 2] - b[offsetB + 2]) +
    Math.abs(a[offsetA + 3] - b[offsetB + 3])
  )
}

const MIN_OVERLAP = 16
const SAMPLE_ROWS = 6
const ACCEPT_AVG_DIFF = 10 // average per-channel diff (0-255) below which a match is trusted
const AMBIGUITY_MARGIN = 3 // if a far-away offset scores almost as well, the match isn't trustworthy
const AMBIGUITY_DISTANCE = SAMPLE_ROWS * 3 // how far an offset must be to count as "a different match"

/**
 * Finds how many rows of `next`'s top overlap with `prev`'s bottom (both frames captured from the
 * exact same screen rect at different scroll positions). Returns 0 if no confident, unambiguous match
 * is found - safer to keep the extra rows (a visible seam) than to risk trimming real, non-duplicate
 * content. Flat/low-texture regions (solid backgrounds, whitespace) can score well at many different
 * offsets at once - the ambiguity check below rejects those instead of picking an arbitrary one.
 */
function findOverlap(prev: FrameBitmap, next: FrameBitmap): number {
  if (prev.width !== next.width) return 0
  const width = prev.width
  const maxOverlap = Math.min(prev.height, next.height) - 4
  if (maxOverlap < MIN_OVERLAP) return 0

  const cols = [0.2, 0.4, 0.5, 0.6, 0.8].map((f) => Math.floor(width * f)).filter((c) => c >= 0 && c < width)

  const scores = new Map<number, number>()

  for (let overlap = MIN_OVERLAP; overlap <= maxOverlap; overlap++) {
    let diff = 0
    let samples = 0
    for (let r = 0; r < SAMPLE_ROWS; r++) {
      const prevRow = prev.height - overlap + r
      const nextRow = r
      if (prevRow < 0 || prevRow >= prev.height || nextRow >= next.height) continue
      const prevRowOffset = prevRow * width * 4
      const nextRowOffset = nextRow * width * 4
      for (const c of cols) {
        diff += pixelDiff(prev.buffer, next.buffer, prevRowOffset + c * 4, nextRowOffset + c * 4)
        samples++
      }
    }
    if (samples === 0) continue
    scores.set(overlap, diff / (samples * 4))
  }

  let bestOverlap = 0
  let bestScore = Infinity
  for (const [overlap, score] of scores) {
    if (score < bestScore) {
      bestScore = score
      bestOverlap = overlap
    }
  }
  if (bestScore > ACCEPT_AVG_DIFF) return 0

  for (const [overlap, score] of scores) {
    if (Math.abs(overlap - bestOverlap) < AMBIGUITY_DISTANCE) continue
    if (score <= bestScore + AMBIGUITY_MARGIN) return 0
  }

  return bestOverlap
}

/**
 * Stitches a sequence of same-width screenshot frames (captured from the same screen rect while the
 * user scrolled between captures) into one tall PNG, trimming the detected vertical overlap between
 * consecutive frames. Frames with a mismatched width are dropped defensively. Returns null if no
 * frame could be decoded.
 */
export function stitchFrames(pngBuffers: Buffer[]): Buffer | null {
  const decoded = pngBuffers.map(toFrameBitmap).filter((f): f is FrameBitmap => f !== null)
  if (decoded.length === 0) return null

  const width = decoded[0].width
  const usable = decoded.filter((f) => f.width === width)
  if (usable.length === 0) return null

  if (usable.length === 1) {
    return nativeImage.createFromBitmap(usable[0].buffer, { width, height: usable[0].height }).toPNG()
  }

  const overlaps: number[] = [0]
  for (let i = 1; i < usable.length; i++) {
    overlaps.push(findOverlap(usable[i - 1], usable[i]))
  }

  let totalHeight = usable[0].height
  for (let i = 1; i < usable.length; i++) {
    totalHeight += usable[i].height - overlaps[i]
  }
  totalHeight = Math.max(1, totalHeight)

  const rowBytes = width * 4
  const out = Buffer.alloc(rowBytes * totalHeight)

  let y = 0
  usable[0].buffer.copy(out, y * rowBytes, 0, usable[0].height * rowBytes)
  y += usable[0].height

  for (let i = 1; i < usable.length; i++) {
    const frame = usable[i]
    const startRow = Math.min(overlaps[i], frame.height)
    const rowsToCopy = frame.height - startRow
    if (rowsToCopy <= 0) continue
    const srcStart = startRow * rowBytes
    const srcEnd = srcStart + rowsToCopy * rowBytes
    frame.buffer.copy(out, y * rowBytes, srcStart, srcEnd)
    y += rowsToCopy
  }

  return nativeImage.createFromBitmap(out, { width, height: totalHeight }).toPNG()
}

/**
 * Splits a tall PNG into chunks of about `targetHeight` rows, cutting at the quietest row (least
 * pixel variation — typically the gap between lines or paragraphs) near each target, so text lines
 * are not cut in half. Images shorter than `targetHeight * 1.25` are returned as one chunk.
 */
export function splitAtQuietRows(pngBuffer: Buffer, targetHeight = 2000, searchWindow = 300): Buffer[] {
  const img = nativeImage.createFromBuffer(pngBuffer)
  const { width, height } = img.getSize()
  if (!width || !height || height <= targetHeight * 1.25) return [pngBuffer]
  const bitmap = img.toBitmap()
  const rowBytes = width * 4
  const step = Math.max(1, Math.floor(width / 200))

  const rowVariation = (y: number): number => {
    const offset = y * rowBytes
    let min = 255
    let max = 0
    for (let x = 0; x < width; x += step) {
      const i = offset + x * 4
      const lum = (bitmap[i] + bitmap[i + 1] + bitmap[i + 2]) / 3
      if (lum < min) min = lum
      if (lum > max) max = lum
    }
    return max - min
  }

  const cuts: number[] = []
  let y = targetHeight
  while (y < height - targetHeight * 0.25) {
    let best = y
    let bestScore = Infinity
    for (let candidate = Math.max(1, y - searchWindow); candidate < Math.min(height - 1, y + searchWindow); candidate++) {
      const score = rowVariation(candidate)
      if (score < bestScore) {
        bestScore = score
        best = candidate
        if (score === 0) break
      }
    }
    cuts.push(best)
    y = best + targetHeight
  }

  const chunks: Buffer[] = []
  let start = 0
  for (const cut of [...cuts, height]) {
    if (cut - start < 1) continue
    chunks.push(img.crop({ x: 0, y: start, width, height: cut - start }).toPNG())
    start = cut
  }
  return chunks
}
