/**
 * Conservative BiRefNet post-pass: peel textured carpet/backdrop KEEP that is
 * border-connected, without eroding bright white fabric or thin dark objects
 * (measuring tape, tags, seams).
 *
 * Never mutates source RGB. Returns a new mask buffer (or the same reference
 * when no change). Callers must still mark hard cases for review.
 */
import type { MaskPixelBuffer } from '../../../types/mask'
import { averageCornerColor, localLumaVariance } from '../selectSimilar'

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

function keepCount(mask: MaskPixelBuffer): number {
  let n = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! >= 128) n += 1
  }
  return n
}

/** Bright / low-chroma fabric — shirt body, collar, logos. */
function isBrightGarmentPixel(
  imageData: ImageData,
  x: number,
  y: number,
): boolean {
  const L = lumaAt(imageData, x, y)
  const c = chromaAt(imageData, x, y)
  if (L >= 220 && c <= 36) return true
  if (L >= 200 && c <= 28 && localLumaVariance(imageData, x, y, 1) <= 40) {
    return true
  }
  return false
}

/**
 * Thin dark foreground (tape, stitching, numerals) — protect from carpet peel.
 * High local contrast vs brighter neighbors, not mid-beige carpet.
 */
function isThinDarkForeground(
  imageData: ImageData,
  x: number,
  y: number,
): boolean {
  const L = lumaAt(imageData, x, y)
  if (L > 140) return false
  const c = chromaAt(imageData, x, y)
  if (c > 48) return false
  // Prefer elongated / high-contrast marks over broad dark garment panels.
  let brighter = 0
  let neighbors = 0
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= imageData.width ||
        ny >= imageData.height
      ) {
        continue
      }
      neighbors += 1
      if (lumaAt(imageData, nx, ny) >= L + 28) brighter += 1
    }
  }
  return neighbors >= 8 && brighter >= 4
}

/** Textured beige/gray carpet or backdrop that should not stay KEEP. */
function isTexturedBackdropPixel(
  imageData: ImageData,
  x: number,
  y: number,
  studioLuma: number,
): boolean {
  if (isBrightGarmentPixel(imageData, x, y)) return false
  if (isThinDarkForeground(imageData, x, y)) return false
  const L = lumaAt(imageData, x, y)
  const c = chromaAt(imageData, x, y)
  const v = localLumaVariance(imageData, x, y, 1)
  // Mid-tone textured carpet / card near studio estimate.
  if (L < 110 || L > 235) return false
  if (Math.abs(L - studioLuma) > 55 && L > 190) return false
  if (v < 18) return false
  if (c > 55) return false
  return true
}

export type TexturedBorderLeakResult = {
  mask: MaskPixelBuffer
  stripped: number
  applied: boolean
  reason: string
}

/**
 * Border-connected textured backdrop peel. Rejects if KEEP would shrink >5%.
 */
export function refineTexturedBorderLeak(
  mask: MaskPixelBuffer,
  imageData: ImageData,
): TexturedBorderLeakResult {
  if (
    imageData.width !== mask.width ||
    imageData.height !== mask.height
  ) {
    return {
      mask,
      stripped: 0,
      applied: false,
      reason: 'RGB/mask dimension mismatch — skipped textured border refine',
    }
  }

  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma =
    0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const before = keepCount(mask)
  if (before < 64) {
    return {
      mask,
      stripped: 0,
      applied: false,
      reason: 'KEEP too small — skipped',
    }
  }

  const out: MaskPixelBuffer = {
    width,
    height,
    data: new Uint8ClampedArray(mask.data),
  }
  const visited = new Uint8Array(width * height)
  const queue: number[] = []
  let stripped = 0

  const trySeed = (x: number, y: number) => {
    const i = y * width + x
    if (visited[i]) return
    visited[i] = 1
    const a = out.data[i]!
    if (a >= 128 && isTexturedBackdropPixel(imageData, x, y, studioLuma)) {
      out.data[i] = 0
      stripped += 1
      queue.push(i)
      return
    }
    if (a < 128) queue.push(i)
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
    const index = queue[head++]!
    const x = index % width
    const y = (index / width) | 0
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y + 1 < height ? index + width : -1,
    ]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || visited[neighbor]) continue
      visited[neighbor] = 1
      const nx = neighbor % width
      const ny = (neighbor / width) | 0
      const a = out.data[neighbor]!
      if (a >= 128 && isTexturedBackdropPixel(imageData, nx, ny, studioLuma)) {
        out.data[neighbor] = 0
        stripped += 1
        queue.push(neighbor)
      } else if (a < 96) {
        if (a > 0) {
          out.data[neighbor] = 0
          stripped += 1
        }
        queue.push(neighbor)
      }
    }
  }

  const after = keepCount(out)
  if (stripped < 8) {
    return {
      mask,
      stripped: 0,
      applied: false,
      reason: 'No meaningful textured border leak',
    }
  }
  // Align with border-studio peel safety (~8%); textured carpet rings can be
  // larger than 5% while still being pure backdrop.
  if (after < before * 0.9) {
    return {
      mask,
      stripped,
      applied: false,
      reason: `Rejected textured peel — would shrink KEEP by >10% (${before}→${after})`,
    }
  }

  return {
    mask: out,
    stripped,
    applied: true,
    reason: `Peeled ${stripped} textured border KEEP px (carpet/backdrop)`,
  }
}
