import type { MaskConfidenceProfile } from '../maskConfidence'
import type { FragmentationSummary } from './fragmentation'

/** Stable rule identifiers — every review reason maps to one of these. */
export type DiagnosticRuleId =
  | 'border_studio_leak'
  | 'frame_touch_keep'
  | 'bright_fringe'
  | 'pale_keep_uncertain'
  | 'classical_pale_fail'
  | 'extreme_keep_area'
  | 'large_soft_alpha'
  | 'fragmented_keep'
  | 'internal_holes'
  | 'mask_resized'
  | 'missing_source_rgb'
  | 'score_floor'

export type DiagnosticSeverity =
  | 'info'
  | 'uncertain'
  | 'defect'
  | 'critical'

export type AffectedRegion =
  | 'frame-border'
  | 'silhouette-edge'
  | 'interior'
  | 'global'
  | 'unknown'

export type DiagnosticFinding = {
  ruleId: DiagnosticRuleId
  severity: DiagnosticSeverity
  /** Forces needsReview when true */
  forcesReview: boolean
  message: string
  measuredValue: number
  threshold: number
  /** Human-readable unit for measuredValue / threshold (e.g. "fraction of KEEP"). */
  unit: string
  affectedRegion: AffectedRegion
  suggestedAction: string
  /** Optional sparse pixel indices (y*width+x) for overlay — capped. */
  sampleIndices?: number[]
}

export type MaskMetricSnapshot = {
  width: number
  height: number
  pixels: number
  keepCount: number
  bgCount: number
  softCount: number
  keepRatio: number
  softRatio: number
  bgRatio: number
  borderBandPx: number
  borderKeepCount: number
  borderKeepRatio: number
  borderStudioKeepCount: number
  borderStudioRatio: number
  frameTouchKeepCount: number
  /**
   * Significant KEEP components only (noise dust excluded).
   * Not the raw island count — see fragmentation.totalComponents for that.
   */
  keepComponentCount: number
  largestKeepShare: number
  fragmentation: FragmentationSummary
  internalHoleRatio: number
  paleAmongKeep: number
  darkShareAmongKeep: number
  edgeHaloRatio: number
  studioLuma: number
  colorAware: boolean
}

export type MaskDiagnostics = {
  method: string
  reviewProfile: MaskConfidenceProfile
  needsReview: boolean
  /** Human-readable reasons derived from findings (defect/uncertain that force review). */
  reviewReasons: string[]
  /** All findings including informational. */
  findings: DiagnosticFinding[]
  metrics: MaskMetricSnapshot
  /**
   * Heuristic review score (0–1), NOT calibrated model confidence.
   * Lower means more risk signals fired.
   */
  heuristicScore: number
  /** @deprecated alias of heuristicScore for older callers */
  score: number
  maskRevision?: number
  hasManualEdits?: boolean
  resized: boolean
}

export type DiagnosticOverlayKind =
  | 'keep'
  | 'bg'
  | 'soft'
  | 'border-band'
  | 'suspected-leak'
  | 'fragments'
  | 'none'
