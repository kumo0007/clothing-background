/**
 * Contour-first garment segmentation.
 *
 * Pipeline:
 *   edges → outer contour (edge-barrier flood) → gap close → validate →
 *   interior fill → hole/open-arch cleanup → boundary alpha refine
 *
 * White-on-near-white: silhouette is recovered from gradient barriers and
 * structure seeds, not from Lab color distance. Lab-seed is supporting evidence
 * only — never the sole decision.
 *
 * Mask polarity: 255 KEEP, 0 REMOVE, gray = soft alpha. Source RGB untouched.
 */
import type { MaskPixelBuffer } from '../../../types/mask'
import { createMaskBuffer, cloneMaskBuffer } from '../createMask'
import { fillPolygonOnMask, type PolygonPoint } from '../polygonMask'
import { extractMaskContours, simplifyPolygon } from '../maskContour'
import { segmentGarmentBySeeds } from '../opencv/segmentSeeds'
import { refineBoundaryAlpha } from '../refineBoundaryAlpha'
import {
  featherMaskEdges,
  morphCloseMask,
  erodeMask,
} from '../refineMask'
import {
  stripOpenArchStudio,
  stripForeignBorderBands,
  stripDetachedStudioIslands,
  stripEnclosedFlatStudio,
  peelExteriorStudioKeep,
  stripBorderConnectedStudio,
  removeBrightEdgeChrome,
} from '../selectSimilar'
import { estimateMaskConfidence } from '../maskConfidence'

/** Axis-aligned bounds of the candidate contour interior (normalized spans). */
export type ContourCandidateBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** BBox width / image width. */
  spanX: number
  /** BBox height / image height. */
  spanY: number
  bboxAreaRatio: number
  /** Interior pixels / bbox area. */
  fillRatio: number
}

/**
 * Structured Stage-D report — why a contour was accepted or rejected.
 * All ratios are normalized to image geometry (not fixture-specific pixels).
 */
export type ContourValidationReport = {
  decision: 'accept' | 'reject'
  reason: string
  areaRatio: number
  exteriorRatio: number
  gapAddedRatio: number
  substantialGapCompletion: boolean
  seedAgreement: number
  reliableFgAgreement: number
  reliableFgRatio: number
  reliableBgContamination: number
  borderTouchRatio: number
  boundarySupport: number
  componentCount: number
  largestComponentRatio: number
  internalHoleRatio: number
  bounds: ContourCandidateBounds | null
}

export type ContourFirstDiagnostics = {
  stages: string[]
  edgeDensity: number
  gapClosed: boolean
  contourAccepted: boolean
  rejectReason?: string
  /** Present when seed fallback was used after reject. */
  fallbackReason?: string
  outerAreaRatio: number
  seedAgreement: number
  borderTouchRatio: number
  substantialCompletion: boolean
  /** Full Stage-D evidence (always set after validate). */
  validation?: ContourValidationReport
  /** Why needsReview was set (empty when review not required). */
  reviewReasons?: string[]
}

/**
 * Evidence-based review policy for contour-first results.
 *
 * - Rejected / fallback → always review.
 * - Accepted + low confidence / border-card leakage → review.
 * - Substantial gap-close alone does NOT force review when validation shows
 *   strong seed/reliable-FG agreement and solid boundary support (jeans case).
 * - Large inferred-gap fraction or marginal agreement with substantial close → review.
 */
export function decideContourNeedsReview(input: {
  contourAccepted: boolean
  confidenceNeedsReview: boolean
  confidenceReasons: string[]
  substantialCompletion: boolean
  borderTouchRatio: number
  validation?: ContourValidationReport | null
}): { needsReview: boolean; reasons: string[] } {
  const reasons: string[] = []

  if (!input.contourAccepted) {
    reasons.push('contour-rejected-fallback-seed')
    return { needsReview: true, reasons }
  }

  if (input.confidenceNeedsReview) {
    reasons.push(
      ...(input.confidenceReasons.length > 0
        ? input.confidenceReasons
        : ['low-mask-confidence']),
    )
  }

  if (input.borderTouchRatio > 0.25) {
    reasons.push('high-border-touch-ratio')
  }

  const v = input.validation
  if (input.substantialCompletion && v) {
    const strongSupport =
      v.seedAgreement >= 0.65 &&
      v.reliableFgAgreement >= 0.65 &&
      v.boundarySupport >= 0.7 &&
      v.largestComponentRatio >= 0.85
    const largeInferredGap = v.gapAddedRatio > 0.035
    const marginalAgreement =
      v.seedAgreement < 0.7 || v.reliableFgAgreement < 0.7
    if (largeInferredGap || (marginalAgreement && !strongSupport)) {
      reasons.push('substantial-gap-completion-uncertain')
    }
    // Strong support + modest gap → do not invent a false review warning.
  } else if (input.substantialCompletion && !v) {
    reasons.push('substantial-gap-completion-no-validation')
  }

  return { needsReview: reasons.length > 0, reasons }
}

