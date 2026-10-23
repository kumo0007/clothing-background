/**
 * Competing geodesic assignment for near-card pale pixels.
 *
 * Structure seeds (dark / chromatic / warm KEEP) compete with exterior
 * background seeds (border-connected studio). Pale closer to structure → KEEP;
 * pale closer to exterior → REMOVE.
 *
 * Self-contained helpers (no import from selectSimilar) to avoid cycles.
 */
import type { MaskPixelBuffer } from '../../types/mask'

type Rgb = { r: number; g: number; b: number }

const INF = 32767

function readRgb(imageData: ImageData, x: number, y: number): Rgb {
  const o = (y * imageData.width + x) * 4
  return {
    r: imageData.data[o]!,
    g: imageData.data[o + 1]!,
    b: imageData.data[o + 2]!,
  }
}

function luminanceAt(imageData: ImageData, x: number, y: number): number {
  const o = (y * imageData.width + x) * 4
  return (
    0.299 * imageData.data[o]! +
    0.587 * imageData.data[o + 1]! +
    0.114 * imageData.data[o + 2]!
  )
}

function localLumaVariance(
  imageData: ImageData,
  x: number,
  y: number,
  radius = 1,
): number {
  const width = imageData.width
  const height = imageData.height
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let dy = -radius; dy <= radius; dy += 1) {
    const yy = Math.min(height - 1, Math.max(0, y + dy))
    for (let dx = -radius; dx <= radius; dx += 1) {
      const xx = Math.min(width - 1, Math.max(0, x + dx))
      const value = luminanceAt(imageData, xx, yy)
      sum += value
      sumSq += value * value
      count += 1
    }
  }
  const mean = sum / count
  return sumSq / count - mean * mean
}

/** Robust studio estimate: median of a thin border ring (not 4 corners). */
function averageCornerColor(imageData: ImageData): Rgb {
  const w = imageData.width
  const h = imageData.height
  const band = Math.max(1, Math.min(4, Math.floor(Math.min(w, h) * 0.015)))
  const samples: Rgb[] = []
  const push = (x: number, y: number) => {
    const rgb = readRgb(imageData, x, y)
    const L = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
    // Skip dark garment / chrome that contaminates corner samples.
    if (L < 160 || L > 250) return
    if (chromaOf(rgb) > 36) return
    samples.push(rgb)
  }
  for (let x = 0; x < w; x += 2) {
    for (let y = 0; y < band; y += 1) push(x, y)
    for (let y = h - band; y < h; y += 1) push(x, y)
  }
  for (let y = band; y < h - band; y += 2) {
    for (let x = 0; x < band; x += 1) push(x, y)
    for (let x = w - band; x < w; x += 1) push(x, y)
  }
  if (samples.length < 8) {
    const fallback = [
      readRgb(imageData, 1, 1),
      readRgb(imageData, w - 2, 1),
      readRgb(imageData, 1, h - 2),
      readRgb(imageData, w - 2, h - 2),
    ]
    let r = 0
    let g = 0
    let b = 0
    for (const rgb of fallback) {
      r += rgb.r
      g += rgb.g
      b += rgb.b
    }
    return { r: r / 4, g: g / 4, b: b / 4 }
  }
  samples.sort((a, b) => a.r + a.g + a.b - (b.r + b.g + b.b))
  const mid = samples[Math.floor(samples.length / 2)]!
  return { r: mid.r, g: mid.g, b: mid.b }
}

function chromaOf(rgb: Rgb): number {
  return Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)
}

function isNearNeutral(rgb: Rgb, maxChroma = 18): boolean {
  return chromaOf(rgb) <= maxChroma
}

function isWarmGarmentFabric(rgb: Rgb, luma: number): boolean {
  const chroma = chromaOf(rgb)
  return rgb.r > rgb.b + 12 && chroma >= 16 && luma >= 130 && luma <= 220
}

function isStructurePixel(
  imageData: ImageData,
  x: number,
  y: number,
  studioLuma: number,
): boolean {
  const rgb = readRgb(imageData, x, y)
  const L = luminanceAt(imageData, x, y)
  if (L < 100) return true
  if (isWarmGarmentFabric(rgb, L)) return true
  if (chromaOf(rgb) >= 18 && L <= studioLuma - 12) return true
  return false
}

