/**
 * Detection + diagnosis only. Never mutates mask pixels.
 */
import type { MaskPixelBuffer } from '../../../types/mask'
import type { MaskConfidenceProfile } from '../maskConfidence'
import {
  analyzeKeepComponents,
  shouldFlagFragmentation,
} from './fragmentation'
import {
  computeMaskMetrics,
  sampleBorderStudioIndices,
} from './maskMetrics'
import type {
  DiagnosticFinding,
  DiagnosticOverlayKind,
  MaskDiagnostics,
  MaskMetricSnapshot,
} from './types'

export type RunMaskDiagnosticsInput = {
  mask: MaskPixelBuffer
  imageData?: ImageData
  profile?: MaskConfidenceProfile
  method?: string
  resized?: boolean
  maskRevision?: number
  hasManualEdits?: boolean
}

function scoreFromFindings(
  metrics: MaskMetricSnapshot,
  findings: DiagnosticFinding[],
  profile: MaskConfidenceProfile,
): number {
  let score = 0.72
  if (
    metrics.colorAware &&
    metrics.darkShareAmongKeep > 0.15 &&
    metrics.paleAmongKeep < 0.25 &&
    metrics.keepCount > 2000
  ) {
    score += 0.12
  }
  for (const f of findings) {
    if (f.ruleId === 'pale_keep_uncertain') {
      score -= profile === 'neural' ? 0.16 : 0.28
    } else if (f.ruleId === 'border_studio_leak') {
      score -= 0.18
    } else if (f.ruleId === 'bright_fringe') {
      score -= 0.1
    } else if (f.ruleId === 'classical_pale_fail') {
      score -= 0.1
    } else if (f.ruleId === 'large_soft_alpha') {
      score -= 0.08
    } else if (f.ruleId === 'extreme_keep_area') {
      score -= 0.15
    } else if (f.ruleId === 'fragmented_keep') {
      score -= 0.1
    } else if (f.ruleId === 'internal_holes') {
      score -= 0.06
    } else if (f.ruleId === 'mask_resized') {
      score -= 0.05
    }
  }
  return Math.max(0, Math.min(1, score))
}

/**
 * Evaluate named rules against measured metrics. Pure detection.
 */