export type ContourFirstResult = {
  mask: MaskPixelBuffer
  /**
   * `'contour-first'` when the contour silhouette was accepted;
   * `'contour-first-fallback-seed'` when validation rejected and the Lab-seed
   * prior was used instead. Never claim contour-first for a seed substitute.
   */
  methodUsed: 'contour-first' | 'contour-first-fallback-seed'
  elapsedMs: number
  confidence: number
  needsReview: boolean
  diagnostics: ContourFirstDiagnostics
  /** Intermediate maps for eval exports (optional consumers). */
  debug?: {
    edges: Uint8ClampedArray
    barriers: Uint8ClampedArray
    floodedBg: Uint8ClampedArray
    outerContour: PolygonPoint[] | null
  }
}

export type ContourFirstOptions = {
  /** Include debug maps (edges/barriers/flood). Default false. */
  includeDebug?: boolean
  /** Optional supporting prior mask (e.g. Lab-seed). Built internally if omitted. */
  seedPrior?: MaskPixelBuffer
}

function lumaAt(image: ImageData, x: number, y: number): number {
  const o = (y * image.width + x) * 4
  return (
    0.299 * image.data[o]! +
    0.587 * image.data[o + 1]! +
    0.114 * image.data[o + 2]!
  )
}

/**
 * Stage A — multi-scale Sobel gradient edges (scale-normalized).
 * Returns magnitude 0–255.
 */
export function detectCandidateEdges(imageData: ImageData): Uint8ClampedArray {
  const { width: w, height: h } = imageData
  const gray = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      gray[y * w + x] = lumaAt(imageData, x, y)
    }
  }

  const mag = new Float32Array(w * h)
  let sum = 0
  let count = 0
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const gx =
        -gray[(y - 1) * w + (x - 1)]! +
        gray[(y - 1) * w + (x + 1)]! +
        -2 * gray[y * w + (x - 1)]! +
        2 * gray[y * w + (x + 1)]! +
        -gray[(y + 1) * w + (x - 1)]! +
        gray[(y + 1) * w + (x + 1)]!
      const gy =
        -gray[(y - 1) * w + (x - 1)]! -
        2 * gray[(y - 1) * w + x]! -
        gray[(y - 1) * w + (x + 1)]! +
        gray[(y + 1) * w + (x - 1)]! +
        2 * gray[(y + 1) * w + x]! +
        gray[(y + 1) * w + (x + 1)]!
      const m = Math.hypot(gx, gy)
      mag[y * w + x] = m
      sum += m
      count += 1
    }
  }
  const mean = count > 0 ? sum / count : 1
  // Scale-normalized soft threshold around mean*k.
  const out = new Uint8ClampedArray(w * h)
  for (let i = 0; i < mag.length; i += 1) {
    const n = mag[i]! / (mean + 1e-3)
    out[i] = Math.max(0, Math.min(255, Math.round(n * 48)))
  }
  return out
}

/**
 * Build binary barrier map: strong edges are walls for border flood.
 * Interior seed KEEP suppresses barriers (print/seam edges inside garment).
 * Image-border band barriers are weakened so flood can enter from the frame.
 */