function isPaleCapable(
  imageData: ImageData,
  x: number,
  y: number,
  studioLuma: number,
  _corner: Rgb,
): boolean {
  const rgb = readRgb(imageData, x, y)
  const L = luminanceAt(imageData, x, y)
  if (isWarmGarmentFabric(rgb, L)) return false
  // Near-card neutrals (leather + studio). Looser than strip thresholds so
  // competition can see the pixels it must decide between.
  if (L < Math.max(170, studioLuma - 12)) return false
  if (!isNearNeutral(rgb, 32)) return false
  if (L > studioLuma + 30) return false
  return true
}

function bfsDistance(
  width: number,
  height: number,
  seeds: number[],
  canTraverse: (i: number) => boolean,
  maxDist: number,
): Int16Array {
  const dist = new Int16Array(width * height)
  dist.fill(INF)
  const queue = seeds.slice()
  for (const s of queue) dist[s] = 0
  let head = 0
  while (head < queue.length) {
    const i = queue[head++]!
    const d0 = dist[i]!
    if (d0 >= maxDist) continue
    const x = i % width
    const y = (i / width) | 0
    for (const n of [
      x > 0 ? i - 1 : -1,
      x + 1 < width ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y + 1 < height ? i + width : -1,
    ]) {
      if (n < 0 || dist[n]! < INF) continue
      if (!canTraverse(n)) continue
      dist[n] = d0 + 1
      queue.push(n)
    }
  }
  return dist
}

export type PaleCompetitionResult = {
  assignedKeep: number
  assignedRemove: number
  ambiguousPaleScene: boolean
  debug?: {
    paleKeepShare: number
    warmShare: number
    darkKeep: number
    paleKeepTouchingDark: number
    minDark: number
    minPaleTouch: number
  }
}

/**
 * Assign near-card pale pixels by competing geodesics from structure vs exterior.
 * Mutates mask only. Never touches source RGB.
 */
