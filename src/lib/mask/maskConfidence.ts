/**
 * Heuristic auto-mask confidence for review flagging.
 * Not a claim of correctness — a confidently wrong mask can still score mid-range.
 */
import type { MaskPixelBuffer } from '../../types/mask'
import { averageCornerColor, localLumaVariance } from './selectSimilar'

function lumaAt(imageData: ImageData, x: number, y: number): number {
  const o = (y * imageData.width + x) * 4
  return (
    0.299 * imageData.data[o]! +
    0.587 * imageData.data[o + 1]! +
    0.114 * imageData.data[o + 2]!
  )
}

function chromaAt(imageData: ImageData, x: number, y: number): number {
  const o = (y * imageData.width + x) * 4
  const r = imageData.data[o]!
  const g = imageData.data[o + 1]!
  const b = imageData.data[o + 2]!
  return Math.max(r, g, b) - Math.min(r, g, b)
}

export type MaskConfidence = {
  /** 0 = very uncertain, 1 = relatively clear separation */
  score: number
  needsReview: boolean
  reasons: string[]
}

export function estimateMaskConfidence(
  mask: MaskPixelBuffer,
  imageData: ImageData,
): MaskConfidence {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma =
    0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const reasons: string[] = []

  let keep = 0
  let soft = 0
  let darkKeep = 0
  let paleKeepNearCard = 0
  let brightKeepEdge = 0
  let borderKeepStudio = 0
  let borderPix = 0

  const band = Math.max(2, Math.floor(Math.min(width, height) * 0.03))

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const v = mask.data[i]!
      if (v >= 128) keep += 1
      if (v > 0 && v < 200) soft += 1
      if (v < 128) continue
      const L = lumaAt(imageData, x, y)
      const c = chromaAt(imageData, x, y)
      if (L < 100) darkKeep += 1
      if (L >= studioLuma - 4 && c <= 24) paleKeepNearCard += 1

      const onBorder =
        x < band || y < band || x >= width - band || y >= height - band
      if (onBorder) {
        borderPix += 1
        if (L >= studioLuma - 6 && c <= 28) borderKeepStudio += 1
      }

      const touchesRemove =
        (x > 0 && mask.data[i - 1]! < 128) ||
        (x + 1 < width && mask.data[i + 1]! < 128) ||
        (y > 0 && mask.data[i - width]! < 128) ||
        (y + 1 < height && mask.data[i + width]! < 128)
      if (
        touchesRemove &&
        L >= 185 &&
        c <= 22 &&
        localLumaVariance(imageData, x, y, 1) <= 14
      ) {
        brightKeepEdge += 1
      }
    }
  }

  const pixels = width * height
  const keepRatio = keep / pixels
  const softRatio = soft / pixels
  const paleAmongKeep = keep > 0 ? paleKeepNearCard / keep : 0
  const borderStudioRatio = borderPix > 0 ? borderKeepStudio / borderPix : 0
  const edgeHaloRatio = keep > 0 ? brightKeepEdge / keep : 0

  let score = 0.72

  // Strong dark/chromatic mass with little pale KEEP → clearer Lab separation
  if (darkKeep > 2000 && paleAmongKeep < 0.25) score += 0.12
  // Large pale KEEP share on near-white scenes → ambiguous
  if (paleAmongKeep > 0.45 && studioLuma >= 210) {
    score -= 0.28
    reasons.push('high near-card pale KEEP share (white-on-white risk)')
  }
  if (borderStudioRatio > 0.08) {
    score -= 0.18
    reasons.push('border-band studio KEEP leakage')
  }
  if (edgeHaloRatio > 0.02) {
    score -= 0.1
    reasons.push('bright silhouette fringe')
  }
  if (softRatio > 0.12) {
    score -= 0.08
    reasons.push('large soft-alpha ring')
  }
  if (keepRatio < 0.05 || keepRatio > 0.92) {
    score -= 0.15
    reasons.push('extreme KEEP area ratio')
  }
  if (darkKeep < 200 && paleAmongKeep > 0.3) {
    score -= 0.12
    reasons.push('weak dark structure with pale mass')
  }

  score = Math.max(0, Math.min(1, score))
  // Review when overall score is low, or when any *strong* contamination
  // signal fires. Two weak reasons alone no longer force review (reduces
  // false positives on dark garments with mild soft rings).
  const strongReason = reasons.some(
    (r) =>
      r.includes('white-on-white') ||
      r.includes('border-band studio') ||
      r.includes('weak dark structure'),
  )
  const needsReview = score < 0.55 || strongReason

  return { score, needsReview, reasons }
}