export function buildEdgeBarriers(
  edges: Uint8ClampedArray,
  width: number,
  height: number,
  seedPrior: MaskPixelBuffer | null,
  edgeThreshold = 40,
): Uint8ClampedArray {
  const barriers = new Uint8ClampedArray(width * height)
  const borderBand = Math.max(2, Math.floor(Math.min(width, height) * 0.012))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const onFrame =
        x < borderBand ||
        y < borderBand ||
        x >= width - borderBand ||
        y >= height - borderBand
      let e = edges[i]!
      // Suppress card-frame edges so flood starts from the border.
      if (onFrame) e = Math.floor(e * 0.25)
      // Suppress edges deep inside confident seed KEEP (internal seams),
      // but keep seed silhouette as a barrier for white-on-white.
      let seedBoundary = false
      if (seedPrior && seedPrior.data[i]! >= 128) {
        let touchesRemove = false
        for (const n of [
          x > 0 ? i - 1 : -1,
          x + 1 < width ? i + 1 : -1,
          y > 0 ? i - width : -1,
          y + 1 < height ? i + width : -1,
        ]) {
          if (n >= 0 && seedPrior.data[n]! < 96) {
            touchesRemove = true
            break
          }
        }
        seedBoundary = touchesRemove
        if (seedPrior.data[i]! >= 220 && !seedBoundary) {
          e = Math.floor(e * 0.35)
        }
      }
      if (seedBoundary) e = Math.max(e, edgeThreshold)
      barriers[i] = e >= edgeThreshold ? 255 : 0
    }
  }
  return barriers
}

/**
 * Stage C — close small gaps in the barrier map (scale-aware morph close).
 * Returns whether any substantial completion occurred.
 */
export function closeBarrierGaps(
  barriers: Uint8ClampedArray,
  width: number,
  height: number,
): {
  closed: Uint8ClampedArray
  gapClosed: boolean
  substantial: boolean
  /** Fraction of image pixels invented as barrier by morph close. */
  addedRatio: number
} {
  const before = barriers.slice()
  const mask = createMaskBuffer(width, height, 0)
  mask.data.set(barriers)
  const radius = Math.max(1, Math.min(3, Math.round(Math.min(width, height) / 400)))
  morphCloseMask(mask, radius)
  // Thin one pixel so we don't weld unrelated objects across large gaps.
  if (radius >= 2) {
    erodeMask(mask, 1)
  }
  let added = 0
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! >= 128 && before[i]! < 128) {
      added += 1
    }
  }
  const area = width * height
  const addedRatio = added / area
  return {
    closed: new Uint8ClampedArray(mask.data),
    gapClosed: added > 0,
    // Large relative barrier growth invents silhouette — flag for review.
    substantial: addedRatio > 0.012,
    addedRatio,
  }
}

/**
 * Stage B — flood from image borders through non-barrier pixels.
 * Unflooded interior = candidate garment region (edge-barrier silhouette).
 */
export function floodExteriorThroughGaps(
  barriers: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const flooded = new Uint8ClampedArray(width * height)
  const queue: number[] = []
  const seed = (x: number, y: number) => {
    const i = y * width + x
    if (flooded[i] || barriers[i]! >= 128) return
    flooded[i] = 255
    queue.push(i)
  }
  for (let x = 0; x < width; x += 1) {
    seed(x, 0)
    seed(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    seed(0, y)
    seed(width - 1, y)
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
      if (n < 0 || flooded[n] || barriers[n]! >= 128) continue
      flooded[n] = 255
      queue.push(n)
    }
  }
  return flooded
}

function countKeep(data: Uint8Array | Uint8ClampedArray, thr = 128): number {
  let n = 0
  for (let i = 0; i < data.length; i += 1) if (data[i]! >= thr) n += 1
  return n
}

export type ValidateContourOptions = {
  /** Fraction of image pixels added as barrier by gap closing. */
  gapAddedRatio?: number
  substantialGapCompletion?: boolean
  /** Sobel magnitude map for boundary-support scoring (optional). */
  edges?: Uint8ClampedArray | null
  /** Source image for reliable FG/BG evidence (optional). */
  imageData?: ImageData | null
}

function meanCornerLuma(image: ImageData): number {
  const { width: w, height: h, data } = image
  const pts = [
    [1, 1],
    [w - 2, 1],
    [1, h - 2],
    [w - 2, h - 2],
  ] as const
  let sum = 0
  for (const [x, y] of pts) {
    const o = (y * w + x) * 4
    sum += 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!
  }
  return sum / pts.length
}

