/**
 * Evidence-guided refinement for ISNet masks.
 *
 * ISNet remains the primary inference engine. Lab-seed and contour-style
 * geometry are supporting signals only — never a silent engine swap.
 *
 * Typical failure modes (fixture-agnostic):
 * - False-REMOVE corridors that sever a garment into stacked components
 *   (Lab KEEP + non-studio color → reclaim).
 * - Under-recall of chromatic / warm fabric adjacent to ISNet KEEP
 *   (Lab KEEP + garment-like + adjacency → localized grow).
 * - Border-connected studio KEEP contamination
 *   (Lab REMOVE + studio-like + exterior touch → strip).
 *
 * Never mutates source ImageData RGB. Mask polarity: 255 KEEP / 0 REMOVE.
 */
import type { MaskPixelBuffer } from '../../types/mask'
import { cloneMaskBuffer } from './createMask'
import { estimateMaskConfidence } from './maskConfidence'
import { segmentGarmentBySeeds } from './opencv/segmentSeeds'
import { validateContourCandidate } from './contourFirst/contourFirstSegment'
import {
  averageCornerColor,
  localLumaVariance,
  peelExteriorStudioKeep,
  stripBorderTouchingStudioComponents,
} from './selectSimilar'

export type IsnetRefineCategory =
  | 'none'
  | 'corridor-severance'
  | 'under-recall'
  | 'exterior-dark-bite'
  | 'studio-strip'
  | 'mixed'

export type IsnetRefineDiagnostics = {
  initialFgRatio: number
  finalFgRatio: number
  deltaFgRatio: number
  initialComponentCount: number
  finalComponentCount: number
  initialInternalHoleRatio: number
  finalInternalHoleRatio: number
  labAgreement: number
  labBgContaminationRate: number
  contourReliableBgContamination: number
  contourInternalHoleRatio: number
  contourBorderTouchRatio: number
  pixelsReclaimed: number
  pixelsStripped: number
  changedPixelCount: number
  changedBBox: {
    minX: number
    minY: number
    maxX: number
    maxY: number
  } | null
  refinementAttempted: boolean
  refinementAccepted: boolean
  refinementCategory: IsnetRefineCategory
  acceptReason?: string
  rejectReason?: string
  failureModes: string[]
  gateValues: {
    deltaFg: number
    corridorReclaimed: number
    underRecallReclaimed: number
    darkBiteReclaimed: number
    stripped: number
    verticalStackSeverance: boolean
    sideBySideMergeBlocked: boolean
    cardShapedExpansionBlocked: boolean
  }
  confidenceBefore: number
  confidenceAfter: number
  /** Always the inference engine — refinement does not change this. */
  inferenceEngine: 'isnet-onnx'
  /** Ops attempted on the candidate (kept even when rejected). */
  refinementOps: string[]
}

type ComponentInfo = {
  indices: number[]
  size: number
  minX: number
  maxX: number
  minY: number
  maxY: number
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

function colorDistToCorner(
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

function isStudioLike(
  imageData: ImageData,
  x: number,
  y: number,
  corner: { r: number; g: number; b: number },
  studioLuma: number,
): boolean {
  const L = lumaAt(imageData, x, y)
  const c = chromaAt(imageData, x, y)
  const d = colorDistToCorner(imageData, x, y, corner)
  return L >= studioLuma - 10 && c <= 28 && d <= 48 && L >= 175
}

function isGarmentLike(
  imageData: ImageData,
  x: number,
  y: number,
  corner: { r: number; g: number; b: number },
  studioLuma: number,
): boolean {
  const L = lumaAt(imageData, x, y)
  const c = chromaAt(imageData, x, y)
  const o = (y * imageData.width + x) * 4
  const r = imageData.data[o]!
  const g = imageData.data[o + 1]!
  const b = imageData.data[o + 2]!
  // Warm fabric (coat / hoodie beige) — not near-card grey.
  const warm = r > g + 8 && r > b + 8 && c >= 12 && L < studioLuma - 8
  const dark = L < 100
  const chromatic = c >= 22
  const textured = localLumaVariance(imageData, x, y, 1) > 18
  const farFromCard = colorDistToCorner(imageData, x, y, corner) > 36
  if (isStudioLike(imageData, x, y, corner, studioLuma)) return false
  return warm || dark || chromatic || (textured && farFromCard && L < studioLuma - 4)
}

function fgRatio(mask: MaskPixelBuffer, thr = 128): number {
  let k = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! >= thr) k += 1
  }
  return k / mask.data.length
}

function labelKeepComponents(
  mask: MaskPixelBuffer,
  thr = 128,
): ComponentInfo[] {
  const { width, height, data } = mask
  const seen = new Uint8Array(data.length)
  const out: ComponentInfo[] = []
  for (let start = 0; start < data.length; start += 1) {
    if (seen[start] || data[start]! < thr) continue
    const indices: number[] = []
    const queue = [start]
    seen[start] = 1
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0
    let head = 0
    while (head < queue.length) {
      const i = queue[head++]!
      indices.push(i)
      const x = i % width
      const y = (i / width) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ]
      for (const n of neighbors) {
        if (n < 0 || seen[n] || data[n]! < thr) continue
        seen[n] = 1
        queue.push(n)
      }
    }
    out.push({
      indices,
      size: indices.length,
      minX,
      maxX,
      minY,
      maxY,
    })
  }
  out.sort((a, b) => b.size - a.size)
  return out
}