export function evaluateDiagnosticRules(
  metrics: MaskMetricSnapshot,
  profile: MaskConfidenceProfile,
  extras: {
    resized: boolean
    leakSamples?: number[]
    fragmentSamples?: number[]
  },
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = []
  const fringeThr = profile === 'neural' ? 0.035 : 0.02
  const borderLeakThr = 0.08

  if (metrics.colorAware && metrics.borderStudioRatio > borderLeakThr) {
    findings.push({
      ruleId: 'border_studio_leak',
      severity: 'defect',
      forcesReview: true,
      message:
        'Border-band KEEP matches studio card — likely leftover backdrop at frame',
      measuredValue: metrics.borderStudioRatio,
      threshold: borderLeakThr,
      unit: 'border_studio_keep / border_band_pixels (ratio)',
      affectedRegion: 'frame-border',
      suggestedAction:
        'Inspect frame edges; use Preview border peel or brush-remove studio',
      sampleIndices: extras.leakSamples,
    })
  } else if (
    metrics.frameTouchKeepCount > Math.max(12, metrics.width * 0.15) &&
    metrics.borderKeepRatio > 0.35 &&
    metrics.colorAware &&
    metrics.borderStudioRatio > 0.04
  ) {
    findings.push({
      ruleId: 'frame_touch_keep',
      severity: 'uncertain',
      forcesReview: profile === 'classical',
      message:
        'Substantial KEEP touches the frame — confirm garment vs studio bleed',
      measuredValue: metrics.borderKeepRatio,
      threshold: 0.35,
      unit: 'border_keep / border_band_pixels (ratio)',
      affectedRegion: 'frame-border',
      suggestedAction: 'Compare original vs composite along the frame',
    })
  }

  if (metrics.colorAware && metrics.edgeHaloRatio > fringeThr) {
    findings.push({
      ruleId: 'bright_fringe',
      severity: profile === 'neural' ? 'uncertain' : 'defect',
      forcesReview:
        profile === 'classical' ||
        metrics.borderStudioRatio > 0.04 ||
        metrics.edgeHaloRatio > fringeThr * 1.4,
      message:
        'Bright studio-like fringe along KEEP edge — check for white halo',
      measuredValue: metrics.edgeHaloRatio,
      threshold: fringeThr,
      unit: 'bright_fringe_keep_pixels / keep_pixels (ratio)',
      affectedRegion:
        profile === 'neural' ? 'frame-border' : 'silhouette-edge',
      suggestedAction: 'Zoom silhouette edges; brush-remove thin card halo',
    })
  }

  if (
    metrics.colorAware &&
    metrics.paleAmongKeep > 0.45 &&
    metrics.studioLuma >= 210
  ) {
    const neuralForces =
      metrics.borderStudioRatio > 0.04 ||
      metrics.edgeHaloRatio > fringeThr ||
      metrics.keepRatio > 0.85 ||
      metrics.keepRatio < 0.1
    findings.push({
      ruleId: 'pale_keep_uncertain',
      severity: neuralForces || profile === 'classical' ? 'uncertain' : 'info',
      forcesReview: profile === 'classical' || neuralForces,
      message:
        'High near-card pale KEEP share (white-on-white risk)',
      measuredValue: metrics.paleAmongKeep,
      threshold: 0.45,
      unit: 'pale_near_card_keep / keep_pixels (ratio)',
      affectedRegion: 'global',
      suggestedAction:
        'Inspect light garment edges for studio bleed; do not assume defect',
    })
  }

  const paleWithoutDark =
    metrics.colorAware &&
    metrics.paleAmongKeep > 0.3 &&
    metrics.darkShareAmongKeep < 0.02 &&
    metrics.keepCount > 0 &&
    metrics.darkShareAmongKeep * metrics.keepCount < 400

  if (
    paleWithoutDark &&
    profile === 'classical' &&
    metrics.paleAmongKeep > 0.55 &&
    !(metrics.borderStudioRatio > borderLeakThr)
  ) {
    findings.push({
      ruleId: 'classical_pale_fail',
      severity: 'uncertain',
      forcesReview: true,
      message:
        'Pale KEEP with weak dark structure — Lab-seed may have kept the card',
      measuredValue: metrics.paleAmongKeep,
      threshold: 0.55,
      unit: 'pale_near_card_keep / keep_pixels (ratio)',
      affectedRegion: 'global',
      suggestedAction: 'Verify silhouette against original; correct with brush',
    })
  }

  if (metrics.softRatio > 0.12) {
    findings.push({
      ruleId: 'large_soft_alpha',
      severity: 'info',
      forcesReview: false,
      message: 'Large soft-alpha ring — usually valid antialiasing',
      measuredValue: metrics.softRatio,
      threshold: 0.12,
      unit: 'soft_alpha_pixels / image_pixels (ratio)',
      affectedRegion: 'silhouette-edge',
      suggestedAction: 'Inspect soft edges; only edit if halo is wrong',
    })
  }

  if (metrics.keepRatio < 0.05 || metrics.keepRatio > 0.92) {
    const under = metrics.keepRatio < 0.05
    findings.push({
      ruleId: 'extreme_keep_area',
      severity: 'defect',
      forcesReview: true,
      message: under
        ? 'Very small KEEP area — garment may be under-masked'
        : 'Extreme KEEP area — backdrop may be included',
      measuredValue: metrics.keepRatio,
      threshold: under ? 0.05 : 0.92,
      unit: 'keep_pixels / image_pixels (ratio)',
      affectedRegion: 'global',
      suggestedAction: under
        ? 'Check missing sleeves/hems; paint KEEP on missing regions'
        : 'Remove studio KEEP with brush or border peel preview',
    })
  }

  // Fragmentation — never use raw soft-edge dust counts as measuredValue.
  const frag = shouldFlagFragmentation(metrics.fragmentation, profile)
  if (frag.flag && metrics.keepRatio > 0.08) {
    const fsum = metrics.fragmentation
    findings.push({
      ruleId: 'fragmented_keep',
      severity: 'uncertain',
      forcesReview: true,
      message: `${frag.message} (raw islands ${fsum.totalComponents}, noise ${fsum.noiseComponents}, significant ${fsum.significantComponents}, main ${(fsum.largestAreaShare * 100).toFixed(0)}%)`,
      measuredValue: frag.measuredValue,
      threshold: frag.threshold,
      unit: frag.unit,
      affectedRegion: 'interior',
      suggestedAction:
        'Open Fragments overlay; keep straps/handles, remove floaters. Small dust is ignored.',
      sampleIndices: extras.fragmentSamples,
    })
  }

  if (metrics.internalHoleRatio > 0.04 && metrics.keepRatio > 0.15) {
    findings.push({
      ruleId: 'internal_holes',
      severity: 'info',
      forcesReview: false,
      message:
        'Internal BG holes inside silhouette — may be handles/openings or bites',
      measuredValue: metrics.internalHoleRatio,
      threshold: 0.04,
      unit: 'enclosed_bg_pixels / image_pixels (ratio)',
      affectedRegion: 'interior',
      suggestedAction:
        'If holes are wrong garment bites, paint KEEP; leave real openings',
    })
  }

  if (extras.resized) {
    findings.push({
      ruleId: 'mask_resized',
      severity: 'uncertain',
      forcesReview: true,
      message: 'Mask was resized to source dimensions — verify soft-edge alignment',
      measuredValue: 1,
      threshold: 0,
      unit: 'boolean (1 = resized)',
      affectedRegion: 'global',
      suggestedAction: 'Compare mask overlay to original edges',
    })
  }

  if (!metrics.colorAware) {
    findings.push({
      ruleId: 'missing_source_rgb',
      severity: 'uncertain',
      forcesReview: metrics.keepRatio < 0.08,
      message: 'No source RGB for color review — geometry-only diagnostics',
      measuredValue: 0,
      threshold: 1,
      unit: 'boolean (0 = missing RGB)',
      affectedRegion: 'global',
      suggestedAction: 'Inspect mask visually against the original image',
    })
  }

  return findings
}