function chromaAt(image: ImageData, i: number): number {
  const o = i * 4
  const r = image.data[o]!
  const g = image.data[o + 1]!
  const b = image.data[o + 2]!
  return Math.max(r, g, b) - Math.min(r, g, b)
}

function countInteriorComponents(
  interior: Uint8ClampedArray,
  width: number,
  height: number,
): { count: number; largestRatio: number } {
  const seen = new Uint8Array(interior.length)
  const sizes: number[] = []
  for (let i = 0; i < interior.length; i += 1) {
    if (interior[i]! < 128 || seen[i]) continue
    let size = 0
    const stack = [i]
    seen[i] = 1
    while (stack.length) {
      const cur = stack.pop()!
      size += 1
      const x = cur % width
      const y = (cur / width) | 0
      for (const n of [
        x > 0 ? cur - 1 : -1,
        x + 1 < width ? cur + 1 : -1,
        y > 0 ? cur - width : -1,
        y + 1 < height ? cur + height : -1,
      ]) {
        if (n < 0 || seen[n] || interior[n]! < 128) continue
        seen[n] = 1
        stack.push(n)
      }
    }
    sizes.push(size)
  }
  const interiorCount = countKeep(interior)
  const largest = sizes.length ? Math.max(...sizes) : 0
  return {
    count: sizes.length,
    largestRatio: interiorCount > 0 ? largest / interiorCount : 0,
  }
}

/**
 * Stage D — validate candidate interior (inverted flood).
 *
 * Rejection is driven by normalized geometry, gap-inferred boundary extent,
 * and agreement with *reliable* seed FG/BG (dark/chromatic structure), not
 * raw pale KEEP which fails on white-on-white cards.
 */