function internalHoleRatio(mask: MaskPixelBuffer, thr = 128): number {
  const { width, height, data } = mask
  const outside = new Uint8Array(data.length)
  const queue = new Int32Array(data.length)
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
  for (let i = 0; i < data.length; i += 1) {
    if (data[i]! < thr && !outside[i]) holes += 1
  }
  return holes / data.length
}

function labAgreementRate(
  isnet: MaskPixelBuffer,
  lab: MaskPixelBuffer,
  thr = 128,
): number {
  let agree = 0
  for (let i = 0; i < isnet.data.length; i += 1) {
    const a = isnet.data[i]! >= thr
    const b = lab.data[i]! >= thr
    if (a === b) agree += 1
  }
  return agree / isnet.data.length
}

function labBgContaminationRate(
  isnet: MaskPixelBuffer,
  lab: MaskPixelBuffer,
  imageData: ImageData,
  corner: { r: number; g: number; b: number },
  studioLuma: number,
  thr = 128,
): number {
  let keep = 0
  let bad = 0
  const { width } = isnet
  for (let i = 0; i < isnet.data.length; i += 1) {
    if (isnet.data[i]! < thr) continue
    keep += 1
    if (lab.data[i]! >= thr) continue
    const x = i % width
    const y = (i / width) | 0
    if (isStudioLike(imageData, x, y, corner, studioLuma)) bad += 1
  }
  return keep > 0 ? bad / keep : 0
}

function isVerticalStack(a: ComponentInfo, b: ComponentInfo): boolean {
  const upper = a.maxY < b.minY ? a : b.maxY < a.minY ? b : null
  const lower = upper === a ? b : upper === b ? a : null
  if (!upper || !lower) return false
  if (lower.minY - upper.maxY < 2) return false
  // Require horizontal overlap so side-by-side shoes are not treated as severance.
  const overlap =
    Math.min(upper.maxX, lower.maxX) - Math.max(upper.minX, lower.minX)
  const minW = Math.min(upper.maxX - upper.minX, lower.maxX - lower.minX) + 1
  return overlap >= minW * 0.35
}

function isHorizontalGapPixel(
  x: number,
  y: number,
  comps: ComponentInfo[],
): boolean {
  if (comps.length < 2) return false
  const a = comps[0]!
  const b = comps[1]!
  const left = a.maxX < b.minX ? a : b.maxX < a.minX ? b : null
  const right = left === a ? b : left === b ? a : null
  if (!left || !right) return false
  if (x <= left.maxX || x >= right.minX) return false
  // Only block when y overlaps both component bands (gap between shoes).
  const yLo = Math.max(left.minY, right.minY)
  const yHi = Math.min(left.maxY, right.maxY)
  return y >= yLo && y <= yHi
}

/**
 * Reclaim false-REMOVE corridors between vertically stacked KEEP components
 * when Lab + color evidence say garment (hoodie hem-severance pattern).
 * Never bridges horizontally separated products (sneakers).
 */
function reclaimSeveranceCorridors(
  mask: MaskPixelBuffer,
  lab: MaskPixelBuffer,
  imageData: ImageData,
  corner: { r: number; g: number; b: number },
  studioLuma: number,
): { painted: number; verticalStack: boolean } {
  const comps = labelKeepComponents(mask).filter(
    (c) => c.size >= Math.max(80, mask.data.length * 0.0008),
  )
  if (comps.length < 2) return { painted: 0, verticalStack: false }
  const a = comps[0]!
  const b = comps[1]!
  if (!isVerticalStack(a, b)) return { painted: 0, verticalStack: false }
  const upper = a.maxY < b.minY ? a : b
  const lower = upper === a ? b : a
  const { width, data } = mask
  const minX = Math.max(0, Math.min(upper.minX, lower.minX) - 2)
  const maxX = Math.min(width - 1, Math.max(upper.maxX, lower.maxX) + 2)
  const y0 = upper.maxY + 1
  const y1 = lower.minY - 1
  // Corridor must be a thin cut, not a huge void (card / between products).
  if (y1 - y0 > Math.max(28, Math.floor(mask.height * 0.12))) {
    return { painted: 0, verticalStack: true }
  }
  let painted = 0
  for (let y = y0; y <= y1; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const i = y * width + x
      if (data[i]! >= 128) continue
      if (isStudioLike(imageData, x, y, corner, studioLuma)) continue
      const labKeep = lab.data[i]! >= 128
      const garment = isGarmentLike(imageData, x, y, corner, studioLuma)
      // Prefer dual evidence; allow Lab-only or garment-only when not studio.
      if (!labKeep && !garment) continue
      data[i] = 255
      painted += 1
    }
  }
  return { painted, verticalStack: true }
}