export function applyPaleCompetition(
  mask: MaskPixelBuffer,
  imageData: ImageData,
): PaleCompetitionResult {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const borderBand = Math.max(2, Math.floor(Math.min(width, height) * 0.02))
  const maxDist = Math.max(
    48,
    Math.min(120, Math.floor(Math.min(width, height) * 0.45)),
  )

  const structureSeeds: number[] = []
  const exteriorSeeds: number[] = []
  let darkKeep = 0
  let warmKeep = 0
  let keepCount = 0
  let paleKeep = 0
  let paleKeepTouchingDark = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (mask.data[i]! >= 128) {
        keepCount += 1
        const pale = isPaleCapable(imageData, x, y, studioLuma, corner)
        if (pale) paleKeep += 1
        if (isStructurePixel(imageData, x, y, studioLuma)) {
          structureSeeds.push(i)
          const L = luminanceAt(imageData, x, y)
          if (L < 100) darkKeep += 1
          if (isWarmGarmentFabric(readRgb(imageData, x, y), L)) warmKeep += 1
        }
        if (pale) {
          let touchDark = false
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
            [0, -2],
            [0, 2],
            [-2, 0],
            [2, 0],
          ] as const) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const ni = ny * width + nx
            if (mask.data[ni]! < 128) continue
            if (luminanceAt(imageData, nx, ny) < 110) {
              touchDark = true
              break
            }
          }
          if (touchDark) paleKeepTouchingDark += 1
        }
      }
      const onBorder =
        x < borderBand ||
        y < borderBand ||
        x >= width - borderBand ||
        y >= height - borderBand
      if (!onBorder) continue
      if (mask.data[i]! < 128) {
        exteriorSeeds.push(i)
        continue
      }
      if (
        isPaleCapable(imageData, x, y, studioLuma, corner) &&
        !isStructurePixel(imageData, x, y, studioLuma)
      ) {
        exteriorSeeds.push(i)
      }
    }
  }

  const paleKeepShare = keepCount > 0 ? paleKeep / keepCount : 0
  const warmShare = keepCount > 0 ? warmKeep / keepCount : 0
  const minDark = Math.max(80, Math.floor(width * height * 0.012))
  // Soft AA often separates leather from L<100 soles — require only a few
  // contacts plus high pale KEEP share (sneaker signature).
  const minPaleTouch = Math.max(8, Math.floor(width * height * 0.0004))
  // Gate on pale KEEP next to dark structure. Use warm *share* (not vs dark
  // count) — sneakers can have tan logos with warmKeep ≈ darkKeep while still
  // being white-leather scenes; coats have high warmShare.
  // Sneakers/tees: majority of KEEP is near-card pale. Jeans/coats keep mostly
  // dark/chromatic mass — do not run competition there.
  const ambiguousPaleScene =
    paleKeepShare >= 0.35 &&
    paleKeepTouchingDark >= minPaleTouch &&
    darkKeep >= minDark &&
    warmShare < 0.08

  const debug = {
    paleKeepShare,
    warmShare,
    darkKeep,
    paleKeepTouchingDark,
    minDark,
    minPaleTouch,
  }
  if (structureSeeds.length === 0 || exteriorSeeds.length === 0) {
    return { assignedKeep: 0, assignedRemove: 0, ambiguousPaleScene, debug }
  }
  if (!ambiguousPaleScene) {
    return {
      assignedKeep: 0,
      assignedRemove: 0,
      ambiguousPaleScene: false,
      debug,
    }
  }

  const canTraverseStructure = (i: number): boolean => {
    const x = i % width
    const y = (i / width) | 0
    if (isStructurePixel(imageData, x, y, studioLuma) && mask.data[i]! >= 128) {
      return true
    }
    return isPaleCapable(imageData, x, y, studioLuma, corner)
  }
  // Exterior must go around garment structure — never shortcut through soles.
  const canTraverseExterior = (i: number): boolean => {
    const x = i % width
    const y = (i / width) | 0
    if (isStructurePixel(imageData, x, y, studioLuma) && mask.data[i]! >= 128) {
      return false
    }
    return isPaleCapable(imageData, x, y, studioLuma, corner)
  }

  const distS = bfsDistance(
    width,
    height,
    structureSeeds,
    canTraverseStructure,
    maxDist,
  )
  const distE = bfsDistance(
    width,
    height,
    exteriorSeeds,
    canTraverseExterior,
    maxDist,
  )

  let assignedKeep = 0
  let assignedRemove = 0

  for (let y = borderBand; y < height - borderBand; y += 1) {
    for (let x = borderBand; x < width - borderBand; x += 1) {
      const i = y * width + x
      if (!isPaleCapable(imageData, x, y, studioLuma, corner)) continue
      if (isStructurePixel(imageData, x, y, studioLuma)) continue

      const ds = distS[i]!
      const de = distE[i]!
      if (ds >= INF && de >= INF) continue

      const L = luminanceAt(imageData, x, y)
      const variance = localLumaVariance(imageData, x, y, 1)
      const lift = L - studioLuma
      const flatNearCard = variance <= 6 && lift <= 1.5

      // Flat near-card still prefers structure when clearly nearer; a large
      // margin was rejecting real leather panels mid-shoe.
      const structureWins = flatNearCard
        ? ds < INF && ds + 4 < de
        : ds < INF && (de >= INF || ds + 1 < de)

      // Require a clearer exterior margin before clearing opaque pale KEEP —
      // leather panels are flat near-card and must not lose tight races.
      const exteriorWins =
        de < INF &&
        (ds >= INF || de + (flatNearCard ? 6 : 2) < ds)

      if (structureWins) {
        if (mask.data[i]! < 255) {
          mask.data[i] = 255
          assignedKeep += 1
        }
      } else if (exteriorWins && mask.data[i]! >= 128) {
        if (mask.data[i]! < 230 || (flatNearCard && de + 6 < ds)) {
          mask.data[i] = 0
          assignedRemove += 1
        }
      }
    }
  }

  return { assignedKeep, assignedRemove, ambiguousPaleScene, debug }
}

/**
 * Mark pale KEEP closer to structure than exterior — protect from studio strips.
 */
