/**
 * Independent definite FG / BG / uncertain reference labels for audit metrics.
 *
 * IMPORTANT: This is NOT the production auto-mask pipeline and must not be
 * treated as full human ground truth. Pixels labeled UNCERTAIN are excluded
 * from binary precision/recall/IoU. White-on-near-white leather, soft contact
 * shadows, and thin AA rings are intentionally UNCERTAIN when appearance alone
 * cannot decide them.
 *
 * Labels:
 *   255 = definite foreground (must KEEP)
 *   0   = definite background (must REMOVE)
 *   128 = uncertain / do not score
 */

import type { MaskPixelBuffer } from '../../../types/mask'
import { createMaskBuffer } from '../createMask'
import {
  averageCornerColor,
  localLumaVariance,
  type Rgb,
} from '../selectSimilar'

export const REF_FG = 255
export const REF_BG = 0
export const REF_UNCERTAIN = 128

function readRgb(imageData: ImageData, x: number, y: number): Rgb {
  const o = (y * imageData.width + x) * 4
  return {
    r: imageData.data[o]!,
    g: imageData.data[o + 1]!,
    b: imageData.data[o + 2]!,
  }
}

function luma(rgb: Rgb): number {
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
}

function chroma(rgb: Rgb): number {
  return Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
}

function dist(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

function isWarm(rgb: Rgb, L: number): boolean {
  return (
    L >= 70 &&
    L <= 210 &&
    rgb.r >= rgb.g &&
    rgb.g >= rgb.b - 8 &&
    rgb.r - rgb.b >= 18 &&
    chroma(rgb) >= 16
  )
}

/**
 * Build an independent reference mask from appearance + border connectivity.
 * Foreign footer bands (saturated / non-studio bottom chrome) are definite BG.
 */
export function buildIndependentReferenceMask(
  imageData: ImageData,
): MaskPixelBuffer {
  const { width, height } = imageData
  const ref = createMaskBuffer(width, height, REF_UNCERTAIN)
  const corner = averageCornerColor(imageData)
  const studioLuma = luma(corner)
  const pixels = width * height

  // 1) Definite BG: border flood through near-studio neutrals (tight).
  const definiteBg = new Uint8Array(pixels)
  const queue: number[] = []
  const bgThresh = 22

  const trySeed = (x: number, y: number) => {
    const i = y * width + x
    const rgb = readRgb(imageData, x, y)
    const L = luma(rgb)
    const c = chroma(rgb)
    const d = dist(rgb, corner)
    if (d <= bgThresh && c <= 24 && L >= studioLuma - 18) {
      definiteBg[i] = 1
      queue.push(i)
    }
  }
  for (let x = 0; x < width; x += 1) {
    trySeed(x, 0)
    trySeed(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    trySeed(0, y)
    trySeed(width - 1, y)
  }
  let head = 0
  while (head < queue.length) {
    const i = queue[head++]!
    const x = i % width
    const y = (i / width) | 0
    for (const n of [
      x > 0 ? i - 1 : -1,
      x + 1 < width ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y + 1 < height ? i + width : -1,
    ]) {
      if (n < 0 || definiteBg[n]) continue
      const nx = n % width
      const ny = (n / width) | 0
      const rgb = readRgb(imageData, nx, ny)
      const L = luma(rgb)
      const c = chroma(rgb)
      const d = dist(rgb, corner)
      if (d <= bgThresh * 1.25 && c <= 26 && L >= studioLuma - 22) {
        definiteBg[n] = 1
        queue.push(n)
      }
    }
  }

  // 2) Foreign footer: bottom / top bands dissimilar from studio card.
  const band = Math.max(8, Math.floor(height * 0.06))
  for (const y of [
    ...Array.from({ length: band }, (_, i) => i),
    ...Array.from({ length: band }, (_, i) => height - 1 - i),
  ]) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const rgb = readRgb(imageData, x, y)
      const L = luma(rgb)
      const c = chroma(rgb)
      const d = dist(rgb, corner)
      // Blue / saturated UI chrome or concrete unlike card.
      if (
        (c >= 36 && d >= 26) ||
        (rgb.b >= rgb.r + 25 && rgb.b >= 140) ||
        (L < 160 && d >= 40 && c < 30 && L > 40)
      ) {
        definiteBg[i] = 1
      }
    }
  }

  for (let i = 0; i < pixels; i += 1) {
    if (definiteBg[i]) {
      ref.data[i] = REF_BG
      continue
    }
    const x = i % width
    const y = (i / width) | 0
    const rgb = readRgb(imageData, x, y)
    const L = luma(rgb)
    const c = chroma(rgb)
    const d = dist(rgb, corner)
    const variance = localLumaVariance(imageData, x, y, 1)

    // Definite FG: dark, warm, or clearly chromatic and far from card.
    if (L < 80 && c < 40) {
      ref.data[i] = REF_FG
      continue
    }
    if (isWarm(rgb, L) && d >= 18) {
      ref.data[i] = REF_FG
      continue
    }
    if (c >= 28 && L <= studioLuma - 20 && d >= 22) {
      ref.data[i] = REF_FG
      continue
    }
    // Textured mid fabric clearly off-card.
    if (d >= 45 && L < studioLuma - 25 && variance > 12) {
      ref.data[i] = REF_FG
      continue
    }

    // Remaining near-card / pale / soft-shadow → uncertain (not scored).
    ref.data[i] = REF_UNCERTAIN
  }

  return ref
}

export type ReferenceCoverage = {
  definiteFg: number
  definiteBg: number
  uncertain: number
  uncertainRatio: number
  notes: string[]
}

export function summarizeReferenceCoverage(
  ref: MaskPixelBuffer,
): ReferenceCoverage {
  let definiteFg = 0
  let definiteBg = 0
  let uncertain = 0
  for (let i = 0; i < ref.data.length; i += 1) {
    const v = ref.data[i]!
    if (v === REF_FG) definiteFg += 1
    else if (v === REF_BG) definiteBg += 1
    else uncertain += 1
  }
  const total = ref.data.length
  const notes: string[] = [
    'Reference is appearance+border derived, not manual pixel paint.',
    'White leather / pale tee vs studio card is UNCERTAIN — binary FG recall on sneakers/tees is not fully reliable.',
    'Soft contact shadows and thin AA rings are UNCERTAIN.',
    'Full IoU/Dice over the whole image is not claimed; scores use definite labels only.',
  ]
  return {
    definiteFg,
    definiteBg,
    uncertain,
    uncertainRatio: +(uncertain / total).toFixed(4),
    notes,
  }
}