function localKeepColorMatch(
  imageData: ImageData,
  mask: MaskPixelBuffer,
  x: number,
  y: number,
  maxDist = 28,
): boolean {
  const { width, height, data } = mask
  let n = 0
  let sr = 0
  let sg = 0
  let sb = 0
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const xx = x + dx
      const yy = y + dy
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
      if (data[yy * width + xx]! < 128) continue
      const o = (yy * width + xx) * 4
      sr += imageData.data[o]!
      sg += imageData.data[o + 1]!
      sb += imageData.data[o + 2]!
      n += 1
    }
  }
  if (n < 3) return false
  const o = (y * width + x) * 4
  const dr = imageData.data[o]! - sr / n
  const dg = imageData.data[o + 1]! - sg / n
  const db = imageData.data[o + 2]! - sb / n
  return Math.sqrt(dr * dr + dg * dg + db * db) <= maxDist
}

/**
 * Localized grow: reclaim Lab KEEP / garment-like REMOVE pixels near existing
 * ISNet KEEP (coat under-recall). Uses multi-pass adjacency plus a limited
 * distance band inside the primary component bbox so jagged false-REMOVE
 * strips can heal without flooding the exterior studio card or bridging
 * side-by-side products.
 */
function reclaimAdjacentUnderRecall(
  mask: MaskPixelBuffer,
  lab: MaskPixelBuffer,
  imageData: ImageData,
  corner: { r: number; g: number; b: number },
  studioLuma: number,
  maxPasses = 10,
): number {
  const { width, height, data } = mask
  const comps = labelKeepComponents(mask).filter(
    (c) => c.size >= Math.max(80, data.length * 0.0008),
  )
  const primary = comps[0]
  let painted = 0
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const add: number[] = []
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x
        if (data[i]! >= 128) continue
        if (isStudioLike(imageData, x, y, corner, studioLuma)) continue
        if (isHorizontalGapPixel(x, y, comps)) continue
        if (primary) {
          if (
            x < primary.minX - 1 ||
            x > primary.maxX + 1 ||
            y < primary.minY - 1 ||
            y > primary.maxY + 1
          ) {
            continue
          }
        }
        const labKeep = lab.data[i]! >= 140
        const garment = isGarmentLike(imageData, x, y, corner, studioLuma)
        const colorMatch = localKeepColorMatch(imageData, mask, x, y)
        const dual = labKeep && garment
        const labChromatic = labKeep && chromaAt(imageData, x, y) >= 14
        const garmentSoftLab = garment && lab.data[i]! >= 100
        const continuity = garment && colorMatch
        if (!dual && !labChromatic && !garmentSoftLab && !continuity) continue
        const touchesKeep =
          data[i - 1]! >= 128 ||
          data[i + 1]! >= 128 ||
          data[i - width]! >= 128 ||
          data[i + width]! >= 128
        if (!touchesKeep) continue
        add.push(i)
      }
    }
    if (add.length === 0) break
    for (const i of add) {
      data[i] = 255
      painted += 1
    }
  }

  // Second stage: reclaim Lab+garment / color-continuous REMOVE near KEEP.
  if (primary) {
    const dist = new Int16Array(data.length)
    dist.fill(32767)
    const q: number[] = []
    for (let i = 0; i < data.length; i += 1) {
      if (data[i]! < 128) continue
      dist[i] = 0
      q.push(i)
    }
    let head = 0
    const maxD = 6
    while (head < q.length) {
      const i = q[head++]!
      const d = dist[i]!
      if (d >= maxD) continue
      const x = i % width
      const y = (i / width) | 0
      for (const n of [
        x > 0 ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ]) {
        if (n < 0 || dist[n]! <= d + 1) continue
        dist[n] = d + 1
        q.push(n)
      }
    }
    for (let y = primary.minY; y <= primary.maxY; y += 1) {
      for (let x = primary.minX; x <= primary.maxX; x += 1) {
        const i = y * width + x
        if (data[i]! >= 128) continue
        if (isStudioLike(imageData, x, y, corner, studioLuma)) continue
        if (isHorizontalGapPixel(x, y, comps)) continue
        const labKeep = lab.data[i]! >= 140
        const garment = isGarmentLike(imageData, x, y, corner, studioLuma)
        const colorMatch = localKeepColorMatch(imageData, mask, x, y)
        const strong =
          (labKeep && garment) ||
          (labKeep && chromaAt(imageData, x, y) >= 16) ||
          (garment && colorMatch && labKeep)
        if (!strong) continue
        let labNear = 0
        let labN = 0
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
            labN += 1
            if (lab.data[yy * width + xx]! >= 140) labNear += 1
          }
        }
        const insideLab = labN > 0 && labNear / labN >= 0.7
        if (dist[i]! > maxD && !insideLab) continue
        // Must touch KEEP — distance flood alone can seed orphan islands.
        const touchesKeep =
          data[i - 1]! >= 128 ||
          data[i + 1]! >= 128 ||
          data[i - width]! >= 128 ||
          data[i + width]! >= 128
        if (!touchesKeep) continue
        data[i] = 255
        painted += 1
      }
    }
  }
  return painted
}