export function runMaskDiagnostics(
  input: RunMaskDiagnosticsInput,
): MaskDiagnostics {
  const profile = input.profile ?? 'classical'
  const method = input.method ?? 'unknown'
  const resized = input.resized ?? false

  const metrics = computeMaskMetrics(input.mask, input.imageData, {
    neuralFringeBorderOnly: profile === 'neural',
  })

  const fragAnalysis = analyzeKeepComponents(input.mask)

  const leakSamples =
    metrics.colorAware && input.imageData
      ? sampleBorderStudioIndices(input.mask, input.imageData)
      : undefined

  const findings = evaluateDiagnosticRules(metrics, profile, {
    resized,
    leakSamples,
    fragmentSamples: fragAnalysis.detachedSampleIndices,
  })

  let heuristicScore = scoreFromFindings(metrics, findings, profile)
  const scoreFloor = profile === 'neural' ? 0.48 : 0.55

  if (heuristicScore < scoreFloor) {
    const already = findings.some((f) => f.ruleId === 'score_floor')
    if (!already) {
      findings.push({
        ruleId: 'score_floor',
        severity: 'uncertain',
        forcesReview: true,
        message: `Heuristic review score ${heuristicScore.toFixed(2)} below ${scoreFloor} floor (not model confidence)`,
        measuredValue: heuristicScore,
        threshold: scoreFloor,
        unit: 'heuristic_review_score (0–1, lower = more risk signals)',
        affectedRegion: 'global',
        suggestedAction: 'Inspect findings above; correct mask if defects visible',
      })
    }
  }

  heuristicScore = scoreFromFindings(metrics, findings, profile)

  const needsReview =
    findings.some((f) => f.forcesReview) || heuristicScore < scoreFloor

  const reviewReasons = findings
    .filter((f) => f.forcesReview || f.severity === 'defect')
    .map((f) => `[${f.ruleId}] ${f.message}`)

  if (needsReview && reviewReasons.length === 0) {
    const top = findings.find((f) => f.severity !== 'info') ?? findings[0]
    if (top) {
      reviewReasons.push(`[${top.ruleId}] ${top.message}`)
    }
  }

  return {
    method,
    reviewProfile: profile,
    needsReview,
    reviewReasons,
    findings,
    metrics,
    heuristicScore: Math.max(0, Math.min(1, heuristicScore)),
    score: Math.max(0, Math.min(1, heuristicScore)),
    maskRevision: input.maskRevision,
    hasManualEdits: input.hasManualEdits,
    resized,
  }
}

/** Build a diagnostic overlay ImageData (RGBA). Does not touch the mask. */
export function buildDiagnosticOverlay(
  mask: MaskPixelBuffer,
  kind: DiagnosticOverlayKind,
  findings: DiagnosticFinding[] = [],
): ImageData {
  const { width, height, data } = mask
  const out = new Uint8ClampedArray(width * height * 4)
  const band = Math.max(2, Math.floor(Math.min(width, height) * 0.03))
  const leakSet = new Set<number>()
  for (const f of findings) {
    if (f.ruleId === 'border_studio_leak' && f.sampleIndices) {
      for (const i of f.sampleIndices) leakSet.add(i)
    }
  }

  const fragKind =
    kind === 'fragments' ? analyzeKeepComponents(mask).labelMap : null

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const o = i * 4
      const v = data[i]!
      const onBorder =
        x < band || y < band || x >= width - band || y >= height - band
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      switch (kind) {
        case 'keep':
          if (v >= 128) {
            r = 40
            g = 200
            b = 90
            a = 160
          }
          break
        case 'bg':
          if (v < 128) {
            r = 40
            g = 80
            b = 220
            a = 100
          }
          break
        case 'soft':
          if (v > 0 && v < 200) {
            r = 240
            g = 180
            b = 40
            a = 180
          }
          break
        case 'border-band':
          if (onBorder) {
            r = 180
            g = 80
            b = 220
            a = 90
          }
          break
        case 'suspected-leak':
          if (leakSet.has(i) || (onBorder && v >= 128 && leakSet.size === 0)) {
            r = 230
            g = 40
            b = 40
            a = leakSet.has(i) ? 200 : 40
          }
          break
        case 'fragments': {
          const code = fragKind?.[i] ?? 0
          if (code === 2) {
            // main silhouette
            r = 40
            g = 200
            b = 90
            a = 150
          } else if (code === 3) {
            // detached significant
            r = 230
            g = 60
            b = 40
            a = 200
          } else if (code === 1) {
            // noise dust
            r = 240
            g = 200
            b = 40
            a = 70
          }
          break
        }
        case 'none':
          break
        default: {
          const _exhaustive: never = kind
          void _exhaustive
        }
      }

      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
      out[o + 3] = a
    }
  }

  return { width, height, data: out, colorSpace: 'srgb' } as ImageData
}
