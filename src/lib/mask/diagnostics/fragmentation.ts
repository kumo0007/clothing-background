/**
 * KEEP connected-component analysis for fragmentation diagnostics.
 *
 * Units:
 * - Areas are pixel counts (alpha >= 128, 4-connected).
 * - Shares are fractions of total KEEP pixels (0–1).
 * - `minNoiseAreaPx` is resolution-aware: max(8, round(0.00004 * W * H)).
 *
 * Soft-alpha speckles (RMBG edge dust) often create hundreds of tiny KEEP
 * islands. Those must not be reported as “405 garment fragments.”
 */
import type { MaskPixelBuffer } from '../../../types/mask'

export type KeepComponent = {
  id: number
  areaPx: number
  /** Fraction of total KEEP area */
  areaShare: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Seed pixel index for overlay sampling */
  sampleIndex: number
  kind: 'noise' | 'detail' | 'major'
}

export type FragmentationSummary = {
  /** All 4-connected KEEP components (alpha >= 128), including 1px dust. */
  totalComponents: number
  /** Components with area < noise threshold (tiny islands / soft-edge dust). */
  noiseComponents: number
  /** Components between noise and major (straps, clasps, small details). */
  detailComponents: number
  /** Components with areaShare >= majorShareThr (body panels). */
  majorComponents: number
  /** Significant = detail + major (excludes noise). */
  significantComponents: number
  /** Significant components excluding the largest (detached pieces). */
  detachedSignificantCount: number
  /** KEEP pixels in detached significant components / total KEEP. */
  detachedSignificantAreaShare: number
  largestAreaPx: number
  largestAreaShare: number
  keepPixels: number
  /** Absolute pixel cutoff used for noise classification. */
  noiseAreaPx: number
  /** Area-share cutoff for “major” (fraction of KEEP). */
  majorShareThr: number
}

export type FragmentationAnalysis = {
  components: KeepComponent[]
  summary: FragmentationSummary
  /** Pixel indices belonging to detached significant components (capped). */
  detachedSampleIndices: number[]
  /**
   * Per-pixel labels for overlay: 0=BG, 1=noise, 2=main significant, 3=detached significant.
   * Same length as mask.data.
   */
  labelMap: Uint8Array
}

function noiseAreaThreshold(width: number, height: number): number {
  // ~0.004% of image area, at least 8px — filters soft-matte dust on large photos.
  return Math.max(8, Math.round(width * height * 0.00004))
}

/**
 * Label 4-connected KEEP components and classify by area.
 * Does not mutate the mask.
 */