/**
 * Drop KEEP islands that do not touch any pixel from the pre-edit mask.
 * Under-recall / dark-bite must grow the existing silhouette, not spawn
 * Lab-driven floaters that trip the fragmentation gate.
 */
function pruneOrphanKeepIslands(
  mask: MaskPixelBuffer,
  seedKeep: Uint8ClampedArray,
): number {
  const comps = labelKeepComponents(mask)
  let cleared = 0
  for (const c of comps) {
    let touchesSeed = false
    for (const i of c.indices) {
      if (seedKeep[i]! >= 128) {
        touchesSeed = true
        break
      }
    }
    if (touchesSeed) continue
    for (const i of c.indices) {
      mask.data[i] = 0
      cleared += 1
    }
  }
  return cleared
}

/**
 * Reclaim exterior false-REMOVE bites on dark garments (cap brim notches).
 * Only exterior-connected REMOVE — never fills eyelets / intentional holes.
 */
function reclaimExteriorDarkUndercuts(
  mask: MaskPixelBuffer,
  lab: MaskPixelBuffer,
  imageData: ImageData,
  corner: { r: number; g: number; b: number },
  studioLuma: number,
): number {
  const { width, height, data } = mask
  const exterior = new Uint8Array(data.length)
  const q: number[] = []
  const push = (i: number) => {
    if (exterior[i] || data[i]! >= 128) return
    exterior[i] = 1
    q.push(i)
  }
  for (let x = 0; x < width; x += 1) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width)
    push(y * width + (width - 1))
  }
  let head = 0
  while (head < q.length) {
    const i = q[head++]!
    const x = i % width
    const y = (i / width) | 0
    if (x > 0) push(i - 1)
    if (x + 1 < width) push(i + 1)
    if (y > 0) push(i - width)
    if (y + 1 < height) push(i + width)
  }

  let painted = 0
  // Multi-pass thin bite reclaim along the silhouette.
  for (let pass = 0; pass < 4; pass += 1) {
    const add: number[] = []
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x
        if (data[i]! >= 128) continue
        if (!exterior[i]) continue
        const L = lumaAt(imageData, x, y)
        if (L >= 95) continue
        if (isStudioLike(imageData, x, y, corner, studioLuma)) continue
        const touchesKeep =
          data[i - 1]! >= 128 ||
          data[i + 1]! >= 128 ||
          data[i - width]! >= 128 ||
          data[i + width]! >= 128
        if (!touchesKeep) continue
        // Lab KEEP or strong local dark continuity with KEEP neighbors.
        const labKeep = lab.data[i]! >= 128
        const colorMatch = localKeepColorMatch(imageData, mask, x, y, 36)
        if (!labKeep && !colorMatch) continue
        add.push(i)
      }
    }
    if (add.length === 0) break
    for (const i of add) {
      data[i] = 255
      exterior[i] = 0
      painted += 1
    }
  }
  return painted
}

/** Reject Lab-driven expansions that look like a rectangular studio card. */
function looksLikeCardShapedExpansion(
  before: MaskPixelBuffer,
  after: MaskPixelBuffer,
): boolean {
  const { width, height } = before
  let added = 0
  let borderAdded = 0
  const band = Math.max(2, Math.floor(Math.min(width, height) * 0.04))
  let minX = width
  let maxX = 0
  let minY = height
  let maxY = 0
  for (let i = 0; i < before.data.length; i += 1) {
    if (before.data[i]! >= 128 || after.data[i]! < 128) continue
    added += 1
    const x = i % width
    const y = (i / width) | 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (x < band || y < band || x >= width - band || y >= height - band) {
      borderAdded += 1
    }
  }
  if (added < Math.max(200, before.data.length * 0.01)) return false
  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  const fill = added / Math.max(1, bw * bh)
  const spansFrame = bw / width > 0.55 && bh / height > 0.45
  const borderHeavy = borderAdded / added > 0.35
  return spansFrame && fill > 0.55 && borderHeavy
}

/**
 * Strip ISNet KEEP that Lab treats as BG and looks like studio, only when
 * exterior-connected (contamination). Protects pale garments via peel helpers.
 */
function stripSupportedStudioContamination(
  mask: MaskPixelBuffer,
  lab: MaskPixelBuffer,
  imageData: ImageData,
  corner: { r: number; g: number; b: number },
  studioLuma: number,
  contaminationRate: number,
): { stripped: number; ops: string[] } {
  const ops: string[] = []
  if (contaminationRate < 0.004) {
    return { stripped: 0, ops }
  }
  const { width, data } = mask
  // Mark candidate strip pixels: ISNet KEEP ∩ Lab REMOVE ∩ studio-like.
  const candidate = new Uint8Array(data.length)
  let candCount = 0
  for (let i = 0; i < data.length; i += 1) {
    if (data[i]! < 128) continue
    if (lab.data[i]! >= 96) continue
    const x = i % width
    const y = (i / width) | 0
    if (!isStudioLike(imageData, x, y, corner, studioLuma)) continue
    candidate[i] = 1
    candCount += 1
  }
  if (candCount < 8) return { stripped: 0, ops }

  // Apply existing exterior peels — they protect dark/pale garment mass.
  const before = data.slice()
  const peeled = peelExteriorStudioKeep(mask, imageData, 40, 16)
  const border = stripBorderTouchingStudioComponents(mask, imageData, 40)
  // Undo peels on pixels that were NOT candidates (Lab agreed KEEP or garment).
  let stripped = 0
  for (let i = 0; i < data.length; i += 1) {
    if (before[i]! >= 128 && data[i]! < 128) {
      if (!candidate[i]) {
        data[i] = before[i]!
      } else {
        stripped += 1
      }
    }
  }
  if (peeled > 0) ops.push('peelExteriorStudioKeep')
  if (border > 0) ops.push('stripBorderTouchingStudioComponents')
  return { stripped, ops }
}

