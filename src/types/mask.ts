export type BrushMode = 'keep' | 'remove'

export type EditorTool = 'brush' | 'polygon' | 'pan' | 'similar'

export type EditorViewMode = 'original' | 'mask' | 'result' | 'edit'

/**
 * Mask pixels are grayscale values (0–255), one byte per pixel.
 * WHITE (255) = keep original garment pixel
 * BLACK (0)   = show replacement background
 * Initial masks are all black (nothing preserved) until the user paints KEEP.
 */
export type MaskPixelBuffer = {
  width: number
  height: number
  /** Length === width * height */
  data: Uint8ClampedArray
}

/** Compact persisted diagnostic summary (full findings stay in-session when available). */
export type MaskDiagnosticSummary = {
  reviewProfile: 'classical' | 'neural'
  /** Heuristic review score 0–1 — NOT calibrated model confidence. */
  heuristicScore: number
  /** @deprecated alias of heuristicScore */
  score: number
  ruleIds: string[]
  /** Top findings for UI (ruleId + message + measured/threshold). */
  findings: Array<{
    ruleId: string
    severity: string
    message: string
    measuredValue: number
    threshold: number
    unit: string
    affectedRegion: string
    suggestedAction: string
  }>
}

export type MaskStateMeta = {
  /** Bumped whenever mask pixels change so React can refresh previews. */
  revision: number
  /** True after the user has painted or otherwise edited the mask. */
  hasEdits: boolean
  /** Heuristic 0–1 auto-mask confidence (undefined until auto-mask runs). */
  autoConfidence?: number
  /** True when auto-mask signals likely white-on-white / leakage — review recommended. */
  needsReview?: boolean
  /** Actual strategy that produced the mask (`methodUsed`). */
  autoMethodUsed?: string
  /** Human-readable reject / fallback note when contour/ISNet needs review. */
  reviewReason?: string
  /** Structured review diagnostics from the last auto-mask / re-diagnose. */
  diagnosticSummary?: MaskDiagnosticSummary
  /**
   * True when the API auto-mask request failed for this image.
   * Successful API/manual masks clear this so Retry failed can skip them.
   */
  autoFailed?: boolean
}

export function createEmptyMaskMeta(): MaskStateMeta {
  return {
    revision: 0,
    hasEdits: false,
  }
}
