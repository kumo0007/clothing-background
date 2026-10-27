/**
 * Post-RMBG repair for white-garment-on-carpet under-recall.
 *
 * RMBG often keeps the high-contrast measuring tape and drops pale shirt body,
 * or slices KEEP along the tape. This module:
 *  1) Promotes soft alpha that looks like garment
 *  2) Morph-closes thin REMOVE corridors (tape-width gaps)
 *  3) Grows KEEP into adjacent bright low-chroma fabric (carpet-safe gates)
 *  4) Fills enclosed holes
 *
 * Never runs studio peels (those shrink KEEP further on carpet).
 */
import type { MaskPixelBuffer } from '../../types/mask'
import { cloneMaskBuffer } from './createMask'
import { fillMaskHoles, morphCloseMask } from './refineMask'
import { averageCornerColor, localLumaVariance } from './selectSimilar'

export type SdkUnderRecallRepairResult = {
  applied: boolean
  reason: string
  keepBefore: number
  keepAfter: number
  promotedSoft: number
  grown: number
  closedDelta: number
  holesFilled: number
}

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

function colorDistance(
  imageData: ImageData,
  x: number,
  y: number,
  corner: { r: number; g: number; b: number },
): number {
  const o = (y * imageData.width + x) * 4
  const dr = imageData.data[o]! - corner.r
  const dg = imageData.data[o + 1]! - corner.g
  const db = imageData.data[o + 2]! - corner.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function countKeep(mask: MaskPixelBuffer, thr = 128): number {
  let n = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! >= thr) n += 1
  }
  return n
}

function paleContentRatio(imageData: ImageData): number {
  const { width, height, data } = imageData
  let pale = 0
  const n = width * height
  for (let i = 0; i < n; i += 1) {
    const o = i * 4
    const r = data[o]!
    const g = data[o + 1]!
    const b = data[o + 2]!
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    if (luma >= 165 && chroma <= 50) pale += 1
  }
  return pale / Math.max(1, n)
}

function softRatio(mask: MaskPixelBuffer): number {
  let soft = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    const v = mask.data[i]!
    if (v > 0 && v < 200) soft += 1
  }
  return soft / Math.max(1, mask.data.length)
}

/** Largest KEEP component bbox aspect (w/h or h/w) — tape is very elongated. */
function largestKeepAspect(mask: MaskPixelBuffer): {
  aspect: number
  area: number
  share: number
} {
  const { width, height, data } = mask
  const n = width * height
  const seen = new Uint8Array(n)
  let bestArea = 0
  let bestAspect = 1
  let keepTotal = 0
  const stack: number[] = []

  for (let i = 0; i < n; i += 1) {
    if (data[i]! >= 128) keepTotal += 1
  }

  for (let i = 0; i < n; i += 1) {
    if (seen[i] || data[i]! < 128) continue
    let area = 0
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0
    stack.length = 0
    stack.push(i)
    seen[i] = 1
    while (stack.length > 0) {
      const cur = stack.pop()!
      area += 1
      const x = cur % width
      const y = (cur / width) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const neigh = [
        x > 0 ? cur - 1 : -1,
        x + 1 < width ? cur + 1 : -1,
        y > 0 ? cur - width : -1,
        y + 1 < height ? cur + width : -1,
      ]
      for (const j of neigh) {
        if (j < 0 || seen[j] || data[j]! < 128) continue
        seen[j] = 1
        stack.push(j)
      }
    }
    if (area < bestArea) continue
    const bw = Math.max(1, maxX - minX + 1)
    const bh = Math.max(1, maxY - minY + 1)
    bestArea = area
    bestAspect = Math.max(bw / bh, bh / bw)
  }

  return {
    aspect: bestAspect,
    area: bestArea,
    share: keepTotal > 0 ? bestArea / keepTotal : 0,
  }
}

/**
 * Measuring-tape slice: a short REMOVE run with KEEP on both sides on the
 * same row or column (shirt body split across the tape).
 */
export function hasThinKeepCorridor(mask: MaskPixelBuffer): boolean {
  const { width, height, data } = mask
  // Measuring tapes are often ~1–3% of the short edge; allow a wider band.
  const maxGap = Math.max(12, Math.floor(Math.min(width, height) * 0.1))
  let hits = 0

  for (let y = 0; y < height; y += 1) {
    let x = 0
    while (x < width) {
      while (x < width && data[y * width + x]! >= 128) x += 1
      if (x >= width) break
      const start = x
      while (x < width && data[y * width + x]! < 128) x += 1
      const gap = x - start
      if (
        gap >= 2 &&
        gap <= maxGap &&
        start > 0 &&
        x < width &&
        data[y * width + (start - 1)]! >= 128 &&
        data[y * width + x]! >= 128
      ) {
        hits += 1
        if (hits >= 3) return true
      }
    }
  }

  hits = 0
  for (let x = 0; x < width; x += 1) {
    let y = 0
    while (y < height) {
      while (y < height && data[y * width + x]! >= 128) y += 1
      if (y >= height) break
      const start = y
      while (y < height && data[y * width + x]! < 128) y += 1
      const gap = y - start
      if (
        gap >= 2 &&
        gap <= maxGap &&
        start > 0 &&
        y < height &&
        data[(start - 1) * width + x]! >= 128 &&
        data[y * width + x]! >= 128
      ) {
        hits += 1
        if (hits >= 3) return true
      }
    }
  }
  return false
}

