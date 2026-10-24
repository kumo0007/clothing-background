/**
 * Pure mask/image measurements for diagnostics. Never mutates the mask.
 */
import type { MaskPixelBuffer } from '../../../types/mask'
import { averageCornerColor, localLumaVariance } from '../selectSimilar'
import { analyzeKeepComponents } from './fragmentation'
import type { MaskMetricSnapshot } from './types'

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

export function borderBandWidth(width: number, height: number): number {
  return Math.max(2, Math.floor(Math.min(width, height) * 0.03))
}

/**
 * 4-connected KEEP components (alpha >= 128).
 * Specks smaller than `minSize` are ignored so JPEG/Lab noise does not look
 * like garment fragmentation; straps/handles above minSize still count.
 */
export function countKeepComponents(
  mask: MaskPixelBuffer,
  minSize = 12,
): {
  count: number
  largestShare: number
} {
  const { width, height, data } = mask
  const n = width * height
  const seen = new Uint8Array(n)
  let count = 0
  let largest = 0
  let keep = 0
  const stack: number[] = []

  for (let i = 0; i < n; i += 1) {
    if (data[i]! >= 128) keep += 1
  }

  for (let i = 0; i < n; i += 1) {
    if (seen[i] || data[i]! < 128) continue
    let size = 0
    stack.length = 0
    stack.push(i)
    seen[i] = 1
    while (stack.length > 0) {
      const cur = stack.pop()!
      size += 1
      const x = cur % width
      const y = (cur / width) | 0
      // Row-major: vertical neighbors are ±width (NOT ±height).
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
    if (size < minSize) continue
    count += 1
    if (size > largest) largest = size
  }

  return {
    count,
    largestShare: keep > 0 ? largest / keep : 0,
  }
}

/**
 * Interior holes: REMOVE pixels not flood-reachable from the frame through REMOVE.
 * Handbag openings and strap gaps are legitimate; high ratios warrant inspection.
 */
export function internalHoleRatio(mask: MaskPixelBuffer, thr = 128): number {
  const { width, height, data } = mask
  const n = width * height
  const outside = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0

  const enq = (i: number) => {
    if (outside[i] || data[i]! >= thr) return
    outside[i] = 1
    queue[tail++] = i
  }

  for (let x = 0; x < width; x += 1) {
    enq(x)
    enq((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    enq(y * width)
    enq(y * width + (width - 1))
  }

  while (head < tail) {
    const i = queue[head++]!
    const x = i % width
    const y = (i / width) | 0
    if (x > 0) enq(i - 1)
    if (x + 1 < width) enq(i + 1)
    if (y > 0) enq(i - width)
    if (y + 1 < height) enq(i + width)
  }

  let holes = 0
  for (let i = 0; i < n; i += 1) {
    if (data[i]! < thr && !outside[i]) holes += 1
  }
  return holes / Math.max(1, n)
}

export function computeMaskMetrics(
  mask: MaskPixelBuffer,
  imageData: ImageData | undefined,
  options: { neuralFringeBorderOnly?: boolean } = {},
): MaskMetricSnapshot {
  const width = mask.width
  const height = mask.height
  const pixels = width * height
  const band = borderBandWidth(width, height)
  const colorAware =
    !!imageData &&
    imageData.width === width &&
    imageData.height === height

  let keepCount = 0
  let softCount = 0
  let bgCount = 0
  let darkKeep = 0
  let paleKeepNearCard = 0
  let brightKeepEdge = 0
  let borderPix = 0
  let borderKeepCount = 0
  let borderStudioKeepCount = 0
  let frameTouchKeepCount = 0

  let studioLuma = 220
  if (colorAware) {
    const corner = averageCornerColor(imageData!)
    studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const v = mask.data[i]!
      if (v >= 128) keepCount += 1
      else bgCount += 1
      if (v > 0 && v < 200) softCount += 1

      const onBorder =
        x < band || y < band || x >= width - band || y >= height - band
      const onFrame =
        x === 0 || y === 0 || x === width - 1 || y === height - 1

      if (onBorder) {
        borderPix += 1
        if (v >= 128) borderKeepCount += 1
      }
      if (onFrame && v >= 128) frameTouchKeepCount += 1

      if (v < 128 || !colorAware) continue

      const L = lumaAt(imageData!, x, y)
      const c = chromaAt(imageData!, x, y)
      if (L < 100) darkKeep += 1
      if (L >= studioLuma - 4 && c <= 24) paleKeepNearCard += 1

      if (onBorder && L >= studioLuma - 6 && c <= 28) {
        borderStudioKeepCount += 1
      }

      const touchesRemove =
        (x > 0 && mask.data[i - 1]! < 128) ||
        (x + 1 < width && mask.data[i + 1]! < 128) ||
        (y > 0 && mask.data[i - width]! < 128) ||
        (y + 1 < height && mask.data[i + width]! < 128)

      const fringeEligible = options.neuralFringeBorderOnly ? onBorder : true
      if (
        fringeEligible &&
        touchesRemove &&
        L >= Math.max(185, studioLuma - 8) &&
        c <= 22 &&
        localLumaVariance(imageData!, x, y, 1) <= 14
      ) {
        brightKeepEdge += 1
      }
    }
  }

  const frag = analyzeKeepComponents(mask)
  const holes = internalHoleRatio(mask)

  return {
    width,
    height,
    pixels,
    keepCount,
    bgCount,
    softCount,
    keepRatio: keepCount / Math.max(1, pixels),
    softRatio: softCount / Math.max(1, pixels),
    bgRatio: bgCount / Math.max(1, pixels),
    borderBandPx: band,
    borderKeepCount,
    borderKeepRatio: borderPix > 0 ? borderKeepCount / borderPix : 0,
    borderStudioKeepCount,
    borderStudioRatio:
      borderPix > 0 ? borderStudioKeepCount / borderPix : 0,
    frameTouchKeepCount,
    // Significant only — raw dust lives in fragmentation.totalComponents.
    keepComponentCount: frag.summary.significantComponents,
    largestKeepShare: frag.summary.largestAreaShare,
    fragmentation: frag.summary,
    internalHoleRatio: holes,
    paleAmongKeep: keepCount > 0 ? paleKeepNearCard / keepCount : 0,
    darkShareAmongKeep: keepCount > 0 ? darkKeep / keepCount : 0,
    edgeHaloRatio: keepCount > 0 ? brightKeepEdge / keepCount : 0,
    studioLuma,
    colorAware,
  }
}

/** Collect sample KEEP indices in the border band that look studio-like. */
export function sampleBorderStudioIndices(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  maxSamples = 64,
): number[] {
  const { width, height } = mask
  const band = borderBandWidth(width, height)
  const corner = averageCornerColor(imageData)
  const studioLuma =
    0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const out: number[] = []
  for (let y = 0; y < height && out.length < maxSamples; y += 1) {
    for (let x = 0; x < width && out.length < maxSamples; x += 1) {
      const onBorder =
        x < band || y < band || x >= width - band || y >= height - band
      if (!onBorder) continue
      const i = y * width + x
      if (mask.data[i]! < 128) continue
      const L = lumaAt(imageData, x, y)
      const c = chromaAt(imageData, x, y)
      if (L >= studioLuma - 6 && c <= 28) out.push(i)
    }
  }
  return out
}