export function markCompetitionProtectedPale(
  mask: MaskPixelBuffer,
  imageData: ImageData,
): Uint8Array {
  const width = mask.width
  const height = mask.height
  const corner = averageCornerColor(imageData)
  const studioLuma = 0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b
  const borderBand = Math.max(2, Math.floor(Math.min(width, height) * 0.02))
  const maxDist = Math.max(
    40,
    Math.min(100, Math.floor(Math.min(width, height) * 0.4)),
  )
  const protectedPale = new Uint8Array(width * height)

  const structureSeeds: number[] = []
  const exteriorSeeds: number[] = []
  let darkKeep = 0
  let warmKeep = 0
  let keepCount = 0
  let paleKeep = 0
  let paleKeepTouchingDark = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (mask.data[i]! >= 128) {
        keepCount += 1
        const pale = isPaleCapable(imageData, x, y, studioLuma, corner)
        if (pale) paleKeep += 1
        if (isStructurePixel(imageData, x, y, studioLuma)) {
          structureSeeds.push(i)
          const L = luminanceAt(imageData, x, y)
          if (L < 100) darkKeep += 1
          if (isWarmGarmentFabric(readRgb(imageData, x, y), L)) warmKeep += 1
        }
        if (pale) {
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
            [0, -2],
            [0, 2],
            [-2, 0],
            [2, 0],
          ] as const) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
            const ni = ny * width + nx
            if (mask.data[ni]! < 128) continue
            if (luminanceAt(imageData, nx, ny) < 110) {
              paleKeepTouchingDark += 1
              break
            }
          }
        }
      }
      const onBorder =
        x < borderBand ||
        y < borderBand ||
        x >= width - borderBand ||
        y >= height - borderBand
      if (onBorder && mask.data[i]! < 128) exteriorSeeds.push(i)
    }
  }
  const paleKeepShare = keepCount > 0 ? paleKeep / keepCount : 0
  const warmShare = keepCount > 0 ? warmKeep / keepCount : 0
  const minDark = Math.max(80, Math.floor(width * height * 0.012))
  const minPaleTouch = Math.max(8, Math.floor(width * height * 0.0004))
  if (
    structureSeeds.length === 0 ||
    paleKeepShare < 0.35 ||
    paleKeepTouchingDark < minPaleTouch ||
    darkKeep < minDark ||
    warmShare >= 0.08
  ) {
    return protectedPale
  }

  const canTraverseStructure = (i: number): boolean => {
    const x = i % width
    const y = (i / width) | 0
    if (mask.data[i]! < 128) return false
    if (isStructurePixel(imageData, x, y, studioLuma)) return true
    return isPaleCapable(imageData, x, y, studioLuma, corner)
  }
  const canTraverseExterior = (i: number): boolean => {
    const x = i % width
    const y = (i / width) | 0
    if (mask.data[i]! < 128) {
      return isPaleCapable(imageData, x, y, studioLuma, corner)
    }
    if (isStructurePixel(imageData, x, y, studioLuma)) return false
    return isPaleCapable(imageData, x, y, studioLuma, corner)
  }

  const distS = bfsDistance(
    width,
    height,
    structureSeeds,
    canTraverseStructure,
    maxDist,
  )
  const distE =
    exteriorSeeds.length > 0
      ? bfsDistance(width, height, exteriorSeeds, canTraverseExterior, maxDist)
      : null

  for (let i = 0; i < width * height; i += 1) {
    if (mask.data[i]! < 128) continue
    const x = i % width
    const y = (i / width) | 0
    if (
      x < borderBand ||
      y < borderBand ||
      x >= width - borderBand ||
      y >= height - borderBand
    ) {
      continue
    }
    if (!isPaleCapable(imageData, x, y, studioLuma, corner)) continue
    const ds = distS[i]!
    if (ds >= INF) continue
    const de = distE ? distE[i]! : INF
    const L = luminanceAt(imageData, x, y)
    const variance = localLumaVariance(imageData, x, y, 1)
    const flatNearCard = variance <= 6 && L <= studioLuma + 1.5
    if (flatNearCard ? ds + 4 < de : ds + 1 < de || de >= INF) {
      protectedPale[i] = 1
    }
  }
  return protectedPale
}