export function validateContourCandidate(
  interior: Uint8ClampedArray,
  width: number,
  height: number,
  seedPrior: MaskPixelBuffer | null,
  floodedBg: Uint8ClampedArray,
  options: ValidateContourOptions = {},
): ContourValidationReport & { ok: boolean } {
  const area = width * height
  const interiorCount = countKeep(interior)
  const areaRatio = interiorCount / area
  const exteriorRatio = countKeep(floodedBg) / area
  const gapAddedRatio = options.gapAddedRatio ?? 0
  const substantialGapCompletion = options.substantialGapCompletion === true

  const emptyBounds = (): ContourValidationReport & { ok: boolean } => ({
    ok: false,
    decision: 'reject',
    reason: 'interior-too-small',
    areaRatio,
    exteriorRatio,
    gapAddedRatio,
    substantialGapCompletion,
    seedAgreement: 0,
    reliableFgAgreement: 0,
    reliableFgRatio: 0,
    reliableBgContamination: 0,
    borderTouchRatio: 1,
    boundarySupport: 0,
    componentCount: 0,
    largestComponentRatio: 0,
    internalHoleRatio: 0,
    bounds: null,
  })

  if (interiorCount < area * 0.02) {
    return emptyBounds()
  }

  // Penalize following the rectangular frame (studio card).
  let borderTouch = 0
  let borderN = 0
  const band = Math.max(2, Math.floor(Math.min(width, height) * 0.02))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        x >= band &&
        y >= band &&
        x < width - band &&
        y < height - band
      ) {
        continue
      }
      borderN += 1
      if (interior[y * width + x]! >= 128) borderTouch += 1
    }
  }
  const borderTouchRatio = borderN > 0 ? borderTouch / borderN : 0

  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (interior[y * width + x]! < 128) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  const bboxW = Math.max(0, maxX - minX + 1)
  const bboxH = Math.max(0, maxY - minY + 1)
  const bboxArea = Math.max(1, bboxW * bboxH)
  const bounds: ContourCandidateBounds = {
    minX,
    minY,
    maxX,
    maxY,
    spanX: bboxW / width,
    spanY: bboxH / height,
    bboxAreaRatio: bboxArea / area,
    fillRatio: interiorCount / bboxArea,
  }

  // Boundary support: fraction of silhouette perimeter backed by observed edges.
  let perimeter = 0
  let supported = 0
  const edges = options.edges
  const edgeSupportThr = 28
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (interior[i]! < 128) continue
      let onEdge = false
      for (const n of [
        x > 0 ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y + 1 < height ? i + height : -1,
      ]) {
        if (n < 0 || interior[n]! < 128) {
          onEdge = true
          break
        }
      }
      if (!onEdge) continue
      perimeter += 1
      if (edges && edges[i]! >= edgeSupportThr) supported += 1
    }
  }
  const boundarySupport = perimeter > 0 ? supported / perimeter : 0

  const components = countInteriorComponents(interior, width, height)

  // Internal holes: non-interior, non-flooded pixels inside the bbox (cavities
  // or barrier walls the exterior flood could not reach).
  let holePx = 0
  let bboxPx = 0
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      bboxPx += 1
      const i = y * width + x
      if (interior[i]! >= 128) continue
      if (floodedBg[i]! < 128) holePx += 1
    }
  }
  const internalHoleRatio = bboxPx > 0 ? holePx / bboxPx : 0

  let seedAgreement = 0.5
  let reliableFgAgreement = 0.5
  let reliableFgRatio = 0
  let reliableBgContamination = 0
  const image = options.imageData ?? null
  const cornerLuma = image ? meanCornerLuma(image) : 220

  if (seedPrior) {
    let agree = 0
    let seedKeep = 0
    let relFg = 0
    let relFgAgree = 0
    let relBg = 0
    let relBgInInterior = 0
    for (let i = 0; i < interior.length; i += 1) {
      const seedV = seedPrior.data[i]!
      if (seedV >= 128) {
        seedKeep += 1
        if (interior[i]! >= 128) agree += 1
      }

      let reliableFg = false
      if (seedV >= 128 && image) {
        const o = i * 4
        const luma =
          0.299 * image.data[o]! +
          0.587 * image.data[o + 1]! +
          0.114 * image.data[o + 2]!
        const chroma = chromaAt(image, i)
        // Dark or chromatic seed KEEP is structural evidence; pale card is not.
        reliableFg = luma < cornerLuma - 28 || chroma > 18
      } else if (seedV >= 200) {
        // Without RGB, treat only high-confidence seed as weakly reliable.
        reliableFg = true
      }
      if (reliableFg) {
        relFg += 1
        if (interior[i]! >= 128) relFgAgree += 1
      }

      // Reliable BG: seed REMOVE near the frame band (studio card margin).
      const x = i % width
      const y = (i / width) | 0
      const nearBorder =
        x < band || y < band || x >= width - band || y >= height - band
      if (seedV < 40 && nearBorder) {
        relBg += 1
        if (interior[i]! >= 128) relBgInInterior += 1
      }
    }
    seedAgreement = seedKeep > 0 ? agree / seedKeep : 0
    reliableFgRatio = relFg / area
    reliableFgAgreement = relFg > 0 ? relFgAgree / relFg : seedAgreement
    reliableBgContamination = relBg > 0 ? relBgInInterior / relBg : 0
  }

  const finish = (
    ok: boolean,
    reason: string,
  ): ContourValidationReport & { ok: boolean } => ({
    ok,
    decision: ok ? 'accept' : 'reject',
    reason,
    areaRatio,
    exteriorRatio,
    gapAddedRatio,
    substantialGapCompletion,
    seedAgreement,
    reliableFgAgreement,
    reliableFgRatio,
    reliableBgContamination,
    borderTouchRatio,
    boundarySupport,
    componentCount: components.count,
    largestComponentRatio: components.largestRatio,
    internalHoleRatio,
    bounds,
  })

  if (areaRatio > 0.85) {
    return finish(false, 'interior-nearly-full-frame')
  }
  if (borderTouchRatio > 0.45) {
    return finish(false, 'follows-image-border-card')
  }
  if (exteriorRatio < 0.05) {
    return finish(false, 'exterior-flood-failed')
  }
  if (bounds.fillRatio < 0.45) {
    return finish(false, 'sparse-interior-leak')
  }

  // Card-following silhouette: bbox spans nearly the whole frame, large
  // interior, thin exterior — barrier stopped at the studio card, not garment.
  // Thresholds are fractions of image geometry (tee ~57% interior / ~32% exterior).
  if (
    bounds.spanX >= 0.88 &&
    bounds.spanY >= 0.88 &&
    areaRatio >= 0.48 &&
    exteriorRatio < 0.38
  ) {
    return finish(false, 'follows-studio-card')
  }

  // Tall/wide card slab (one axis nearly full-frame, other still dominant).
  if (
    ((bounds.spanY >= 0.92 && bounds.spanX >= 0.7) ||
      (bounds.spanX >= 0.92 && bounds.spanY >= 0.7)) &&
    areaRatio >= 0.48 &&
    exteriorRatio < 0.36
  ) {
    return finish(false, 'follows-studio-card')
  }

  // Aspect-matched near-full bbox with weak exterior (card slab).
  if (
    bounds.bboxAreaRatio >= 0.78 &&
    areaRatio >= 0.5 &&
    exteriorRatio < 0.36 &&
    Math.abs(bounds.spanX / Math.max(1e-6, bounds.spanY) - width / height) < 0.12
  ) {
    return finish(false, 'follows-studio-card')
  }

  // Large pale silhouettes without dark/chromatic seed structure are almost
  // always studio-card fills (white tee / dress). Dark garments have high
  // reliableFgRatio (blazer ~0.58); tee sits near ~0.005.
  if (
    areaRatio >= 0.45 &&
    exteriorRatio < 0.38 &&
    reliableFgRatio < 0.04
  ) {
    return finish(false, 'insufficient-reliable-fg-for-area')
  }
  if (
    reliableFgRatio > 0.002 &&
    reliableFgAgreement < 0.3 &&
    areaRatio >= 0.4
  ) {
    return finish(false, 'reliable-fg-outside-contour')
  }

  if (seedPrior) {
    const seedKeep = countKeep(seedPrior.data)
    const seedRatio = seedKeep / area
    if (seedKeep > area * 0.08 && seedAgreement < 0.25) {
      return finish(false, 'rejects-seed-garment-mass')
    }
    if (seedRatio > 0.08 && areaRatio > seedRatio * 1.75) {
      return finish(false, 'contour-over-fills-vs-seed')
    }
  }

  // Substantial inferred boundary (gap close) must not invent a silhouette
  // that disagrees with observed seed structure (sneakers ~0.44 agreement).
  if (substantialGapCompletion && seedAgreement < 0.55) {
    return finish(false, 'excessive-gap-weak-agreement')
  }
  if (
    substantialGapCompletion &&
    reliableFgRatio > 0.04 &&
    reliableFgAgreement < 0.5
  ) {
    return finish(false, 'excessive-gap-weak-reliable-fg')
  }
  if (gapAddedRatio > 0.02 && areaRatio > 0.4 && seedAgreement < 0.6) {
    return finish(false, 'excessive-gap-inflated-interior')
  }

  // Reliable dark/chromatic FG must land mostly inside the contour.
  if (reliableFgRatio > 0.06 && reliableFgAgreement < 0.45) {
    return finish(false, 'weak-reliable-fg-agreement')
  }
  if (reliableBgContamination > 0.35) {
    return finish(false, 'contaminates-reliable-bg')
  }

  // Large interiors need observed edge support along the silhouette.
  if (edges && areaRatio > 0.35 && boundarySupport < 0.22) {
    return finish(false, 'low-boundary-support')
  }

  // Fragmented interiors after prune are not a single garment silhouette.
  if (components.count >= 4 && components.largestRatio < 0.7) {
    return finish(false, 'fragmented-interior')
  }

  return finish(true, 'accepted')
}