function decideAccept(input: {
  before: MaskPixelBuffer
  after: MaskPixelBuffer
  confBefore: number
  confAfter: number
  pixelsReclaimed: number
  pixelsStripped: number
  corridorReclaimed: number
  underRecallReclaimed: number
  darkBiteReclaimed: number
  compsBefore: number
  compsAfter: number
  holeBefore: number
  holeAfter: number
  contaminationBefore: number
  contaminationAfter: number
  failureModes: string[]
  verticalStackSeverance: boolean
  sideBySideMerge: boolean
  cardShapedExpansion: boolean
}): { accept: boolean; reason: string; category: IsnetRefineCategory } {
  const deltaFg = fgRatio(input.after) - fgRatio(input.before)
  const changed = input.pixelsReclaimed + input.pixelsStripped
  if (changed === 0) {
    return {
      accept: false,
      reason: 'no-evidence-backed-edits',
      category: 'none',
    }
  }
  if (input.cardShapedExpansion) {
    return {
      accept: false,
      reason: 'card-shaped-expansion',
      category: 'none',
    }
  }
  if (input.sideBySideMerge) {
    return {
      accept: false,
      reason: 'merged-side-by-side-components',
      category: 'none',
    }
  }
  if (Math.abs(deltaFg) > 0.18) {
    return {
      accept: false,
      reason: 'fg-area-delta-too-large',
      category: 'none',
    }
  }
  if (input.confAfter < input.confBefore - 0.08) {
    return {
      accept: false,
      reason: 'confidence-regressed',
      category: 'none',
    }
  }
  if (input.contaminationAfter > input.contaminationBefore + 0.01) {
    return {
      accept: false,
      reason: 'contamination-worsened',
      category: 'none',
    }
  }
  // Allow +1 tiny speck absorb; reject true fragmentation of the silhouette.
  if (input.compsAfter > input.compsBefore + 1) {
    return {
      accept: false,
      reason: 'component-fragmentation',
      category: 'none',
    }
  }

  const healedSeverance =
    input.verticalStackSeverance &&
    input.corridorReclaimed >= 40 &&
    input.compsAfter <= input.compsBefore
  const cleanedContamination =
    input.pixelsStripped >= 24 &&
    input.contaminationAfter + 0.002 < input.contaminationBefore
  // Under-recall reclaim only when FG is sparse / flagged — not for already
  // solid dark garments (blazer) where Lab merely wants a soft nibble.
  // Magnitude gate (≥2.5% area / deltaFg>0.025) rejects jeans-scale nibbles
  // while still admitting coat lower-body recovery (~8% FG).
  const sparseOrFlagged =
    fgRatio(input.before) < 0.4 ||
    input.failureModes.includes('possible-under-recall') ||
    input.failureModes.includes('stacked-keep-components')
  const reclaimedBody =
    sparseOrFlagged &&
    input.underRecallReclaimed >=
      Math.max(400, Math.floor(input.before.data.length * 0.025)) &&
    input.confAfter >= input.confBefore - 0.02 &&
    deltaFg > 0.025 &&
    deltaFg < 0.12 &&
    input.contaminationAfter <= input.contaminationBefore + 0.005 &&
    input.confBefore < 0.86 &&
    input.compsAfter <= input.compsBefore + 1
  // Exterior dark bites: allow alongside modest under-recall when the net
  // change stays a thin silhouette repair (cap brim notches).
  const edgeBite =
    input.darkBiteReclaimed >= 20 &&
    input.underRecallReclaimed <
      Math.max(800, Math.floor(input.before.data.length * 0.02)) &&
    deltaFg > 0 &&
    deltaFg < 0.04 &&
    input.contaminationAfter <= input.contaminationBefore + 0.002 &&
    input.compsAfter <= input.compsBefore + 1

  if (healedSeverance || cleanedContamination || reclaimedBody || edgeBite) {
    const bits = [
      healedSeverance ? 'healed-severance' : '',
      cleanedContamination ? 'stripped-studio' : '',
      reclaimedBody ? 'reclaimed-under-recall' : '',
      edgeBite ? 'exterior-dark-bite' : '',
    ].filter(Boolean)
    let category: IsnetRefineCategory = 'mixed'
    if (bits.length === 1) {
      if (healedSeverance) category = 'corridor-severance'
      else if (cleanedContamination) category = 'studio-strip'
      else if (reclaimedBody) category = 'under-recall'
      else if (edgeBite) category = 'exterior-dark-bite'
    }
    return { accept: true, reason: bits.join('+'), category }
  }
  return {
    accept: false,
    reason: 'ambiguous-evidence',
    category: 'none',
  }
}