export function detectSdkUnderRecall(
  mask: MaskPixelBuffer,
  imageData: ImageData,
): { underRecall: boolean; reason: string } {
  if (
    mask.width !== imageData.width ||
    mask.height !== imageData.height
  ) {
    return { underRecall: false, reason: 'dimension-mismatch' }
  }

  const pixels = mask.data.length
  const keep = countKeep(mask)
  const keepRatio = keep / pixels
  const pale = paleContentRatio(imageData)
  const soft = softRatio(mask)
  const largest = largestKeepAspect(mask)

  // Catastrophic: almost nothing kept while scene is pale (shirt+carpet).
  if (keepRatio < 0.12 && pale > 0.22) {
    return {
      underRecall: true,
      reason: `keep ${keepRatio.toFixed(3)} << pale ${pale.toFixed(3)}`,
    }
  }

  // Tape-bait: thin elongated KEEP dominates a small mask.
  if (
    keepRatio < 0.22 &&
    largest.aspect >= 4.5 &&
    largest.share >= 0.55 &&
    pale > 0.2
  ) {
    return {
      underRecall: true,
      reason: `elongated-keep aspect ${largest.aspect.toFixed(1)} keep ${keepRatio.toFixed(3)}`,
    }
  }

  // Soft silhouette unused — model saw garment but left it mid-alpha.
  if (keepRatio < 0.35 && soft > Math.max(0.08, keepRatio * 0.85) && pale > 0.18) {
    return {
      underRecall: true,
      reason: `soft ${soft.toFixed(3)} vs keep ${keepRatio.toFixed(3)}`,
    }
  }

  // Modest keep with lots of pale content left out (sliced shirt).
  if (keepRatio > 0.12 && keepRatio < 0.4 && pale > keepRatio + 0.18) {
    return {
      underRecall: true,
      reason: `pale-gap keep ${keepRatio.toFixed(3)} pale ${pale.toFixed(3)}`,
    }
  }

  // Shirt mostly kept but split by a thin REMOVE corridor (tape slice).
  if (
    keepRatio >= 0.15 &&
    keepRatio <= 0.7 &&
    pale > 0.15 &&
    hasThinKeepCorridor(mask)
  ) {
    return {
      underRecall: true,
      reason: `thin-keep-corridor keep ${keepRatio.toFixed(3)}`,
    }
  }

  return { underRecall: false, reason: 'ok' }
}

function promoteSoftAlpha(mask: MaskPixelBuffer, minSoft = 40): number {
  let n = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    const v = mask.data[i]!
    if (v >= minSoft && v < 128) {
      mask.data[i] = 255
      n += 1
    } else if (v >= 128 && v < 255) {
      mask.data[i] = 255
    }
  }
  return n
}

function isPaleGarmentCandidate(
  imageData: ImageData,
  x: number,
  y: number,
  corner: { r: number; g: number; b: number },
  cornerLuma: number,
): boolean {
  const luma = lumaAt(imageData, x, y)
  const chroma = chromaAt(imageData, x, y)
  if (luma < 170 || chroma > 48) return false

  // Very white fabric — reclaim even near corner sample.
  if (luma >= 205 && chroma <= 32) return true

  const dist = colorDistance(imageData, x, y, corner)
  // Brighter than carpet / floor sample → garment panel.
  if (luma >= cornerLuma + 18) return true
  // Distinct from corner color.
  if (dist >= 30 && luma >= 180) return true

  // Textured white (piqué) that is not flat carpet: modest lift + variance.
  const variance = localLumaVariance(imageData, x, y, 2)
  if (luma >= cornerLuma + 8 && variance >= 12 && chroma <= 40) return true

  return false
}

/**
 * Fill short REMOVE runs that have KEEP on both sides (tape slice through shirt).
 * Safer than a large morph-close, which can chew silhouette edges.
 */