/**
 * Combine validated contour fill with seed prior: union of contour interior
 * and high-confidence seed KEEP; never fill entire bbox blindly.
 */
export function fillFromValidatedContour(
  width: number,
  height: number,
  interior: Uint8ClampedArray,
  seedPrior: MaskPixelBuffer | null,
): MaskPixelBuffer {
  const mask = createMaskBuffer(width, height, 0)
  for (let i = 0; i < interior.length; i += 1) {
    if (interior[i]! >= 128) {
      mask.data[i] = 255
      continue
    }
    // Preserve thin seed structures (straps/laces) just outside contour snap.
    if (seedPrior && seedPrior.data[i]! >= 240) {
      mask.data[i] = 255
    }
  }
  return mask
}

function interiorFromFlood(
  floodedBg: Uint8ClampedArray,
  barriers: Uint8ClampedArray,
): Uint8ClampedArray {
  const interior = new Uint8ClampedArray(floodedBg.length)
  for (let i = 0; i < floodedBg.length; i += 1) {
    // Unflooded and not pure barrier wall → candidate garment.
    if (floodedBg[i]! < 128 && barriers[i]! < 128) {
      interior[i] = 255
    }
  }
  return interior
}

/**
 * Keep largest interior component(s) that look like garments; drop flecks.
 */