function computeChangedBBox(
  before: MaskPixelBuffer,
  after: MaskPixelBuffer,
): {
  count: number
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null
} {
  const { width } = before
  let count = 0
  let minX = width
  let maxX = 0
  let minY = before.height
  let maxY = 0
  for (let i = 0; i < before.data.length; i += 1) {
    if (before.data[i] === after.data[i]) continue
    count += 1
    const x = i % width
    const y = (i / width) | 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (count === 0) return { count: 0, bbox: null }
  return { count, bbox: { minX, minY, maxX, maxY } }
}

/**
 * Refine an ISNet mask using Lab-seed + contour validation evidence.
 * Returns a candidate mask and diagnostics; caller accepts or restores original.
 */
export function refineIsnetWithEvidence(
  isnetMask: MaskPixelBuffer,
  imageData: ImageData,
): { mask: MaskPixelBuffer; diagnostics: IsnetRefineDiagnostics } {
  const corner = averageCornerColor(imageData)
  const studioLuma =
    0.299 * corner.r + 0.587 * corner.g + 0.114 * corner.b

  const initial = cloneMaskBuffer(isnetMask)
  const confBefore = estimateMaskConfidence(initial, imageData)
  const compsBefore = labelKeepComponents(initial)
  const holeBefore = internalHoleRatio(initial)
  const fgBefore = fgRatio(initial)

  const labSeg = segmentGarmentBySeeds(imageData)
  const lab = labSeg.mask
  const agreement = labAgreementRate(initial, lab)
  const contaminationBefore = labBgContaminationRate(
    initial,
    lab,
    imageData,
    corner,
    studioLuma,
  )

  // Contour-style validation of the ISNet silhouette (evidence only).
  const binary = new Uint8ClampedArray(initial.data.length)
  for (let i = 0; i < binary.length; i += 1) {
    binary[i] = initial.data[i]! >= 128 ? 255 : 0
  }
  const floodedBg = new Uint8ClampedArray(initial.data.length)
  // Approximate exterior: border-flood REMOVE.
  {
    const w = initial.width
    const h = initial.height
    const q: number[] = []
    const push = (i: number) => {
      if (floodedBg[i] || binary[i]! >= 128) return
      floodedBg[i] = 255
      q.push(i)
    }
    for (let x = 0; x < w; x += 1) {
      push(x)
      push((h - 1) * w + x)
    }
    for (let y = 0; y < h; y += 1) {
      push(y * w)
      push(y * w + (w - 1))
    }
    let head = 0
    while (head < q.length) {
      const i = q[head++]!
      const x = i % w
      const y = (i / w) | 0
      if (x > 0) push(i - 1)
      if (x + 1 < w) push(i + 1)
      if (y > 0) push(i - w)
      if (y + 1 < h) push(i + w)
    }
  }
  const contourVal = validateContourCandidate(
    binary,
    initial.width,
    initial.height,
    lab,
    floodedBg,
  )

  const failureModes: string[] = []
  if (compsBefore.length >= 2 && compsBefore[1]!.size >= 200) {
    failureModes.push('stacked-keep-components')
  }
  if (contaminationBefore >= 0.004) {
    failureModes.push('lab-disagrees-studio-keep')
  }
  if (contourVal.reliableBgContamination >= 0.04) {
    failureModes.push('contour-bg-contamination')
  }
  if (fgBefore < 0.4 && agreement < 0.85) {
    failureModes.push('possible-under-recall')
  }

  const substantialComps = (comps: ComponentInfo[]) =>
    comps.filter((c) => c.size >= Math.max(40, initial.data.length * 0.0005))
      .length

  function buildCandidate(opts: {
    doCorridor: boolean
    doUnderRecall: boolean
    doDarkBite: boolean
    doStrip: boolean
  }): {
    mask: MaskPixelBuffer
    corridorPainted: number
    verticalStack: boolean
    underRecall: number
    darkBite: number
    stripped: number
    ops: string[]
  } {
    const cand = cloneMaskBuffer(initial)
    const ops: string[] = []
    let corridorPainted = 0
    let verticalStack = false
    let underRecall = 0
    let darkBite = 0
    let stripped = 0
    if (opts.doCorridor) {
      const corridor = reclaimSeveranceCorridors(
        cand,
        lab,
        imageData,
        corner,
        studioLuma,
      )
      corridorPainted = corridor.painted
      verticalStack = corridor.verticalStack
      if (corridor.painted > 0) ops.push('reclaimSeveranceCorridors')
    }
    if (opts.doUnderRecall) {
      const seed = cand.data.slice()
      underRecall = reclaimAdjacentUnderRecall(
        cand,
        lab,
        imageData,
        corner,
        studioLuma,
      )
      const orphans = pruneOrphanKeepIslands(cand, seed)
      underRecall = Math.max(0, underRecall - orphans)
      if (underRecall > 0) ops.push('reclaimAdjacentUnderRecall')
      if (orphans > 0) ops.push('pruneOrphanKeepIslands')
    }
    if (opts.doDarkBite) {
      const seed = cand.data.slice()
      darkBite = reclaimExteriorDarkUndercuts(
        cand,
        lab,
        imageData,
        corner,
        studioLuma,
      )
      const orphans = pruneOrphanKeepIslands(cand, seed)
      darkBite = Math.max(0, darkBite - orphans)
      if (darkBite > 0) ops.push('reclaimExteriorDarkUndercuts')
    }
    if (opts.doStrip) {
      const strip = stripSupportedStudioContamination(
        cand,
        lab,
        imageData,
        corner,
        studioLuma,
        Math.max(contaminationBefore, contourVal.reliableBgContamination),
      )
      stripped = strip.stripped
      ops.push(...strip.ops)
    }
    return {
      mask: cand,
      corridorPainted,
      verticalStack,
      underRecall,
      darkBite,
      stripped,
      ops,
    }
  }

  function evaluateCandidate(
    built: ReturnType<typeof buildCandidate>,
  ): {
    decision: ReturnType<typeof decideAccept>
    confAfter: number
    compsAfter: number
    holeAfter: number
    fgAfter: number
    contaminationAfter: number
    sideBySideMerge: boolean
    cardShapedExpansion: boolean
    pixelsReclaimed: number
    pixelsStripped: number
  } {
    const confAfter = estimateMaskConfidence(built.mask, imageData)
    const compsAfterList = labelKeepComponents(built.mask)
    const holeAfter = internalHoleRatio(built.mask)
    const fgAfter = fgRatio(built.mask)
    const contaminationAfter = labBgContaminationRate(
      built.mask,
      lab,
      imageData,
      corner,
      studioLuma,
    )
    let sideBySideMerge = false
    if (
      compsBefore.length >= 2 &&
      compsAfterList.length < compsBefore.length &&
      compsBefore[0]!.size >= dataAreaMin(initial) &&
      compsBefore[1]!.size >= dataAreaMin(initial)
    ) {
      const a = compsBefore[0]!
      const b = compsBefore[1]!
      const horiz =
        a.maxX < b.minX - 2 ||
        b.maxX < a.minX - 2 ||
        (!isVerticalStack(a, b) &&
          Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) <
            0.25 * Math.min(a.maxX - a.minX, b.maxX - b.minX))
      if (horiz && !built.verticalStack) {
        sideBySideMerge = true
      }
    }
    const cardShapedExpansion = looksLikeCardShapedExpansion(
      initial,
      built.mask,
    )
    const pixelsReclaimed =
      built.corridorPainted + built.underRecall + built.darkBite
    const pixelsStripped = built.stripped
    const decision = decideAccept({
      before: initial,
      after: built.mask,
      confBefore: confBefore.score,
      confAfter: confAfter.score,
      pixelsReclaimed,
      pixelsStripped,
      corridorReclaimed: built.corridorPainted,
      underRecallReclaimed: built.underRecall,
      darkBiteReclaimed: built.darkBite,
      compsBefore: substantialComps(compsBefore),
      compsAfter: substantialComps(compsAfterList),
      holeBefore,
      holeAfter,
      contaminationBefore,
      contaminationAfter,
      failureModes,
      verticalStackSeverance:
        built.verticalStack && built.corridorPainted > 0,
      sideBySideMerge,
      cardShapedExpansion,
    })
    return {
      decision,
      confAfter: confAfter.score,
      compsAfter: compsAfterList.length,
      holeAfter,
      fgAfter,
      contaminationAfter,
      sideBySideMerge,
      cardShapedExpansion,
      pixelsReclaimed,
      pixelsStripped,
    }
  }

  // Primary candidate: full evidence suite.
  let built = buildCandidate({
    doCorridor: true,
    doUnderRecall: true,
    doDarkBite: true,
    doStrip: true,
  })
  let evaluated = evaluateCandidate(built)
  const refinementOps = [...built.ops]

  // If full candidate fails but dark exterior bites look promising, retry a
  // dark-bite-only (+ corridor/strip) candidate so under-recall fragmentation
  // does not block brim repairs (cap).
  if (
    !evaluated.decision.accept &&
    built.darkBite >= 20 &&
    built.underRecall > 0
  ) {
    const biteOnly = buildCandidate({
      doCorridor: true,
      doUnderRecall: false,
      doDarkBite: true,
      doStrip: true,
    })
    const biteEval = evaluateCandidate(biteOnly)
    refinementOps.push('retryDarkBiteOnly')
    if (biteEval.decision.accept) {
      built = biteOnly
      evaluated = biteEval
      refinementOps.push(...biteOnly.ops)
    }
  }

  const decision = evaluated.decision
  const candidate = built.mask
  const corridor = {
    painted: built.corridorPainted,
    verticalStack: built.verticalStack,
  }
  const reclaimedGrow = built.underRecall
  const darkBite = built.darkBite
  const strip = { stripped: built.stripped }
  const pixelsReclaimed = evaluated.pixelsReclaimed
  const pixelsStripped = evaluated.pixelsStripped
  const refinementAttempted = pixelsReclaimed + pixelsStripped > 0 || built.ops.length > 0
  const confAfter = evaluated.confAfter
  const compsAfter = { length: evaluated.compsAfter }
  const holeAfter = evaluated.holeAfter
  const fgAfter = evaluated.fgAfter
  const contaminationAfter = evaluated.contaminationAfter
  const sideBySideMerge = evaluated.sideBySideMerge
  const cardShapedExpansion = evaluated.cardShapedExpansion

  if (sideBySideMerge) failureModes.push('side-by-side-merge-risk')
  if (cardShapedExpansion) failureModes.push('card-shaped-expansion')

  const finalMask = decision.accept ? candidate : initial
  let residualLabGarmentGaps = 0
  let residualDarkExteriorBites = 0
  {
    const { width: w, height: h } = finalMask
    const exterior = new Uint8Array(finalMask.data.length)
    const q: number[] = []
    const push = (i: number) => {
      if (exterior[i] || finalMask.data[i]! >= 128) return
      exterior[i] = 1
      q.push(i)
    }
    for (let x = 0; x < w; x += 1) {
      push(x)
      push((h - 1) * w + x)
    }
    for (let y = 0; y < h; y += 1) {
      push(y * w)
      push(y * w + (w - 1))
    }
    let head = 0
    while (head < q.length) {
      const i = q[head++]!
      const x = i % w
      const y = (i / w) | 0
      if (x > 0) push(i - 1)
      if (x + 1 < w) push(i + 1)
      if (y > 0) push(i - w)
      if (y + 1 < h) push(i + w)
    }
    for (let i = 0; i < finalMask.data.length; i += 1) {
      if (finalMask.data[i]! >= 128) continue
      const x = i % w
      const y = (i / w) | 0
      if (
        lab.data[i]! >= 160 &&
        !isStudioLike(imageData, x, y, corner, studioLuma) &&
        isGarmentLike(imageData, x, y, corner, studioLuma)
      ) {
        residualLabGarmentGaps += 1
      }
      if (
        exterior[i] &&
        lumaAt(imageData, x, y) < 95 &&
        (x > 0 && finalMask.data[i - 1]! >= 128 ||
          x + 1 < w && finalMask.data[i + 1]! >= 128 ||
          y > 0 && finalMask.data[i - w]! >= 128 ||
          y + 1 < h && finalMask.data[i + w]! >= 128)
      ) {
        residualDarkExteriorBites += 1
      }
    }
  }
  if (residualLabGarmentGaps > finalMask.data.length * 0.012) {
    failureModes.push('residual-lab-garment-gaps')
  }
  if (residualDarkExteriorBites > 40) {
    failureModes.push('residual-dark-exterior-bites')
  }

  const changed = computeChangedBBox(initial, finalMask)
  const deltaFg = decision.accept ? fgAfter - fgBefore : 0

  const diagnostics: IsnetRefineDiagnostics = {
    initialFgRatio: fgBefore,
    finalFgRatio: decision.accept ? fgAfter : fgBefore,
    deltaFgRatio: deltaFg,
    initialComponentCount: compsBefore.length,
    finalComponentCount: decision.accept
      ? compsAfter.length
      : compsBefore.length,
    initialInternalHoleRatio: holeBefore,
    finalInternalHoleRatio: decision.accept ? holeAfter : holeBefore,
    labAgreement: agreement,
    labBgContaminationRate: decision.accept
      ? contaminationAfter
      : contaminationBefore,
    contourReliableBgContamination: contourVal.reliableBgContamination,
    contourInternalHoleRatio: contourVal.internalHoleRatio,
    contourBorderTouchRatio: contourVal.borderTouchRatio,
    pixelsReclaimed: decision.accept ? pixelsReclaimed : 0,
    pixelsStripped: decision.accept ? pixelsStripped : 0,
    changedPixelCount: changed.count,
    changedBBox: changed.bbox,
    refinementAttempted,
    refinementAccepted: decision.accept,
    refinementCategory: decision.category,
    acceptReason: decision.accept ? decision.reason : undefined,
    rejectReason: decision.accept ? undefined : decision.reason,
    failureModes,
    gateValues: {
      deltaFg,
      corridorReclaimed: corridor.painted,
      underRecallReclaimed: reclaimedGrow,
      darkBiteReclaimed: darkBite,
      stripped: strip.stripped,
      verticalStackSeverance: corridor.verticalStack && corridor.painted > 0,
      sideBySideMergeBlocked: sideBySideMerge,
      cardShapedExpansionBlocked: cardShapedExpansion,
    },
    confidenceBefore: confBefore.score,
    confidenceAfter: decision.accept ? confAfter : confBefore.score,
    inferenceEngine: 'isnet-onnx',
    refinementOps,
  }

  return {
    mask: decision.accept ? candidate : initial,
    diagnostics,
  }
}

function dataAreaMin(mask: MaskPixelBuffer): number {
  return Math.max(120, Math.floor(mask.data.length * 0.004))
}