export function bridgeThinKeepCorridors(mask: MaskPixelBuffer): number {
  const { width, height, data } = mask
  const maxGap = Math.max(12, Math.floor(Math.min(width, height) * 0.1))
  let filled = 0

  const fillRun = (indices: number[]) => {
    for (const i of indices) {
      if (data[i]! < 128) {
        data[i] = 255
        filled += 1
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    let x = 0
    while (x < width) {
      while (x < width && data[y * width + x]! >= 128) x += 1
      if (x >= width) break
      const start = x
      while (x < width && data[y * width + x]! < 128) x += 1
      const gap = x - start
      if (
        gap >= 2 &&
        gap <= maxGap &&
        start > 0 &&
        x < width &&
        data[y * width + (start - 1)]! >= 128 &&
        data[y * width + x]! >= 128
      ) {
        const run: number[] = []
        for (let xx = start; xx < x; xx += 1) run.push(y * width + xx)
        fillRun(run)
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    let y = 0
    while (y < height) {
      while (y < height && data[y * width + x]! >= 128) y += 1
      if (y >= height) break
      const start = y
      while (y < height && data[y * width + x]! < 128) y += 1
      const gap = y - start
      if (
        gap >= 2 &&
        gap <= maxGap &&
        start > 0 &&
        y < height &&
        data[(start - 1) * width + x]! >= 128 &&
        data[y * width + x]! >= 128
      ) {
        const run: number[] = []
        for (let yy = start; yy < y; yy += 1) run.push(yy * width + x)
        fillRun(run)
      }
    }
  }

  return filled
}

function growPaleFromKeep(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  maxPasses: number,
): number {
  const corner = averageCornerColor(imageData)
  const cornerLuma =
    0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const { width, height, data } = mask
  let grown = 0

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const add: number[] = []
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x
        if (data[i]! >= 128) continue
        const touches =
          data[i - 1]! >= 128 ||
          data[i + 1]! >= 128 ||
          data[i - width]! >= 128 ||
          data[i + width]! >= 128
        if (!touches) continue
        if (!isPaleGarmentCandidate(imageData, x, y, corner, cornerLuma)) {
          continue
        }
        add.push(i)
      }
    }
    if (add.length === 0) break
    for (const i of add) {
      data[i] = 255
      grown += 1
    }
  }
  return grown
}

/**
 * Mutates `mask` when under-recall is detected. Returns stats; if growth
 * explodes past 82% of the frame, restores the pre-repair snapshot.
 */
export function repairSdkUnderRecall(
  mask: MaskPixelBuffer,
  imageData: ImageData,
): SdkUnderRecallRepairResult {
  const empty: SdkUnderRecallRepairResult = {
    applied: false,
    reason: 'skipped',
    keepBefore: countKeep(mask),
    keepAfter: countKeep(mask),
    promotedSoft: 0,
    grown: 0,
    closedDelta: 0,
    holesFilled: 0,
  }

  const detection = detectSdkUnderRecall(mask, imageData)
  if (!detection.underRecall) {
    return { ...empty, reason: detection.reason }
  }

  const snapshot = cloneMaskBuffer(mask)
  const keepBefore = countKeep(mask)
  const keepBeforeRatio = keepBefore / mask.data.length
  const { width, height } = mask
  const corridor = hasThinKeepCorridor(mask)
  const severe = keepBeforeRatio < 0.18

  const promotedSoft = promoteSoftAlpha(mask, 36)

  const bridged = bridgeThinKeepCorridors(mask)

  const beforeClose = countKeep(mask)
  const closeRadius = Math.max(
    2,
    Math.min(corridor ? 4 : 3, Math.floor(Math.min(width, height) * 0.015)),
  )
  morphCloseMask(mask, closeRadius)
  const closedDelta = countKeep(mask) - beforeClose + bridged

  // Pale grow is for missing shirt body; corridor-only cases mostly need bridge.
  const grown = growPaleFromKeep(
    mask,
    imageData,
    severe ? 28 : corridor && keepBeforeRatio > 0.25 ? 6 : 16,
  )

  const holesFilled = fillMaskHoles(
    mask,
    Math.max(400, Math.floor(width * height * 0.2)),
  )

  const keepAfter = countKeep(mask)
  const afterRatio = keepAfter / mask.data.length

  // Rollback if we swallowed most of the frame (carpet flood).
  if (afterRatio > 0.82 || keepAfter < keepBefore) {
    mask.data.set(snapshot.data)
    return {
      applied: false,
      reason: `rollback:${detection.reason}:ratio=${afterRatio.toFixed(3)}`,
      keepBefore,
      keepAfter: countKeep(mask),
      promotedSoft: 0,
      grown: 0,
      closedDelta: 0,
      holesFilled: 0,
    }
  }

  // Require meaningful improvement.
  if (keepAfter < keepBefore * 1.08 && keepAfter - keepBefore < pixelsMinGain(mask)) {
    mask.data.set(snapshot.data)
    return {
      applied: false,
      reason: `no-gain:${detection.reason}`,
      keepBefore,
      keepAfter: countKeep(mask),
      promotedSoft: 0,
      grown: 0,
      closedDelta: 0,
      holesFilled: 0,
    }
  }

  return {
    applied: true,
    reason: detection.reason,
    keepBefore,
    keepAfter,
    promotedSoft,
    grown,
    closedDelta,
    holesFilled,
  }
}

function pixelsMinGain(mask: MaskPixelBuffer): number {
  return Math.max(80, Math.floor(mask.data.length * 0.01))
}