function pruneInteriorComponents(
  interior: Uint8ClampedArray,
  width: number,
  height: number,
  minAreaRatio = 0.01,
): Uint8ClampedArray {
  const visited = new Uint8Array(interior.length)
  const out = new Uint8ClampedArray(interior.length)
  const minArea = Math.floor(width * height * minAreaRatio)
  const components: number[][] = []

  for (let start = 0; start < interior.length; start += 1) {
    if (visited[start] || interior[start]! < 128) continue
    const comp: number[] = []
    const q = [start]
    visited[start] = 1
    let head = 0
    while (head < q.length) {
      const i = q[head++]!
      comp.push(i)
      const x = i % width
      const y = (i / width) | 0
      for (const n of [
        x > 0 ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ]) {
        if (n < 0 || visited[n] || interior[n]! < 128) continue
        visited[n] = 1
        q.push(n)
      }
    }
    components.push(comp)
  }
  components.sort((a, b) => b.length - a.length)
  // Keep largest + any secondary ≥ 35% of largest (e.g. second sneaker).
  const primary = components[0]?.length ?? 0
  for (const comp of components) {
    if (comp.length < minArea) continue
    if (comp.length < primary * 0.35 && comp !== components[0]) continue
    for (const i of comp) out[i] = 255
  }
  return out
}

/**
 * Full contour-first segmentation. Pure JS (no WASM) for UI safety.
 */