export function analyzeKeepComponents(
  mask: MaskPixelBuffer,
  options: {
    /** Fraction of KEEP area to count as a major body panel. Default 0.02 (2%). */
    majorShareThr?: number
    /** Cap sample indices for overlays. */
    maxSamples?: number
  } = {},
): FragmentationAnalysis {
  const majorShareThr = options.majorShareThr ?? 0.02
  const maxSamples = options.maxSamples ?? 2048
  const { width, height, data } = mask
  const n = width * height
  const noiseAreaPx = noiseAreaThreshold(width, height)

  let keepPixels = 0
  for (let i = 0; i < n; i += 1) {
    if (data[i]! >= 128) keepPixels += 1
  }

  const seen = new Uint8Array(n)
  const components: KeepComponent[] = []
  const stack: number[] = []
  /** Temporary: pixel lists per component for labelMap pass. */
  const memberLists: number[][] = []
  let nextId = 0

  for (let i = 0; i < n; i += 1) {
    if (seen[i] || data[i]! < 128) continue
    let areaPx = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    const sampleIndex = i
    const members: number[] = []
    stack.length = 0
    stack.push(i)
    seen[i] = 1

    while (stack.length > 0) {
      const cur = stack.pop()!
      areaPx += 1
      members.push(cur)
      const x = cur % width
      const y = (cur / width) | 0
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
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

    const areaShare = keepPixels > 0 ? areaPx / keepPixels : 0
    let kind: KeepComponent['kind'] = 'detail'
    if (areaPx < noiseAreaPx) kind = 'noise'
    else if (areaShare >= majorShareThr) kind = 'major'

    components.push({
      id: nextId++,
      areaPx,
      areaShare,
      minX,
      minY,
      maxX,
      maxY,
      sampleIndex,
      kind,
    })
    memberLists.push(members)
  }

  components.sort((a, b) => b.areaPx - a.areaPx)

  const noiseComponents = components.filter((c) => c.kind === 'noise').length
  const detailComponents = components.filter((c) => c.kind === 'detail').length
  const majorComponents = components.filter((c) => c.kind === 'major').length
  const significant = components.filter((c) => c.kind !== 'noise')
  const largest = significant[0] ?? components[0]
  const detached = significant.slice(1)
  const detachedArea = detached.reduce((s, c) => s + c.areaPx, 0)

  const labelMap = new Uint8Array(n)
  // memberLists is still in discovery order; map by component id
  const byId = new Map(components.map((c) => [c.id, c]))
  for (let id = 0; id < memberLists.length; id += 1) {
    const c = byId.get(id)
    if (!c) continue
    const code =
      c.kind === 'noise' ? 1 : largest && c.id === largest.id ? 2 : 3
    const members = memberLists[id]!
    for (const p of members) labelMap[p] = code
  }

  const detachedSampleIndices: number[] = []
  for (const c of detached) {
    if (detachedSampleIndices.length >= maxSamples) break
    detachedSampleIndices.push(c.sampleIndex)
    const cx = (c.minX + c.maxX) >> 1
    const cy = (c.minY + c.maxY) >> 1
    detachedSampleIndices.push(cy * width + cx)
  }

  return {
    components,
    summary: {
      totalComponents: components.length,
      noiseComponents,
      detailComponents,
      majorComponents,
      significantComponents: significant.length,
      detachedSignificantCount: detached.length,
      detachedSignificantAreaShare:
        keepPixels > 0 ? detachedArea / keepPixels : 0,
      largestAreaPx: largest?.areaPx ?? 0,
      largestAreaShare: largest?.areaShare ?? 0,
      keepPixels,
      noiseAreaPx,
      majorShareThr,
    },
    detachedSampleIndices,
    labelMap,
  }
}

/**
 * Should `fragmented_keep` force review?
 * Uses significant (non-noise) structure — never raw dust counts.
 */
export function shouldFlagFragmentation(
  summary: FragmentationSummary,
  profile: 'classical' | 'neural',
): {
  flag: boolean
  measuredValue: number
  threshold: number
  unit: string
  message: string
} {
  // Primary signal: how much KEEP mass sits outside the main silhouette.
  const detachedShareThr = profile === 'neural' ? 0.12 : 0.1
  // Secondary: several major body panels (split garment), not dust.
  const majorCountThr = profile === 'neural' ? 3 : 4
  // Tertiary: many detached significant pieces AND weak main share.
  const detachedCountThr = profile === 'neural' ? 8 : 12
  const weakMainThr = profile === 'neural' ? 0.65 : 0.55

  if (
    summary.detachedSignificantAreaShare >= detachedShareThr &&
    summary.largestAreaShare < 0.85
  ) {
    return {
      flag: true,
      measuredValue: summary.detachedSignificantAreaShare,
      threshold: detachedShareThr,
      unit: 'detached_significant_area_share (fraction of KEEP)',
      message: `Detached KEEP mass ${(summary.detachedSignificantAreaShare * 100).toFixed(1)}% of foreground (noise excluded) — inspect floaters vs straps`,
    }
  }

  if (summary.majorComponents >= majorCountThr) {
    return {
      flag: true,
      measuredValue: summary.majorComponents,
      threshold: majorCountThr,
      unit: 'major_component_count (each ≥2% of KEEP)',
      message: `${summary.majorComponents} major KEEP panels — garment may be split or include floaters`,
    }
  }

  if (
    summary.detachedSignificantCount >= detachedCountThr &&
    summary.largestAreaShare < weakMainThr
  ) {
    return {
      flag: true,
      measuredValue: summary.detachedSignificantCount,
      threshold: detachedCountThr,
      unit: 'detached_significant_component_count (noise excluded)',
      message: `${summary.detachedSignificantCount} detached significant KEEP pieces (main share ${(summary.largestAreaShare * 100).toFixed(0)}%) — review straps/floaters`,
    }
  }

  return {
    flag: false,
    measuredValue: summary.detachedSignificantAreaShare,
    threshold: detachedShareThr,
    unit: 'detached_significant_area_share (fraction of KEEP)',
    message: '',
  }
}
