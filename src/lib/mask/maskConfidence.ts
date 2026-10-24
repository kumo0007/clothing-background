/**
 * Heuristic auto-mask confidence for review flagging.
 * Delegates to structured diagnostics (`runMaskDiagnostics`) so every reason
 * maps to a ruleId + measured evidence.
 *
 * Pale garments under neural matting (RMBG) often have little dark KEEP mass;
 * that alone is not a defect. Strong review requires corroborating leakage /
 * geometry evidence.
 */
import type { MaskPixelBuffer } from '../../types/mask'
import { runMaskDiagnostics } from './diagnostics/runMaskDiagnostics'
import type { DiagnosticFinding, MaskMetricSnapshot } from './diagnostics/types'

export type MaskConfidenceProfile = 'classical' | 'neural'

export type MaskConfidence = {
  /** 0 = very uncertain, 1 = relatively clear separation */
  score: number
  needsReview: boolean
  reasons: string[]
  findings?: DiagnosticFinding[]
  /** Diagnostic counters for tests / tooling */
  stats?: {
    keepRatio: number
    softRatio: number
    paleAmongKeep: number
    darkShareAmongKeep: number
    borderStudioRatio: number
    edgeHaloRatio: number
    studioLuma: number
  }
}

export type EstimateMaskConfidenceOptions = {
  /**
   * `neural` (default for bg-remove-sdk): pale KEEP without dark structure is
   * expected for light garments — not a strong review signal by itself.
   * `classical`: Lab-seed / contour path; slightly stricter on pale ambiguity.
   */
  profile?: MaskConfidenceProfile
  /**
   * When false, skip color-vs-studio heuristics (geometry / soft-alpha only).
   * Use when source RGB is unavailable so we do not invent garment colors.
   */
  colorAware?: boolean
  method?: string
  resized?: boolean
}

function statsFromMetrics(m: MaskMetricSnapshot) {
  return {
    keepRatio: m.keepRatio,
    softRatio: m.softRatio,
    paleAmongKeep: m.paleAmongKeep,
    darkShareAmongKeep: m.darkShareAmongKeep,
    borderStudioRatio: m.borderStudioRatio,
    edgeHaloRatio: m.edgeHaloRatio,
    studioLuma: m.studioLuma,
  }
}

export function estimateMaskConfidence(
  mask: MaskPixelBuffer,
  imageData: ImageData,
  options: EstimateMaskConfidenceOptions = {},
): MaskConfidence {
  const profile = options.profile ?? 'classical'
  const colorAware = options.colorAware !== false

  const diagnostics = runMaskDiagnostics({
    mask,
    imageData: colorAware ? imageData : undefined,
    profile,
    method: options.method ?? 'estimateMaskConfidence',
    resized: options.resized ?? false,
  })

  // Preserve legacy reason strings (without [ruleId] prefix) for older tests
  // that match substrings like "white-on-white" / "border-band studio".
  const reasons = diagnostics.findings
    .filter((f) => f.severity !== 'info' || f.forcesReview)
    .map((f) => {
      // Keep searchable legacy phrases inside the structured message.
      if (f.ruleId === 'pale_keep_uncertain') {
        return `${f.message} — inspect light garment edges for studio bleed`
      }
      if (f.ruleId === 'border_studio_leak') {
        return `border-band studio KEEP leakage — check frame edges for leftover backdrop`
      }
      if (f.ruleId === 'bright_fringe') {
        return `bright silhouette fringe — check for white halo around the garment`
      }
      if (f.ruleId === 'classical_pale_fail') {
        return `pale KEEP with weak dark structure — verify Lab-seed did not keep the studio card`
      }
      if (f.ruleId === 'large_soft_alpha') {
        return `large soft-alpha ring — inspect feathered edges`
      }
      if (f.ruleId === 'extreme_keep_area') {
        return f.message.includes('under-masked')
          ? 'very small KEEP area — garment may be under-masked'
          : 'extreme KEEP area — backdrop may be included'
      }
      return f.message
    })

  return {
    score: diagnostics.score,
    needsReview: diagnostics.needsReview,
    reasons,
    findings: diagnostics.findings,
    stats: statsFromMetrics(diagnostics.metrics),
  }
}