export function segmentGarmentContourFirst(
  imageData: ImageData,
  options: ContourFirstOptions = {},
): ContourFirstResult {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const { width, height } = imageData
  const stages: string[] = []
  const diagnostics: ContourFirstDiagnostics = {
    stages,
    edgeDensity: 0,
    gapClosed: false,
    contourAccepted: false,
    outerAreaRatio: 0,
    seedAgreement: 0,
    borderTouchRatio: 0,
    substantialCompletion: false,
  }

  // Supporting Lab-seed prior (evidence only).
  stages.push('seed-prior')
  const seedPrior =
    options.seedPrior ?? segmentGarmentBySeeds(imageData).mask

  // Stage A
  stages.push('edge-detect')
  const edges = detectCandidateEdges(imageData)
  diagnostics.edgeDensity = countKeep(edges, 40) / (width * height)

  // Adaptive barrier threshold from edge histogram.
  let edgeSum = 0
  let edgeN = 0
  for (let i = 0; i < edges.length; i += 1) {
    if (edges[i]! > 8) {
      edgeSum += edges[i]!
      edgeN += 1
    }
  }
  const edgeMean = edgeN > 0 ? edgeSum / edgeN : 40
  const edgeThr = Math.max(28, Math.min(72, Math.round(edgeMean * 0.85)))

  stages.push('build-barriers')
  let barriers = buildEdgeBarriers(edges, width, height, seedPrior, edgeThr)

  // Stage C
  stages.push('close-gaps')
  const closed = closeBarrierGaps(barriers, width, height)
  barriers = closed.closed
  diagnostics.gapClosed = closed.gapClosed
  diagnostics.substantialCompletion = closed.substantial

  // Stage B
  stages.push('exterior-flood')
  const floodedBg = floodExteriorThroughGaps(barriers, width, height)
  let interior = interiorFromFlood(floodedBg, barriers)
  interior = pruneInteriorComponents(interior, width, height)

  // Stage D
  stages.push('validate')
  const validation = validateContourCandidate(
    interior,
    width,
    height,
    seedPrior,
    floodedBg,
    {
      gapAddedRatio: closed.addedRatio,
      substantialGapCompletion: closed.substantial,
      edges,
      imageData,
    },
  )
  const { ok: validationOk, ...validationReport } = validation
  diagnostics.validation = validationReport
  diagnostics.outerAreaRatio = validation.areaRatio
  diagnostics.seedAgreement = validation.seedAgreement
  diagnostics.borderTouchRatio = validation.borderTouchRatio

  let mask: MaskPixelBuffer
  let outerContour: PolygonPoint[] | null = null

  if (!validationOk) {
    diagnostics.contourAccepted = false
    diagnostics.rejectReason = validation.reason
    diagnostics.fallbackReason = `seed-prior after ${validation.reason}`
    stages.push(`reject:${validation.reason}`)
    // Honest fallback: seed prior + cleanup, mark needsReview.
    mask = cloneMaskBuffer(seedPrior)
    stages.push('fallback-seed')
  } else {
    // Contour fill is the silhouette authority; merge high-confidence seed
    // only for thin structures (straps), not for reclaiming card slabs.
    stages.push('fill-interior')
    mask = fillFromValidatedContour(width, height, interior, seedPrior)

    // If contour left an implausibly empty core while seed has mass, reject.
    const filled = countKeep(mask.data)
    const seedKeep = countKeep(seedPrior.data)
    if (filled < seedKeep * 0.35 && seedKeep > width * height * 0.05) {
      diagnostics.contourAccepted = false
      diagnostics.rejectReason = 'contour-under-fills-vs-seed'
      diagnostics.fallbackReason =
        'seed-prior after contour-under-fills-vs-seed'
      diagnostics.validation = {
        ...validationReport,
        decision: 'reject',
        reason: 'contour-under-fills-vs-seed',
      }
      stages.push('reject:contour-under-fills-vs-seed')
      mask = cloneMaskBuffer(seedPrior)
      stages.push('fallback-seed')
    } else {
      diagnostics.contourAccepted = true
      const rings = extractMaskContours(mask, { simplifyTolerance: 1.5 })
      outerContour = rings.find((r) => !r.isHole)?.points ?? null
    }
  }

  // Holes / open arches (handbag) — topology + studio evidence.
  // When contour was accepted, skip enclosed-flat / border-studio peels that
  // treat near-card pale KEEP as removable — those erase white tee/sneaker
  // interiors that contour-first intentionally filled.
  stages.push('holes-open-arch')
  if (!diagnostics.contourAccepted) {
    stripEnclosedFlatStudio(mask, imageData, 40)
  }
  stripOpenArchStudio(mask, imageData, 40)
  stripDetachedStudioIslands(mask, imageData, 40)

  stages.push('studio-border-cleanup')
  if (!diagnostics.contourAccepted) {
    stripBorderConnectedStudio(mask, imageData, 40)
    peelExteriorStudioKeep(mask, imageData, 40, 24)
  }
  stripForeignBorderBands(mask, imageData)
  removeBrightEdgeChrome(mask, imageData)

  // Stage E — narrow-band alpha refine (no RGB rewrite).
  stages.push('alpha-refine')
  refineBoundaryAlpha(mask, imageData, { bandRadius: 2 })
  featherMaskEdges(mask, 1)

  const confidence = estimateMaskConfidence(mask, imageData)
  const review = decideContourNeedsReview({
    contourAccepted: diagnostics.contourAccepted,
    confidenceNeedsReview: confidence.needsReview,
    confidenceReasons: confidence.reasons,
    substantialCompletion: diagnostics.substantialCompletion,
    borderTouchRatio: diagnostics.borderTouchRatio,
    validation: diagnostics.validation,
  })
  diagnostics.reviewReasons = review.reasons

  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now()

  const result: ContourFirstResult = {
    mask,
    methodUsed: diagnostics.contourAccepted
      ? 'contour-first'
      : 'contour-first-fallback-seed',
    elapsedMs: Math.round(t1 - t0),
    confidence: confidence.score,
    needsReview: review.needsReview,
    diagnostics,
  }

  if (options.includeDebug) {
    result.debug = {
      edges,
      barriers,
      floodedBg,
      outerContour,
    }
  }

  return result
}

/** Rasterize a ring as KEEP replace (test helper). */
export function rasterizeContourRing(
  width: number,
  height: number,
  ring: PolygonPoint[],
): MaskPixelBuffer {
  const mask = createMaskBuffer(width, height, 0)
  fillPolygonOnMask(mask, simplifyPolygon(ring, 0.75), 'replace')
  return mask
}
